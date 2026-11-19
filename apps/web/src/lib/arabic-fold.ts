// One spelling for Arabic text before it is matched against word lists, so a
// pattern written once reads every way the same word is typed: no short
// vowels, nunation or shadda (both «نظامًا» and «نظاماً» become «نظاما»), no
// tatweel («ممتـثلة»), one alef (أ إ آ ٱ → ا), ى → ي and ة → ه. Patterns
// matched against folded text are written in the folded spelling.
export function foldArabic(text: string): string {
  return text
    .replace(/[ً-ٰٟـ]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه");
}
