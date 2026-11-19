// One spelling for Arabic text before it is matched, so a word written once
// reads every way it is typed. The rules are defined here once; the database
// has the same rules for word search and masking (app_search_fold and
// app_search_stems, migration 0112). Change both together:
// tests/db/arabic-search.test.ts checks that they agree.

/** Short vowels, nunation, shadda, sukun, dagger alef (U+064B to U+065F, U+0670) and tatweel (U+0640): dropped. */
export const FOLD_DROP = "ًٌٍَُِّْٰٕٖٜٟٓٔٗ٘ٙٚٛٝٞـ";
/** Letters read as one: أ إ آ ٱ → ا, ى → ي, ة → ه. */
const LETTERS_FROM = "أإآٱىة";
const LETTERS_TO = "اااايه";
/** For word search and masking only: ؤ ئ → ء, and Arabic-Indic and Persian digits → 0-9. */
const SEARCH_FROM = "ؤئ٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹";
const SEARCH_TO = "ءء01234567890123456789";
/** The whole search fold as one map, in the order app_search_fold() passes it to translate(). */
export const SEARCH_FOLD_FROM = LETTERS_FROM + SEARCH_FROM;
export const SEARCH_FOLD_TO = LETTERS_TO + SEARCH_TO;

const DROP = new RegExp(`[${FOLD_DROP}]`, "g");
const mapOf = (from: string, to: string) => new Map([...from].map((c, i) => [c, to[i]!]));
const LETTERS = mapOf(LETTERS_FROM, LETTERS_TO);
const SEARCH = mapOf(SEARCH_FOLD_FROM, SEARCH_FOLD_TO);
const LETTERS_RE = new RegExp(`[${LETTERS_FROM}]`, "g");
const SEARCH_RE = new RegExp(`[${SEARCH_FOLD_FROM}]`, "g");

/**
 * The fold the question-word patterns are written in: no short vowels,
 * nunation or shadda (both «نظامًا» and «نظاماً» become «نظاما»), no tatweel
 * («ممتـثلة»), one alef (أ إ آ ٱ → ا), ى → ي and ة → ه. Patterns matched
 * against folded text are written in the folded spelling.
 */
export function foldArabic(text: string): string {
  return text.replace(DROP, "").replace(LETTERS_RE, (c) => LETTERS.get(c)!);
}

/**
 * The fold for word search and masking: foldArabic(), and also ؤ ئ → ء,
 * Arabic-Indic digits → 0-9, and lower case. «المسؤول» and «المسئول» are one
 * word; «٢٠٢٧» is «2027». The same as app_search_fold() in the database.
 */
export function foldWords(text: string): string {
  return text.toLowerCase().replace(DROP, "").replace(SEARCH_RE, (c) => SEARCH.get(c)!);
}

// A leading «ال», also after و or ف and ب ك or ل («وال», «بال», «وبال»), or «لل» (ل + ال,
// also «ولل»), or else one of و ف ب ل ك, when at least three letters are left. The
// alternatives are longest first, so the first that matches is also the longest, as in
// the database's regular expressions (which take the longest match).
const PREFIX = /^(?:[وف]?[بكل]?ال(?=[ء-ي]{3})|[وف]?لل(?=[ء-ي]{3})|[وفبلك](?=[ء-ي]{3}))/;
// «للجنه» is ل + «اللجنه» as well as ل + ال + «جنه»: also the word after its first ل.
const LAM_LAM = /^[وف]?ل(?=ل[ء-ي]{3})/;
const ARABIC_WORD = /^[ء-ي]+$/;

/**
 * An Arabic word (already folded) without its leading prefix: «والشركه» → «شركه»,
 * «وبالمراجعه» → «مراجعه», «وشركه» → «شركه», «للنخبه» → «نخبه» (and «لنخبه»),
 * «للجنه» → «جنه» and «لجنه». Empty when there is none, the word is not Arabic, or
 * fewer than three letters would be left («بنك» stays «بنك»). Search keeps the word as
 * written too, so one that really starts with one of these letters («لجنه») still
 * matches and ranks above a passage that only shares the shorter form («جنه»). The same
 * as app_search_stems() in the database.
 */
export function searchStems(word: string): string[] {
  if (!ARABIC_WORD.test(word)) return [];
  const out = [word.replace(PREFIX, ""), word.replace(LAM_LAM, "")].filter((s) => s !== word);
  return [...new Set(out)];
}
