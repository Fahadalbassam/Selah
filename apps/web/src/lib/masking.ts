// Pseudonymisation for text sent to a hosted model (docs/assistant.md).
// Known names become placeholders such as [ORG_1] before the text leaves,
// and the placeholders become the names again in what comes back. The
// mapping lives only in this request; people always see the real text.

export type MaskKind = "ORG" | "PERSON" | "DEPT" | "PLACE" | "EMAIL" | "PHONE";

export interface MaskTerm {
  kind: string;
  term: string;
}

export interface Masker {
  mask(text: string): string;
  unmask(text: string): string;
  /** How many different names were replaced so far. */
  readonly replaced: number;
}

// Main Saudi cities, in both languages. Addresses aren't kept in Selah, so
// places come from this list rather than the database.
const PLACES = [
  ["Riyadh", "الرياض"],
  ["Jeddah", "جدة"],
  ["Makkah", "مكة"],
  ["Mecca", "مكة المكرمة"],
  ["Madinah", "المدينة المنورة"],
  ["Medina", "المدينة"],
  ["Dammam", "الدمام"],
  ["Khobar", "الخبر"],
  ["Dhahran", "الظهران"],
  ["Taif", "الطائف"],
  ["Tabuk", "تبوك"],
  ["Abha", "أبها"],
  ["Buraidah", "بريدة"],
  ["Qassim", "القصيم"],
  ["Hail", "حائل"],
  ["Jazan", "جازان"],
  ["Najran", "نجران"],
  ["Yanbu", "ينبع"],
  ["Jubail", "الجبيل"],
  ["Al-Ahsa", "الأحساء"],
].flat();

// Parts of a person's name too common to mask on their own.
const NAME_PARTS_KEPT = new Set(["al", "bin", "bint", "ibn", "abu", "abd", "abdul", "آل", "بن", "بنت", "ابن", "أبو", "ابو", "عبد"]);

const EMAIL = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.[\p{L}]{2,}/gu;
// Saudi and international numbers: +966 5x xxx xxxx, 05xxxxxxxx, 011 xxx xxxx.
const PHONE = /(?<![\p{N}])(?:\+|00)?\d(?:[\s-]?\d){8,13}(?![\p{N}])/gu;
const PLACEHOLDER = /\[(ORG|PERSON|DEPT|PLACE|EMAIL|PHONE)_(\d+)\]/g;

const ARABIC = /[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]/;
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const normalise = (s: string) => s.replace(/\p{M}/gu, "").replace(/\s+/g, " ").trim();

/** The masking a request uses. Without terms (masking off) both directions leave text as it is. */
export function createMasker(terms: MaskTerm[], opts: { places?: boolean } = {}): Masker {
  const kindOf = new Map<string, MaskKind>();
  const add = (kind: MaskKind, raw: string) => {
    const term = normalise(raw);
    if (term.length < 3 || kindOf.has(term.toLowerCase())) return;
    kindOf.set(term.toLowerCase(), kind);
  };
  for (const t of terms) {
    const kind = (["ORG", "PERSON", "DEPT", "PLACE"].includes(t.kind) ? t.kind : "ORG") as MaskKind;
    add(kind, t.term);
    // "Reem Al-Harbi" is also written "Reem" or "Al-Harbi".
    if (kind === "PERSON") {
      for (const part of normalise(t.term).split(/\s+/)) {
        if (part.length >= 4 && !NAME_PARTS_KEPT.has(part.toLowerCase())) add("PERSON", part);
      }
    }
  }
  if (opts.places ?? terms.length > 0) for (const p of PLACES) add("PLACE", p);

  // Longest first, so "Al-Nukhba Holding" wins over "Al-Nukhba". Latin names
  // need whole words; Arabic ones may carry a prefix (و، ب، ل، ال) before them.
  const names = [...kindOf.keys()].sort((a, b) => b.length - a.length);
  const pattern = names.length
    ? new RegExp(
        names
          .map((n) => {
            const body = escape(n).replace(/ /g, "\\s+");
            return ARABIC.test(n) ? `${body}(?![\\p{L}])` : `(?<![\\p{L}\\p{N}])${body}(?![\\p{L}\\p{N}])`;
          })
          .join("|"),
        "giu",
      )
    : null;

  const placeholderOf = new Map<string, string>();
  const original = new Map<string, string>();
  const counts = new Map<MaskKind, number>();
  const placeholder = (kind: MaskKind, surface: string) => {
    const key = `${kind}:${normalise(surface).toLowerCase()}`;
    let p = placeholderOf.get(key);
    if (!p) {
      const n = (counts.get(kind) ?? 0) + 1;
      counts.set(kind, n);
      p = `[${kind}_${n}]`;
      placeholderOf.set(key, p);
      original.set(p, surface);
    }
    return p;
  };

  return {
    mask(text) {
      if (!pattern) return text;
      // Short vowels and other marks would hide a name from the match.
      return text
        .replace(/\p{M}/gu, "")
        .replace(EMAIL, (m) => placeholder("EMAIL", m))
        .replace(PHONE, (m) => placeholder("PHONE", m))
        .replace(pattern, (m) => placeholder(kindOf.get(normalise(m).toLowerCase()) ?? "ORG", m));
    },
    unmask(text) {
      return text.replace(PLACEHOLDER, (m) => original.get(m) ?? m);
    },
    get replaced() {
      return original.size;
    },
  };
}
