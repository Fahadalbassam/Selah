-- Arabic word search that reads every way a word is typed (section 7 item 4),
-- and masking that uses the same spelling.
--
-- 1. The search fold, the same rules as foldWords() in lib/arabic-fold.ts
--    (tests/db/arabic-search.test.ts checks they agree on a word list): lower
--    case; أ إ آ ٱ → ا, ى → ي, ة → ه, ؤ ئ → ء; Arabic-Indic and Persian digits
--    → 0-9; short vowels, nunation, shadda, sukun, dagger alef and tatweel
--    dropped (translate() removes the characters of its second argument that
--    have no counterpart in the third). Only built-in functions, so it can be
--    inlined and works under any search_path (a restore recomputes the
--    stored column with an empty one).
CREATE FUNCTION app_search_fold(t text) RETURNS text
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS $$
  SELECT translate(lower(t),
    'أإآٱىةؤئ٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹' || U&'\064B\064C\064D\064E\064F\0650\0651\0652\0653\0654\0655\0656\0657\0658\0659\065A\065B\065C\065D\065E\065F\0670\0640',
    'اااايهءء01234567890123456789')
$$;
--> statement-breakpoint
-- 2. An Arabic word (folded) without its leading «ال» (also «وال», «بال»,
--    «وبال»...), «لل» (ل + ال, also «ولل»), or else one of و ف ب ل ك, when at
--    least three letters are left; and a word starting «لل» also without its
--    first ل only («للجنه» is ل + «اللجنه»: «جنه» and «لجنه»). Empty when there
--    is none. The same as searchStems() in lib/arabic-fold.ts. The
--    alternatives are longest first, so this regular expression (which takes
--    the longest match) and JavaScript's (which takes the first) agree.
CREATE FUNCTION app_search_stems(w text) RETURNS text[]
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS $$
  SELECT CASE WHEN w ~ '^[ء-ي]+$' THEN
    ARRAY(SELECT DISTINCT s FROM unnest(ARRAY[
      regexp_replace(w, '^(?:[وف]?[بكل]?ال(?=[ء-ي]{3})|[وف]?لل(?=[ء-ي]{3})|[وفبلك](?=[ء-ي]{3}))', ''),
      regexp_replace(w, '^[وف]?ل(?=ل[ء-ي]{3})', '')
    ]) AS s WHERE s <> w ORDER BY s)
  ELSE '{}' END
$$;
--> statement-breakpoint
-- 3. What a passage is searched by: every word in the fold, and each Arabic
--    word that has a prefix also without it. Both forms are kept, so «لجنه»
--    still matches as written and ranks (ts_rank) above a passage that only
--    shares «جنه»; keywordQuery() asks for both forms of each word too.
CREATE FUNCTION app_search_tsv(content text) RETURNS tsvector
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT pg_catalog.to_tsvector('simple'::regconfig, f.t)
    || pg_catalog.to_tsvector('simple'::regconfig, coalesce((
      SELECT string_agg(s.stem, ' ')
      FROM regexp_split_to_table(f.t, '[^ء-ي]+') AS w(word), unnest(public.app_search_stems(w.word)) AS s(stem)), ''))
  FROM (SELECT public.app_search_fold(coalesce(content, '')) AS t) f
$$;
--> statement-breakpoint
-- 4. The stored column, now by that function. PostgreSQL 16 cannot change a
--    generated column's expression, so it is dropped (its GIN index goes with
--    it) and added again, which rewrites the table; the embeddings are
--    unchanged. Changing the fold later needs the same: a new migration that
--    adds the column again, or old passages keep the old spelling.
ALTER TABLE "ai_chunks" drop column "tsv";--> statement-breakpoint
ALTER TABLE "ai_chunks" ADD COLUMN "tsv" "tsvector" GENERATED ALWAYS AS (app_search_tsv("ai_chunks"."content")) STORED;--> statement-breakpoint
CREATE INDEX "ai_chunks_tsv_idx" ON "ai_chunks" USING gin ("tsv");--> statement-breakpoint
-- 5. Masking in the same fold (latest: 0089). The pattern for one name is
--    built from its folded form, and is matched against folded text below:
--    «احمد» is found for «أحمد», «ريـــم» for «ريم». An Arabic name that starts
--    with «ال» is also found with «لل» in its place, as Arabic writes ل + ال
--    («للنخبة» for «النخبة»). lib/masking.ts does the same: change both together.
CREATE OR REPLACE FUNCTION app_mask_pattern(form text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  WITH k AS (
    SELECT app_search_fold(form) AS f,
      'a-zÀ-ÖØ-öø-ɏؠ-يٮٯٱ-ۓەۥۦۮۯۺ-ۼۿݐ-ݿﭐ-ﮱﯓ-ﴽﵐ-ﶏﶒ-ﷇﷰ-ﷻﹰ-ﹴﹶ-ﻼ' AS letter,
      '0-9٠-٩۰-۹' AS digit,
      '\t\n\v\f\r    -     　﻿' AS space,
      -- Between the parts of a Latin name: "Al-Harbi", "Al Harbi", "Alharbi" and "Al‑Harbi" are one name.
      '[\t\n\v\f\r    -     　﻿\-‐-―''’`ʿ]' AS sep
  )
  SELECT CASE
    WHEN k.f ~ '[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]' THEN
      replace(
        CASE WHEN k.f ~ '^ال' THEN '(?:ال|لل)' || regexp_replace(substr(k.f, 3), '([.^$|?*+()\[\]{}\\])', '\\\1', 'g')
          ELSE regexp_replace(k.f, '([.^$|?*+()\[\]{}\\])', '\\\1', 'g') END,
        ' ', '[' || k.space || ']+') || '(?![' || k.letter || '])'
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
-- 6. The names of the project written in this text (latest: 0089), now
--    looked for in the folded text. Each is still returned as the list holds
--    it, so lib/masking.ts masks it in every spelling the fold joins.
CREATE OR REPLACE FUNCTION app_mask_terms_in(pid uuid, body text) RETURNS TABLE (kind text, term text, grp integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH b AS (
    -- Short vowels and other marks would hide a name (the masker drops them first); then the fold.
    SELECT app_search_fold(regexp_replace(coalesce(body, ''),
      '[̀-ͯ҃-҉֑-ׇֽֿׁׂׅׄؐ-ًؚ-ٰٟۖ-ۜ۟-۪ۤۧۨ-ۭ࣓-ࣿ᪰-᫿᷀-᷿⃐-⃿︀-️︠-︯]',
      '', 'g')) AS t
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
