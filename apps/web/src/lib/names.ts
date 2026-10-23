/**
 * A record's name in the reader's language. Organisations and templates have
 * an English name and an optional Arabic one; departments and expertise areas
 * have an Arabic name and an optional English one. The other language is the
 * fallback in both cases.
 */
export function localName(n: { name: string; nameAr?: string | null }, ar: boolean): string {
  return (ar ? n.nameAr : null) ?? n.name;
}

export function localLabel(n: { nameAr: string; nameEn?: string | null }, ar: boolean): string {
  return ar ? n.nameAr : (n.nameEn ?? n.nameAr);
}
