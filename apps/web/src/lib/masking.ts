// Pseudonymisation for text sent to a hosted model (docs/assistant.md).
// Known names become placeholders such as [ORG_1] before the text leaves,
// and the placeholders become the names again in what comes back. The
// mapping lives only in this request; people always see the real text.
// For a translation the database finds the names written in the text by the
// same rules (app_mask_terms_in, migration 0112): change both together.
// Personal numbers (IDs, IBANs, cards, phones, e-mails) are tagged first by the number
// scanner (sensitive-numbers.ts), with or without masking, and never put back.
import { foldWords } from "./arabic-fold";
import type { NumberTagger } from "./sensitive-numbers";

/** Lengths of a name in the other language (name_alt), as the database checks them. */
export const NAME_ALT_LENGTH = { person: [2, 120], contact: [2, 200] } as const;

/** NUMBER: a long run of digits the number scanner did not take as a personal number (masked, then put back). */
export type MaskKind = "ORG" | "PERSON" | "DEPT" | "PLACE" | "EMAIL" | "PHONE" | "NUMBER";

export interface MaskTerm {
  kind: string;
  term: string;
  /** The record the name belongs to: its names in both languages share one placeholder. */
  entity?: string | null;
}

export interface Masker {
  /** `from`: the file a passage came from, so the number tags it was indexed with stay apart from another file's. */
  mask(text: string, from?: string): string;
  /** Names back; a personal number's tag stays a tag. */
  unmask(text: string): string;
  /** How many different names were replaced so far. */
  readonly replaced: number;
  /** The number scanner this masking tags with first, when it has one. */
  readonly numbers: NumberTagger | null;
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
// A placeholder right after the preposition ل (with و or ف before it, tatweel after it) is
// read with that ل: «ل[ORG_1]» is written back «للنخبة» for «النخبة», «لآل سعود» for «آل سعود».
const PLACEHOLDER = /(?:(?<![\p{L}])([وف]?)(لـ*)(?=\[))?\[?(?<![\p{L}\p{N}_])(ORG|PERSON|DEPT|PLACE|EMAIL|PHONE|NUMBER)_(\d+)(?![\p{N}])\]?/gu;

const ARABIC = /[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]/;
const LETTER = /\p{L}/u;
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const normalise = (s: string) => s.replace(/\p{M}/gu, "").replace(/\s+/g, " ").trim();
// Between the parts of a Latin name: "Al-Harbi", "Al Harbi", "Alharbi" and "Al‑Harbi" are one name.
const SEP = /[\s\-\u2010-\u2015'\u2019`\u02BF]+/g;
const SEP_RE = "[\\s\\-\\u2010-\\u2015'\\u2019`\\u02BF]*";
// A digit in any of the three ways it is written: 2, ٢, ۲.
const digitClass = (d: string) => `[${d}${String.fromCharCode(0x660 + Number(d), 0x6f0 + Number(d))}]`;

/**
 * How names are compared: marks gone, in the search fold (foldWords: lower case, «احمد» is
 * «أحمد», «ريـــم» is «ريم», «٢٠٣٠» is «2030»); a Latin name also without separators, with
 * "el" read as "al".
 */
function keyOf(s: string) {
  const n = foldWords(normalise(s));
  if (ARABIC.test(n)) return n;
  return n
    .split(SEP)
    .map((t) => t.replace(/^el(?=\p{L}{3})|^el$/u, "al"))
    .join("");
}

/** The pattern for one Latin name, allowing the spellings keyOf() treats as the same. */
function latinPattern(term: string) {
  const part = (t: string) => [...t].map((c) => (/[0-9]/.test(c) ? digitClass(c) : escape(c))).join("");
  return foldWords(term)
    .split(SEP)
    .filter(Boolean)
    .map((t) => {
      const al = /^(?:al|el)(?=\p{L}{3})|^(?:al|el)$/u.exec(t);
      return al ? `[ae]l${SEP_RE}${part(t.slice(2))}` : part(t);
    })
    .join(SEP_RE);
}

// The letters the search fold reads as each letter of a folded Arabic name.
const ARABIC_VARIANTS: Record<string, string> = { "ا": "اأإآٱ", "ي": "يى", "ه": "هة", "ء": "ءؤئ" };
for (let d = 0; d <= 9; d++) ARABIC_VARIANTS[String(d)] = digitClass(String(d)).slice(1, -1);
// The article, written as such: a name that starts with it is written «لل» after ل.
const ARTICLE = /^[اٱ]ل/;
const ARTICLE_LAM = /^[اٱ]لل/;
const T = "ـ*";

/**
 * An Arabic name's letters (as the list writes it) as a pattern: each in every spelling the
 * search fold joins, tatweel allowed after any of them («ريـــم»). One exception: the last
 * word without the article keeps its ة, since a final «ه» there is usually a pronoun
 * («حكمه» is "his ruling", not «حكمة»); with the article, or inside a longer name, ة and ه
 * are one («النخبه», «رؤيه 2030»).
 */
function arabicLetters(form: string) {
  const words = form.split(" ");
  return words
    .map((word, w) => {
      const chars = [...word];
      const keepTa = w === words.length - 1 && !foldWords(word).startsWith("ال");
      return chars
        .map((c, i) => {
          if (c === "ة" && keepTa && i === chars.length - 1) return `ة${T}`;
          const f = foldWords(c) || c;
          return `${ARABIC_VARIANTS[f] ? `[${ARABIC_VARIANTS[f]}]` : escape(f)}${T}`;
        })
        .join("");
    })
    .join("\\s+");
}

/**
 * Where an Arabic name may start: at the start of a word, or after a prefix written on to it.
 * A name with the article takes و ف ب ك before it (after ل it is written «لل»: lamPattern;
 * ل is also allowed as written, for a name such as «الهام» typed for «إلهام», in «لإلهام»);
 * a person's name takes و ف ب ل; any other name also the article («والنخبة» for «نخبة»).
 * Never inside another word: «أمل» is not in «شامل» or «الكامل», «بشرى» not in «البشري».
 */
function arabicStart(form: string, kind: MaskKind) {
  const prefix = ARTICLE.test(form)
    ? `(?:[وف]${T})?(?:[بكل]${T})?`
    : kind === "PERSON"
      ? `(?:[وف]${T})?(?:[بل]${T})?`
      : `(?:(?:[وف]${T})?(?:[بكل]${T})?(?:ا${T}ل${T})?|(?:[وف]${T})?ل${T}ل${T})`;
  return `(?<=(?:^|[^\\p{L}])${prefix})`;
}

/**
 * A name with the article after ل, written «لل» («للنخبة» for «النخبة», «للجنة» for
 * «اللجنة», tatweel anywhere: «لـلنخبة»): only what follows the first ل is matched, so what
 * is sent reads «ل[ORG_1]».
 */
function lamPattern(form: string) {
  const rest = ARTICLE_LAM.test(form) ? form.slice(3) : form.slice(2);
  return `(?<=(?:^|[^\\p{L}])(?:[وف]${T})?ل${T})ل${T}${arabicLetters(rest)}(?![\\p{L}])`;
}

/** How a name was written where it was found. */
interface Spelling {
  text: string;
  /** For the «لل» form: what followed the first ل («لنخبة» of «للنخبة»). */
  lam?: string;
}

/**
 * The masking a request uses. Without terms (masking off) both directions leave text as it
 * is, except that with `numbers` personal numbers are always tagged first (masking on or off,
 * local model or hosted). The e-mails and phones the scanner leaves are its to judge: masking
 * then only hides a long run of digits as [NUMBER_n], so its placeholders never share a name
 * with the scanner's tags.
 */
export function createMasker(terms: MaskTerm[], opts: { places?: boolean; numbers?: NumberTagger } = {}): Masker {
  const kindOf = new Map<string, MaskKind>();
  // One written form of each name (marks gone), to build its pattern from.
  const formOf = new Map<string, string>();
  // The record each name belongs to, so "Al-Nukhba Holding" and "شركة النخبة القابضة" are one [ORG_n].
  const entityOf = new Map<string, string>();
  // A record's first Arabic name, for a placeholder after ل whose name the text only had in Latin.
  const arabicOf = new Map<string, string>();
  const groupOf = (kind: MaskKind, key: string) => entityOf.get(key) ?? `${kind}:${key}`;
  const add = (kind: MaskKind, raw: string, entity?: string | null) => {
    const term = normalise(raw);
    const key = keyOf(term);
    if (term.length < 3 || key.length < 3 || kindOf.has(key)) return;
    kindOf.set(key, kind);
    formOf.set(key, term);
    if (entity) entityOf.set(key, entity);
    const group = groupOf(kind, key);
    if (ARABIC.test(term) && !arabicOf.has(group)) arabicOf.set(group, term);
  };
  for (const t of terms) {
    const kind = (["ORG", "PERSON", "DEPT", "PLACE"].includes(t.kind) ? t.kind : "ORG") as MaskKind;
    add(kind, t.term, t.entity);
    // "Reem Al-Harbi" is also written "Reem" or "Al-Harbi".
    if (kind === "PERSON") {
      for (const part of normalise(t.term).split(/\s+/)) {
        if (part.length >= 4 && !NAME_PARTS_KEPT.has(part.toLowerCase())) add("PERSON", part, t.entity);
        // "Al-Harbi" is also written "Harbi".
        const bare = /^(?:al|el)[-‐-―](\p{L}{4,})$/iu.exec(part)?.[1];
        if (bare) add("PERSON", bare, t.entity);
      }
    }
  }
  if (opts.places ?? terms.length > 0) for (const p of PLACES) add("PLACE", p);

  // Longest first, so "Al-Nukhba Holding" wins over "Al-Nukhba". Latin names need whole
  // words; Arabic ones may carry a prefix written on to them (arabicStart) and are found in
  // every spelling the search fold joins. Each way of finding a name is a group of its own,
  // so a match says which name it is and whether it was the «لل» form.
  const ways: { key: string; lam: boolean; source: string }[] = [];
  for (const key of [...kindOf.keys()].sort((a, b) => b.length - a.length)) {
    const form = formOf.get(key)!;
    if (!ARABIC.test(form)) {
      ways.push({ key, lam: false, source: `(?<![\\p{L}\\p{N}])${latinPattern(form)}(?![\\p{L}\\p{N}])` });
      continue;
    }
    ways.push({ key, lam: false, source: `${arabicStart(form, kindOf.get(key)!)}${arabicLetters(form)}(?![\\p{L}])` });
    if (ARTICLE.test(form)) ways.push({ key, lam: true, source: lamPattern(form) });
  }
  const pattern = ways.length ? new RegExp(ways.map((w) => `(${w.source})`).join("|"), "giu") : null;

  const placeholderOf = new Map<string, string>();
  // Every spelling each placeholder stood for, in the order they were found.
  const spellings = new Map<string, Spelling[]>();
  const arabicFor = new Map<string, string>();
  const counts = new Map<MaskKind, number>();
  const placeholder = (kind: MaskKind, key: string, spelling: Spelling) => {
    const group = groupOf(kind, key);
    let p = placeholderOf.get(group);
    if (!p) {
      const n = (counts.get(kind) ?? 0) + 1;
      counts.set(kind, n);
      p = `[${kind}_${n}]`;
      placeholderOf.set(group, p);
      spellings.set(p, []);
      const ar = arabicOf.get(group);
      if (ar) arabicFor.set(p, ar);
    }
    spellings.get(p)!.push(spelling);
    return p;
  };
  const arabic = (s: Spelling) => ARABIC.test(s.text);

  const numbers = opts.numbers ?? null;
  return {
    mask(raw, from) {
      // Short vowels and other marks would hide a name (or a number written with them) from the match:
      // gone first, before the number scan (review S6 of #213).
      const bare = raw.replace(/\p{M}/gu, "");
      const text = numbers ? numbers.tag(bare, from) : bare;
      if (!pattern) return text;
      return text
        .replace(EMAIL, (m) => placeholder("EMAIL", keyOf(m), { text: m }))
        .replace(PHONE, (m) => placeholder(numbers ? "NUMBER" : "PHONE", keyOf(m), { text: m }))
        .replace(pattern, (m: string, ...groups: unknown[]) => {
          const way = ways[groups.findIndex((g) => g !== undefined)]!;
          // «للنخبة» matched as «لنخبة»: alone it is «النخبة» («اللجنة» for «للجنة»).
          const spelling = way.lam ? { text: (ARTICLE_LAM.test(formOf.get(way.key)!) ? "ال" : "ا") + m, lam: m } : { text: m };
          return placeholder(kindOf.get(way.key)!, way.key, spelling);
        });
    },
    unmask(text) {
      // Each placeholder gives back the spellings it stood for, in turn, so a text masked and
      // unmasked reads as it was written («احمد … أحمد», «٢٠٣٠ … 2030»); past the last, the first.
      const used = new Map<string, number>();
      return text.replace(
        PLACEHOLDER,
        (m: string, pre: string | undefined, lam: string | undefined, kind: string, n: string, offset: number) => {
          const p = `[${kind}_${n}]`;
          const list = spellings.get(p);
          if (!list?.length) return m;
          const k = used.get(p) ?? 0;
          used.set(p, k + 1);
          let s = list[k] ?? list[0]!;
          if (kind === "EMAIL" || kind === "PHONE" || kind === "NUMBER") return `${pre ?? ""}${lam ?? ""}${s.text}`;
          if (lam !== undefined) {
            // After ل the name is Arabic: a spelling found in Arabic, or the record's Arabic name.
            if (!arabic(s)) s = list.find((x) => arabic(x) && x.lam) ?? list.find(arabic) ?? (arabicFor.has(p) ? { text: arabicFor.get(p)! } : s);
            if (!arabic(s)) return `${pre}${lam}ـ ${s.text}`;
            if (s.lam !== undefined) return `${pre}${lam}${s.lam}`;
            // ل + «النخبة» is «للنخبة», ل + «اللجنة» «للجنة»; ل + «آل سعود» stays «لآل سعود».
            if (ARTICLE_LAM.test(s.text)) return `${pre}${lam}${s.text.slice(2)}`;
            if (ARTICLE.test(s.text)) return `${pre}${lam}${s.text.slice(1)}`;
            return `${pre}${lam}${s.text}`;
          }
          // Between two Arabic words an Arabic spelling, between two Latin ones a Latin one.
          const before = text.slice(0, offset).trimEnd().slice(-1);
          const after = text.slice(offset + m.length).trimStart().charAt(0);
          if (LETTER.test(before) && LETTER.test(after) && ARABIC.test(before) === ARABIC.test(after) && arabic(s) !== ARABIC.test(before)) {
            s = list.find((x) => arabic(x) === ARABIC.test(before)) ?? s;
          }
          return s.text;
        },
      );
    },
    get replaced() {
      return spellings.size;
    },
    numbers,
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
