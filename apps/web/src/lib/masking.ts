// Pseudonymisation for text sent to a hosted model (docs/assistant.md).
// Known names become placeholders such as [ORG_1] before the text leaves,
// and the placeholders become the names again in what comes back. The
// mapping lives only in this request; people always see the real text.
// For a translation the database finds the names written in the text by the
// same rules (app_mask_terms_in, migration 0112): change both together.
import { foldWords } from "./arabic-fold";

/** Lengths of a name in the other language (name_alt), as the database checks them. */
export const NAME_ALT_LENGTH = { person: [2, 120], contact: [2, 200] } as const;

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
// The model sometimes drops the brackets ("PERSON_2"), so they are optional on the way back.
const PLACEHOLDER = /\[?(?<![\p{L}\p{N}_])(ORG|PERSON|DEPT|PLACE|EMAIL|PHONE)_(\d+)(?![\p{N}])\]?/gu;
// A placeholder right after the preposition ل (with و or ف before it), as «للنخبة» is sent.
const LAM_PLACEHOLDER = /(?<![\p{L}])([وف]?)ل\[(ORG|PERSON|DEPT|PLACE)_(\d+)\]/gu;

const ARABIC = /[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]/;
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const normalise = (s: string) => s.replace(/\p{M}/gu, "").replace(/\s+/g, " ").trim();
// Between the parts of a Latin name: "Al-Harbi", "Al Harbi", "Alharbi" and "Al‑Harbi" are one name.
const SEP = /[\s\-\u2010-\u2015'\u2019`\u02BF]+/g;
const SEP_RE = "[\\s\\-\\u2010-\\u2015'\\u2019`\\u02BF]*";

/**
 * How names are compared: marks gone, lower case; an Arabic name in the search fold
 * (foldWords: «احمد» is «أحمد», «ريـــم» is «ريم»); a Latin name without separators,
 * with "el" read as "al".
 */
function keyOf(s: string) {
  const n = normalise(s).toLowerCase();
  if (ARABIC.test(n)) return foldWords(n);
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

// The letters the search fold reads as each letter of a folded Arabic name.
const ARABIC_VARIANTS: Record<string, string> = { "ا": "اأإآٱ", "ي": "يى", "ه": "هة", "ء": "ءؤئ" };
for (let d = 0; d <= 9; d++) ARABIC_VARIANTS[String(d)] = `${d}${String.fromCharCode(0x660 + d, 0x6f0 + d)}`;

/** A folded Arabic name's letters as a pattern: each in every spelling the fold joins, tatweel allowed after any of them («ريـــم»). */
function arabicLetters(folded: string) {
  return folded
    .split(" ")
    .map((word) => [...word].map((c) => `${ARABIC_VARIANTS[c] ? `[${ARABIC_VARIANTS[c]}]` : escape(c)}ـ*`).join(""))
    .join("\\s+");
}

/**
 * The pattern for one Arabic name, in the search fold. A name that starts with «ال» is
 * also found after ل, where Arabic writes «لل» («للنخبة» is ل + «النخبة»): only the part
 * after that ل is matched, so what is sent reads «ل[ORG_1]».
 */
function arabicPattern(folded: string) {
  const end = "(?![\\p{L}])";
  const name = arabicLetters(folded) + end;
  return folded.startsWith("ال") ? `${name}|(?<=ل)ل${arabicLetters(folded.slice(2))}${end}` : name;
}

/** The masking a request uses. Without terms (masking off) both directions leave text as it is. */
export function createMasker(terms: MaskTerm[], opts: { places?: boolean } = {}): Masker {
  const kindOf = new Map<string, MaskKind>();
  // One written form of each name, to build its pattern from: an Arabic name's folded key.
  const formOf = new Map<string, string>();
  // The record each name belongs to, so "Al-Nukhba Holding" and "شركة النخبة القابضة" are one [ORG_n].
  const entityOf = new Map<string, string>();
  const add = (kind: MaskKind, raw: string, entity?: string | null) => {
    const term = normalise(raw);
    const key = keyOf(term);
    if (term.length < 3 || key.length < 3 || kindOf.has(key)) return;
    kindOf.set(key, kind);
    formOf.set(key, ARABIC.test(key) ? key : term.toLowerCase());
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
  // need whole words; Arabic ones may carry a prefix (و، ب، ل، ال) before them,
  // and are found in every spelling the search fold joins (arabicPattern).
  const names = [...kindOf.keys()].sort((a, b) => b.length - a.length).map((k) => formOf.get(k)!);
  const pattern = names.length
    ? new RegExp(
        names
          .map((n) => (ARABIC.test(n) ? arabicPattern(n) : `(?<![\\p{L}\\p{N}])${latinPattern(n)}(?![\\p{L}\\p{N}])`))
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
        .replace(pattern, (m) => {
          // «للنخبة» matches as «لنخبة», after its first ل: the name is «النخبة».
          const surface = kindOf.has(keyOf(m)) || !kindOf.has(keyOf(`ا${m}`)) ? m : `ا${m}`;
          return placeholder(kindOf.get(keyOf(surface)) ?? "ORG", surface);
        });
    },
    unmask(text) {
      return (
        text
          // «ل[ORG_1]» for «النخبة» is written back «للنخبة», as it was.
          .replace(LAM_PLACEHOLDER, (m, pre: string, kind: string, n: string) => {
            const name = original.get(`[${kind}_${n}]`);
            return name && ARABIC.test(name) && foldWords(name).startsWith("ال") ? `${pre}ل${name.slice(1)}` : m;
          })
          .replace(PLACEHOLDER, (m, kind: string, n: string) => original.get(`[${kind}_${n}]`) ?? m)
      );
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
