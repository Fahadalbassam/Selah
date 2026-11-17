-- Masking for a translation without the project's list of names.
--
-- Before text reaches a hosted model its names become placeholders
-- (lib/masking.ts). The list of a project's names (app_mask_terms) is not
-- for action owners (0087): it names everyone at the client and the firm.
-- A translation now asks only for the names written in its own text, which
-- the reader already sees there, so owners keep machine translation.
--
-- 1. The project's names (latest: app_mask_terms in 0087, unchanged), for
--    the two functions below only: not callable by the app.
CREATE FUNCTION app_mask_names(pid uuid) RETURNS TABLE (kind text, term text, entity text)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, pg_temp AS $$
  WITH p AS (
    SELECT x.org_id, x.firm_org_id FROM projects x
    WHERE x.id = pid AND (session_user <> 'selah_app' OR app_can_see_project(pid))
  ), orgs AS (
    SELECT o.id, o.name, o.name_ar, o.display_alias, o.short_names FROM organizations o, p WHERE o.id IN (p.org_id, p.firm_org_id)
    UNION
    SELECT o.id, o.name, o.name_ar, o.display_alias, o.short_names FROM organizations o, p
    WHERE o.kind = 'client'
      AND (session_user <> 'selah_app' OR app_org() = p.firm_org_id)
      AND EXISTS (SELECT 1 FROM projects y WHERE y.org_id = o.id AND y.firm_org_id = p.firm_org_id)
  ), terms AS (
    SELECT 'ORG'::text AS kind, unnest(ARRAY[o.name, o.name_ar, o.display_alias] || o.short_names) AS term, 'org:' || o.id AS entity
      FROM orgs o
    UNION
    SELECT 'PERSON', unnest(ARRAY[u.name, u.name_alt]), 'user:' || u.id FROM "user" u JOIN org_memberships m ON m.user_id = u.id, p
      WHERE m.org_id IN (p.org_id, p.firm_org_id)
    UNION
    SELECT 'PERSON', unnest(ARRAY[c.name, c.name_alt]), 'contact:' || c.id FROM client_contacts c, p WHERE c.org_id = p.org_id
    UNION
    SELECT 'DEPT', unnest(ARRAY[d.name_ar, d.name_en]), 'dept:' || d.id FROM departments d, p WHERE d.org_id = p.org_id
    UNION
    -- Client people with no account, named as an action's owner ("ماجد الواحي (مدير المكتب)"): the name without the role.
    SELECT 'PERSON', n, 'owner:' || md5(n) FROM (
      SELECT DISTINCT btrim(regexp_replace(a.owner_name, '\s*\(.*\)\s*$', '')) AS n FROM actions a WHERE a.project_id = pid AND a.owner_name IS NOT NULL
    ) o
  )
  SELECT DISTINCT t.kind, btrim(t.term), t.entity FROM terms t WHERE t.term IS NOT NULL AND length(btrim(t.term)) >= 2
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_mask_names(uuid) FROM PUBLIC;
--> statement-breakpoint
-- 2. The list (latest: 0087): still refused for action owners.
CREATE OR REPLACE FUNCTION app_mask_terms(pid uuid) RETURNS TABLE (kind text, term text, entity text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF session_user = 'selah_app' AND app_role() = 'action_owner' THEN
    RAISE EXCEPTION 'the masking list is not for action owners' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN QUERY SELECT n.kind, n.term, n.entity FROM app_mask_names(pid) n;
END $$;
--> statement-breakpoint
-- 3. The pattern lib/masking.ts builds for one name, in PostgreSQL's syntax:
--    a Latin name as whole words, its parts with or without separators and
--    "al" also written "el"; an Arabic name possibly after a prefix (و، ب،
--    ل، ال), not followed by a letter. The letters and digits at its edges
--    are those of the Latin and Arabic scripts, part of \p{L} and \p{N}, so a
--    name is found at least wherever the masker would find it.
CREATE FUNCTION app_mask_pattern(form text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  WITH k AS (
    SELECT lower(form) AS f,
      'a-zÀ-ÖØ-öø-ɏؠ-يٮٯٱ-ۓەۥۦۮۯۺ-ۼۿݐ-ݿﭐ-ﮱﯓ-ﴽﵐ-ﶏﶒ-ﷇﷰ-ﷻﹰ-ﹴﹶ-ﻼ' AS letter,
      '0-9٠-٩۰-۹' AS digit,
      '\t\n\v\f\r    -     　﻿' AS space,
      -- Between the parts of a Latin name: "Al-Harbi", "Al Harbi", "Alharbi" and "Al‑Harbi" are one name.
      '[\t\n\v\f\r    -     　﻿\-‐-―''’`ʿ]' AS sep
  )
  SELECT CASE
    WHEN k.f ~ '[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]' THEN
      replace(regexp_replace(k.f, '([.^$|?*+()\[\]{}\\])', '\\\1', 'g'), ' ', '[' || k.space || ']+') || '(?![' || k.letter || '])'
    ELSE
      '(?<![' || k.letter || k.digit || '])'
      || (SELECT string_agg(
            CASE WHEN s.tok ~ '^(al|el)(.{3}|$)'
              THEN '[ae]l' || k.sep || '*' || regexp_replace(substr(s.tok, 3), '([.^$|?*+()\[\]{}\\])', '\\\1', 'g')
              ELSE regexp_replace(s.tok, '([.^$|?*+()\[\]{}\\])', '\\\1', 'g') END,
            k.sep || '*' ORDER BY s.i)
          FROM regexp_split_to_table(k.f, k.sep || '+') WITH ORDINALITY AS s(tok, i) WHERE s.tok <> '')
      || '(?![' || k.letter || k.digit || '])'
  END
  FROM k
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_mask_pattern(text) FROM PUBLIC;
--> statement-breakpoint
-- 4. The names of the project written in this text, and nothing else: each
--    as written in the list (or the part of it in the text, "Reem" of "Reem
--    Al-Harbi"), with a number shared by the names of one record instead of
--    its id. Whoever can see the project may ask, action owners included;
--    for a project she can't see, nothing. lib/masking.ts then masks with
--    these names only, as it would with the whole list.
CREATE FUNCTION app_mask_terms_in(pid uuid, body text) RETURNS TABLE (kind text, term text, grp integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH b AS (
    -- Short vowels and other marks would hide a name (the masker drops them first).
    SELECT regexp_replace(coalesce(body, ''),
      '[̀-ͯ҃-҉֑-ׇֽֿׁׂׅׄؐ-ًؚ-ٰٟۖ-ۜ۟-۪ۤۧۨ-ۭ࣓-ࣿ᪰-᫿᷀-᷿⃐-⃿︀-️︠-︯]',
      '', 'g') AS t
  ), names AS (
    SELECT n.kind, n.entity, btrim(regexp_replace(regexp_replace(n.term,
      '[̀-ͯ҃-҉֑-ׇֽֿׁׂׅׄؐ-ًؚ-ٰٟۖ-ۜ۟-۪ۤۧۨ-ۭ࣓-ࣿ᪰-᫿᷀-᷿⃐-⃿︀-️︠-︯]',
      '', 'g'), '[\t\n\v\f\r    -     　﻿]+', ' ', 'g')) AS term
    FROM app_mask_names(pid) n
  ), forms AS (
    SELECT n.kind, n.term AS form, n.entity FROM names n
    UNION
    -- "Reem Al-Harbi" is also written "Reem" or "Al-Harbi" (parts too common, such as "bin", are not names)...
    SELECT 'PERSON', x.part, n.entity FROM names n, regexp_split_to_table(n.term, ' ') AS x(part)
    WHERE n.kind = 'PERSON' AND char_length(x.part) >= 4
      AND lower(x.part) <> ALL (ARRAY['al', 'bin', 'bint', 'ibn', 'abu', 'abd', 'abdul', 'آل', 'بن', 'بنت', 'ابن', 'أبو', 'ابو', 'عبد'])
    UNION
    -- ... and "Al-Harbi" is also written "Harbi".
    SELECT 'PERSON', (regexp_match(x.part, '^(?:al|el)[-‐-―](.{4,})$', 'i'))[1], n.entity
    FROM names n, regexp_split_to_table(n.term, ' ') AS x(part) WHERE n.kind = 'PERSON'
  ), found AS (
    SELECT f.kind, f.form, f.entity FROM forms f, b
    WHERE char_length(f.form) >= 3 AND b.t ~* app_mask_pattern(f.form)
  )
  SELECT DISTINCT f.kind, f.form, (dense_rank() OVER (ORDER BY f.entity))::integer FROM found f
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_mask_terms_in(uuid, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_mask_terms_in(uuid, text) TO selah_app;
