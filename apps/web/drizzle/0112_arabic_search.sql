-- Arabic word search that reads every way a word is typed (section 7 item 4),
-- and masking that uses the same spelling.
--
-- 1. The search fold, the same rules as foldWords() in lib/arabic-fold.ts
--    (tests/db/arabic-search.test.ts checks they agree on a word list): lower
--    case; short vowels, nunation, shadda, sukun, dagger alef and tatweel
--    (U+064B to U+065F, U+0670, U+0640) dropped; أ إ آ ٱ → ا, ؤ ئ → ء, ى → ي,
--    ة → ه; Arabic-Indic and Persian digits → 0-9. Written as a few passes of
--    replace() and regexp_replace(), about twice as fast as one translate()
--    with the same map (docs/operations.md). Only built-in functions, so it
--    works under any search_path (a restore recomputes the stored column
--    with an empty one).
CREATE FUNCTION app_search_fold(t text) RETURNS text
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS $$
  SELECT CASE WHEN x.s ~ '[٠-٩۰-۹]' THEN
      replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(x.s, '٠', '0'), '١', '1'), '٢', '2'), '٣', '3'), '٤', '4'), '٥', '5'), '٦', '6'), '٧', '7'), '٨', '8'), '٩', '9'), '۰', '0'), '۱', '1'), '۲', '2'), '۳', '3'), '۴', '4'), '۵', '5'), '۶', '6'), '۷', '7'), '۸', '8'), '۹', '9')
    ELSE x.s END
  FROM (SELECT replace(replace(
    pg_catalog.regexp_replace(pg_catalog.regexp_replace(
      pg_catalog.regexp_replace(lower(t), '[' || chr(1611) || '-' || chr(1631) || chr(1648) || chr(1600) || ']', '', 'g'),
      '[أإآٱ]', 'ا', 'g'), '[ؤئ]', 'ء', 'g'),
    'ى', 'ي'), 'ة', 'ه') AS s) x
$$;
--> statement-breakpoint
-- 2. An Arabic word (folded) without its leading «ال» (also «وال», «بال»,
--    «وبال»...), «لل» (ل + ال, also «ولل»), or else one of و ف ب ل ك, when at
--    least three letters are left; and a word starting «لل» also without its
--    first ل only («للجنه» is ل + «اللجنه»: «جنه» and «لجنه»). Empty when there
--    is none. The same as searchStems() in lib/arabic-fold.ts, and the
--    shorter forms app_search_tsv() indexes. The
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
--    word that has a prefix also without it (the forms app_search_stems()
--    gives). Built with two passes of one regular expression each over the
--    whole text, not a call per word: each word with a prefix gets its
--    shorter form written after it, marked «#» so the next pass leaves it
--    alone («وبالمكافات» → «وبالمكافات #مكافات»), and to_tsvector() reads it
--    all (it takes «#» as a space). Both forms are kept, so «لجنه» still
--    matches as written and ranks (ts_rank) above a passage that only shares
--    «جنه»; keywordQuery() asks for both forms of each word too.
--    tests/db/arabic-search.test.ts checks this gives the words of
--    to_tsvector() and of searchStems(), no more and no fewer.
CREATE FUNCTION app_search_tsv(content text) RETURNS tsvector
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT pg_catalog.to_tsvector('simple'::regconfig,
    pg_catalog.regexp_replace(pg_catalog.regexp_replace(public.app_search_fold(coalesce(content, '')),
      -- «للجنه» is also ل + «اللجنه»: «#لجنه» before it.
      '(^|[^ء-ي])([وف]?)ل(ل[ء-ي]{3,})', '\1#\3 \1\2ل\3', 'g'),
      -- The word without its longest prefix after it: «وبالمكافات #مكافات».
      '(^|[^ء-ي#])([وف]?[بكل]?ال|[وف]?لل|[وفبلك])([ء-ي]{3,})', '\1\2\3 #\3', 'g'))
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
--    «احمد» is found for «أحمد», «ريـــم» for «ريم». An Arabic name is found
--    only at the start of a word or after a prefix written on to it (و ف ب ل
--    ك, the article, «لل»), never inside another word («أمل» in «شامل»). A
--    name that starts with the article as written («ال», not «آل» or «إل»)
--    is also found with «لل» in its place, as Arabic writes ل + ال («للنخبة»
--    for «النخبة», «للجنة» for «اللجنة»). lib/masking.ts finds names by the
--    same rules or stricter ones (a person's name takes no article; a last
--    word without the article keeps its ة), so the names this finds include
--    every name the masker masks: change both together. The pattern now
--    depends on the kind of name, so the function takes it.
DROP FUNCTION app_mask_pattern(text);
--> statement-breakpoint
CREATE FUNCTION app_mask_pattern(form text, kind text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  WITH k AS (
    SELECT app_search_fold(form) AS f, btrim(form) AS lit,
      'a-zÀ-ÖØ-öø-ɏؠ-يٮٯٱ-ۓەۥۦۮۯۺ-ۼۿݐ-ݿﭐ-ﮱﯓ-ﴽﵐ-ﶏﶒ-ﷇﷰ-ﷻﹰ-ﹴﹶ-ﻼ' AS letter,
      '0-9٠-٩۰-۹' AS digit,
      '\t\n\v\f\r    -     　﻿' AS space,
      -- Between the parts of a Latin name: "Al-Harbi", "Al Harbi", "Alharbi" and "Al‑Harbi" are one name.
      '[\t\n\v\f\r    -     　﻿\-‐-―''’`ʿ]' AS sep
  )
  SELECT CASE
    WHEN k.f ~ '[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]' THEN
      -- At the start, or after a prefix written on to the name: و ف ب ك ل before a name with
      -- the article (ل usually makes it «لل», below), و ف ب ل before a person's name, and
      -- also the article or «لل» before any other.
      '(?:^|[^' || k.letter || '])'
      || CASE WHEN k.lit ~ '^[اٱ]ل' THEN '[وف]?[بكل]?' WHEN kind = 'PERSON' THEN '[وف]?[بل]?'
           ELSE '(?:[وف]?[بكل]?(?:ال)?|[وف]?لل)' END
      || replace(
        CASE WHEN k.lit ~ '^[اٱ]لل' THEN '(?:ال|ل)' || regexp_replace(substr(k.f, 3), '([.^$|?*+()\[\]{}\\])', '\\\1', 'g')
          WHEN k.lit ~ '^[اٱ]ل' THEN '(?:ال|لل)' || regexp_replace(substr(k.f, 3), '([.^$|?*+()\[\]{}\\])', '\\\1', 'g')
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
REVOKE ALL ON FUNCTION app_mask_pattern(text, text) FROM PUBLIC;
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
    WHERE char_length(f.form) >= 3 AND b.t ~* app_mask_pattern(f.form, f.kind)
  )
  SELECT DISTINCT f.kind, f.form, (dense_rank() OVER (ORDER BY f.entity))::integer FROM found f
$$;
