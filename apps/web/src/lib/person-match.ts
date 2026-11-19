import { foldArabic } from "@/lib/arabic-fold";

/**
 * One spelling for a person's name before a typed query is matched against it:
 * lower case, no Latin accents, and the Arabic fold (no short vowels or
 * tatweel, one alef, ى as ي, ة as ه). «سلمى» finds «سَلْمَى» and "Salma" finds
 * "salma", so a name in either language is found in either screen.
 */
export function foldName(text: string): string {
  return foldArabic(text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase());
}

/** Does the query appear in any of the person's texts (name in either language, email, role)? */
export function personMatches(texts: readonly (string | null | undefined)[], query: string): boolean {
  const q = foldName(query).trim();
  if (!q) return true;
  return texts.some((t) => !!t && foldName(t).includes(q));
}
