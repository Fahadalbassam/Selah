// Pseudonymisation for text sent to a hosted model (docs/assistant.md).
// Known names become placeholders such as [ORG_1] before the text leaves,
// and the placeholders become the names again in what comes back. The
// mapping lives only in this request; people always see the real text.

export type MaskKind = "ORG" | "PERSON" | "DEPT" | "PLACE" | "EMAIL" | "PHONE";

export interface MaskTerm {
  kind: string;
  term: string;
  /** The record the name belongs to: its names in both languages share one placeholder. */
  entity?: string | null;
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
// Between the parts of a Latin name: "Al-Harbi", "Al Harbi", "Alharbi" and "Al‑Harbi" are one name.
const SEP = /[\s\-\u2010-\u2015'\u2019`\u02BF]+/g;
const SEP_RE = "[\\s\\-\\u2010-\\u2015'\\u2019`\\u02BF]*";

/** How names are compared: marks gone, lower case; a Latin name also without separators, with "el" read as "al". */
function keyOf(s: string) {
  const n = normalise(s).toLowerCase();
  if (ARABIC.test(n)) return n;
  return n
    .split(SEP)
    .map((t) => t.replace(/^el(?=\p{L}{3})|^el$/u, "al"))
    .join("");
}

/** The pattern for one Latin name, allowing the spellings keyOf() treats as the same. */
function latinPattern(term: string) {
  return term
    .toLowerCase()
    .split(SEP)
    .filter(Boolean)
    .map((t) => {
      const al = /^(?:al|el)(?=\p{L}{3})|^(?:al|el)$/u.exec(t);
      return al ? `[ae]l${SEP_RE}${escape(t.slice(2))}` : escape(t);
    })
    .join(SEP_RE);
}

/** The masking a request uses. Without terms (masking off) both directions leave text as it is. */
export function createMasker(terms: MaskTerm[], opts: { places?: boolean } = {}): Masker {
  const kindOf = new Map<string, MaskKind>();
  // One written form of each name, to build its pattern from.
  const formOf = new Map<string, string>();
  // The record each name belongs to, so "Al-Nukhba Holding" and "شركة النخبة القابضة" are one [ORG_n].
  const entityOf = new Map<string, string>();
  const add = (kind: MaskKind, raw: string, entity?: string | null) => {
    const term = normalise(raw);
    const key = keyOf(term);
    if (term.length < 3 || key.length < 3 || kindOf.has(key)) return;
    kindOf.set(key, kind);
    formOf.set(key, term.toLowerCase());
    if (entity) entityOf.set(key, entity);
  };
  for (const t of terms) {
    const kind = (["ORG", "PERSON", "DEPT", "PLACE"].includes(t.kind) ? t.kind : "ORG") as MaskKind;
    add(kind, t.term, t.entity);
    // "Reem Al-Harbi" is also written "Reem" or "Al-Harbi".
    if (kind === "PERSON") {
      for (const part of normalise(t.term).split(/\s+/)) {
        if (part.length >= 4 && !NAME_PARTS_KEPT.has(part.toLowerCase())) add("PERSON", part, t.entity);
        // "Al-Harbi" is also written "Harbi".
        const bare = /^(?:al|el)[-\u2010-\u2015](\p{L}{4,})$/iu.exec(part)?.[1];
        if (bare) add("PERSON", bare, t.entity);
      }
    }
  }
  if (opts.places ?? terms.length > 0) for (const p of PLACES) add("PLACE", p);

  // Longest first, so "Al-Nukhba Holding" wins over "Al-Nukhba". Latin names
  // need whole words; Arabic ones may carry a prefix (و، ب، ل، ال) before them.
  const names = [...kindOf.keys()].sort((a, b) => b.length - a.length).map((k) => formOf.get(k)!);
  const pattern = names.length
    ? new RegExp(
        names
          .map((n) =>
            ARABIC.test(n)
              ? `${escape(n).replace(/ /g, "\\s+")}(?![\\p{L}])`
              : `(?<![\\p{L}\\p{N}])${latinPattern(n)}(?![\\p{L}\\p{N}])`,
          )
          .join("|"),
        "giu",
      )
    : null;

  const placeholderOf = new Map<string, string>();
  const original = new Map<string, string>();
  const counts = new Map<MaskKind, number>();
  const placeholder = (kind: MaskKind, surface: string) => {
    const name = keyOf(surface);
    const key = entityOf.get(name) ?? `${kind}:${name}`;
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
        .replace(pattern, (m) => placeholder(kindOf.get(keyOf(m)) ?? "ORG", m));
    },
    unmask(text) {
      return text.replace(PLACEHOLDER, (m) => original.get(m) ?? m);
    },
    get replaced() {
      return original.size;
    },
  };
}

/** Split what the admin typed into short names: one per line or comma (Arabic comma too). */
export function parseShortNames(text: string): string[] {
  const names = text
    .split(/[\n,،]+/)
    .map((n) => n.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  return [...new Set(names)];
}
