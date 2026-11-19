// Personal numbers in what the assistant reads (section 7, item 6). Plain
// code, no AI model: digits are read in every way they are written (٠-٩,
// ۰-۹, 0-9), invisible characters (zero-width marks, direction marks, soft
// hyphen, tatweel, combining marks) are dropped, separators between digit
// groups (spaces, dashes, dots, slashes, brackets, a line break) are
// allowed, and each kind is confirmed by its own check where it has one:
//   ID        Saudi national ID: 10 digits starting 1, check digit (Luhn)
//   IQAMA     resident ID: 10 digits starting 2, check digit (Luhn)
//   IBAN      SA + 22 (or another country's length), mod-97, any letter case
//   CARD      13 to 19 digits starting 2 to 6, Luhn
//   PHONE     Saudi mobile and landline forms, and international with + or 00
//   EMAIL     an e-mail address
//   PASSPORT  a passport number, only right after the word (passport / جواز)
//   CR        a commercial registration number, only right after the word (CR / سجل تجاري)
// Found numbers become tags ([ID_1], [IBAN_1]) in what the assistant reads,
// the index and every model request; the stored file never changes. The same
// number gets the same tag within one tagger (one file, or one request).
// Dates, amounts with thousands commas, years, decimals and codes glued to a
// Latin letter ("INV-2026-00123") are left alone; an Arabic letter written
// against a number («الهوية1012345672») does not hide it.
//
// Every step is linear in the length of the text (a hand-written scan, and
// regular expressions only of fixed or bounded length): text from anyone,
// a question included, can never make it slow (review B1 of #213).

export const NUMBER_KINDS = ["ID", "IQAMA", "IBAN", "CARD", "PHONE", "EMAIL", "PASSPORT", "CR"] as const;
export type NumberKind = (typeof NUMBER_KINDS)[number];
/** How many different numbers of each kind (kinds with none left out). */
export type NumberCounts = Partial<Record<NumberKind, number>>;

export interface FoundNumber {
  kind: NumberKind;
  start: number;
  end: number;
  /** As written. */
  text: string;
  /** Digits (and letters) only, in ASCII upper case: the same number written two ways has one value. */
  value: string;
}

/** Arabic-Indic and Persian digits as 0-9. One character for one, so positions stay. */
export function asciiDigits(text: string): string {
  return text.replace(/[٠-٩۰-۹]/g, (c) => String(c.charCodeAt(0) & 0xf));
}

// Dropped before scanning (positions kept through a map): zero-width space, joiners, word
// joiner, byte-order mark, soft hyphen, tatweel, direction marks and isolates, combining marks.
const INVISIBLE = /[​-‏⁠﻿­ـ؜‪-‮⁦-⁩\p{M}]/u;

/**
 * The text as the scan reads it: invisible characters out, odd spaces as spaces, digits in
 * ASCII; `at[i]` is where character i was in the original, so a finding maps back exactly.
 */
function readable(text: string): { s: string; at: number[] | null } {
  // Most text has nothing to drop or change: read as it is (positions are its own). Digits and
  // odd spaces change one character for one, so positions stay too; only dropping needs a map.
  if (!NEEDS_READING.test(text)) return { s: text, at: null };
  if (!INVISIBLE.test(text)) return { s: asciiDigits(text).replace(/[    	]/g, " "), at: null };
  // Built as a list and joined once: a string grown a character at a time is slow to read back.
  const out: string[] = [];
  const at: number[] = [];
  for (let i = 0; i < text.length; i++) {
    let c = text[i]!;
    const code = text.charCodeAt(i);
    if (code >= 0x300 && INVISIBLE.test(c)) continue;
    if (code === 0x00ad) continue;
    if (code === 0xa0 || code === 0x2007 || code === 0x2009 || code === 0x202f || code === 9) c = " ";
    else if ((code >= 0x660 && code <= 0x669) || (code >= 0x6f0 && code <= 0x6f9)) c = String(code & 0xf);
    out.push(c);
    at.push(i);
  }
  at.push(text.length);
  return { s: out.join(""), at };
}
const NEEDS_READING = /[̀-ͯ҃-҉֑-ׇؐ-؜ـً-ٟ٠-ٰۖ-ۭ۰-۹ ­\t   ​-‏⁠﻿‪-‮⁦-⁩᪰-᫿᷀-᷿⃐-⃿︠-︯]/u;

const isDigit = (c: string | undefined) => c !== undefined && c >= "0" && c <= "9";
/** What may not touch a number: only a Latin letter, a digit or "_" (an Arabic letter may). */
const isLatinWord = (c: string | undefined) => c !== undefined && ((c >= "A" && c <= "Z") || (c >= "a" && c <= "z") || (c >= "0" && c <= "9") || c === "_");

const luhn = (digits: string) => {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = digits.charCodeAt(digits.length - 1 - i) - 48;
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
};

/** ISO 13616: the first four characters moved to the end, letters as 10 to 35, the whole mod 97 is 1. */
const ibanChar = (c: string | undefined, letter: boolean) => c !== undefined && ((c >= "0" && c <= "9") || (letter && c >= "A" && c <= "Z"));
const ibanValid = (iban: string) => {
  let rest = 0;
  for (let k = 0; k < iban.length; k++) {
    const code = iban.charCodeAt((k + 4) % iban.length);
    rest = code >= 65 ? (rest * 100 + (code - 55)) % 97 : (rest * 10 + (code - 48)) % 97;
  }
  return rest === 1;
};
// IBAN lengths of the countries a Saudi firm meets most; any other country 15 to 34.
// Only these countries are read, each at its own length: any two letters and two digits would
// otherwise start one in ordinary text ("to 2026 ...").
const IBAN_LENGTH: Record<string, number> = {
  SA: 24, AE: 23, BH: 22, KW: 30, QA: 29, OM: 23, JO: 30, EG: 29, LB: 28, IQ: 23, TR: 26, PK: 24,
  GB: 22, IE: 22, DE: 22, FR: 27, ES: 24, IT: 27, NL: 18, BE: 16, CH: 21, AT: 20, SE: 24,
};

// Words a number of that kind follows. Each is a short, fixed alternation, matched at one
// place at a time and never repeated, so it stays linear.
const PASSPORT_WORD = /(?<![A-Za-z])passport(?![A-Za-z])|جواز/giu;
const CR_WORD = /(?<![A-Za-z])(?:C\.?R\.?|commercial registration)(?![A-Za-z])|سجل ?(?:ال)?تجاري/giu;
// Joining words between a word and its number ("Passport No.", «جواز السفر رقم»), and marks.
const JOINERS = ["number", "num", "no", "nr", "the", "السفر", "سفر", "رقمها", "رقمه", "رقم", "هو", "ال"];
const JOIN_MARKS = " \n\r:：#.|-–—()";
const ARABIC_LETTER = /[ء-ي]/;
const LATIN_LETTER = /[A-Za-z]/;
/** A joining word written at s[i..], as a whole word (an Arabic one may run into the next). */
const joinerAt = (s: string, i: number) =>
  JOINERS.find((w) => s.slice(i, i + w.length).toLowerCase() === w && (ARABIC_LETTER.test(w[0]!) || !LATIN_LETTER.test(s[i + w.length] ?? "")));
/** A joining word ending at s[..i]. */
const joinerBefore = (s: string, i: number) =>
  JOINERS.find((w) => i >= w.length && s.slice(i - w.length, i).toLowerCase() === w && (ARABIC_LETTER.test(w[0]!) || !LATIN_LETTER.test(s[i - w.length - 1] ?? "")));

/** After a word (passport, CR): past the joining words and marks, where its number starts (at most 40 characters on). */
function afterJoiners(s: string, from: number): number {
  let i = from;
  const limit = Math.min(s.length, from + 40);
  while (i < limit) {
    if (JOIN_MARKS.includes(s[i]!)) i++;
    else {
      const w = joinerAt(s, i);
      if (!w) break;
      i += w.length;
    }
  }
  return i;
}

/** Before a number: back past the joining words and marks, to where the word saying what it is ends (at most 40 characters back). */
function beforeJoiners(s: string, from: number): number {
  let i = from;
  const limit = Math.max(0, from - 40);
  while (i > limit) {
    if (JOIN_MARKS.includes(s[i - 1]!)) i--;
    else {
      const w = joinerBefore(s, i);
      if (!w) break;
      i -= w.length;
    }
  }
  return i;
}

// Saying the number after it is an ID or Iqama number: then it may be written in groups ("1012 345 672").
const ID_WORD = /(?:(?<![A-Za-z])(?:national id|id|identity|iqama|civil id)|هوي[ةه]|[إا]قام[ةه]|سجل مدني)$/iu;
// Saying the number after it is a document's own, or an amount: it is not read as a phone, an ID or
// an Iqama number (a contract number passes the ID check digit one time in ten).
const DOC_WORD = /(?:(?<![A-Za-z])(?:po|p\.o|ref|reference|contract|invoice|inv|order|file|case|ticket|doc|document|tender|amount|total|sar|price|budget)|(?:ال)?(?:عقد|طلب|فاتور[ةه]|مرجع|ملف|معامل[ةه]))$/iu;
/** Whether the word before a number (past its joining words) is one of these: at most 60 characters read, so linear overall. */
const wordBefore = (s: string, i: number, word: RegExp) => {
  const j = beforeJoiners(s, i);
  return word.test(s.slice(Math.max(0, j - 20), j));
};

/**
 * What a run of digits (separators already dropped) is, if anything: `n` digits starting with
 * `head` (the first five); `digits()` gives them all, asked only for a check digit. `whole`:
 * written as one block; an ID or Iqama number is read from groups only after its word ("ID:
 * 1012 345 672"), since joined groups of other numbers ("44 20 7946 0958") pass a check digit
 * one time in ten. Plain comparisons, not patterns: this runs for every candidate in a long run.
 */
/** Groups g to h of a run, joined only when a check digit or the value is needed. */
interface Digits {
  text: string;
  groups: { s: number; e: number }[];
  g: number;
  h: number;
}
function joined(x: Digits): string {
  let out = "";
  for (let k = x.g; k <= x.h; k++) out += x.text.slice(x.groups[k]!.s, x.groups[k]!.e);
  return out;
}

const in17 = (c: string | undefined) => c !== undefined && c >= "1" && c <= "7";

function kindOfDigits(n: number, head: string, digits: Digits, plus: boolean, whole: boolean, docNumber: boolean): NumberKind | null {
  // Nothing here is shorter than 8 digits: most candidates stop at this line.
  if (n < 8) return null;
  const c0 = head[0]!;
  const c1 = head[1]!;
  if (plus) {
    // An international number: + and a country code (never 0), 10 to 15 digits in all ("+12500000" is a change, not a phone).
    return c0 !== "0" && n >= 10 && n <= 15 && !docNumber ? "PHONE" : null;
  }
  if (whole && !docNumber && n === 10 && (c0 === "1" || c0 === "2") && luhn(joined(digits))) return c0 === "1" ? "ID" : "IQAMA";
  if (n >= 13 && c0 >= "2" && c0 <= "6" && luhn(joined(digits))) return "CARD";
  if (docNumber) return null;
  // 00 and a country code (which never starts with 0).
  if (c0 === "0" && c1 === "0") return head[2] !== "0" && n >= 10 && n <= 17 ? "PHONE" : null;
  // Saudi forms: 05x xxx xxxx and 5x xxx xxxx; 966 5x xxx xxxx; landline 01x xxx xxxx (also the
  // older 01 xxx xxxx); 966 1x xxx xxxx; 800 and 9200 numbers.
  if ((n === 10 && c0 === "0" && c1 === "5") || (n === 9 && c0 === "5")) return "PHONE";
  if (n === 12 && head.startsWith("9665")) return "PHONE";
  if (n === 10 && c0 === "0" && c1 === "1" && in17(head[2])) return "PHONE";
  if (n === 12 && head.startsWith("9661") && in17(head[4])) return "PHONE";
  if (n === 9 && c0 === "0" && in17(c1)) return "PHONE";
  if ((n === 10 && head.startsWith("800")) || (n === 9 && head.startsWith("9200"))) return "PHONE";
  return null;
}

/** Between two digit groups of one number: 1 to 3 spaces, or one of - . / ( ) or a line break with spaces around. */
function separatorEnd(s: string, i: number): number {
  let j = i;
  let spaces = 0;
  while (s[j] === " " && spaces < 3) {
    j++;
    spaces++;
  }
  if (s[j] === "\n" || s[j] === "\r") {
    if (s[j] === "\r" && s[j + 1] === "\n") j++;
    j++;
    let k = 0;
    while (s[j] === " " && k < 3) {
      j++;
      k++;
    }
  } else if (s[j] !== undefined && "-–./()".includes(s[j]!)) {
    j++;
    // "(011) 234": a closing bracket and a space; "050 - 123": a space after the dash.
    if (s[j] === ")" || s[j] === "(") j++;
    let k = 0;
    while (s[j] === " " && k < 2) {
      j++;
      k++;
    }
  }
  return isDigit(s[j]) && j > i ? j : -1;
}

/**
 * Every personal number in a text, in order, never overlapping. A run of groups may hold
 * more than one number ("1012345672 2123456788"): from each group the longest run of whole
 * groups that is a number is taken.
 */
export function findNumbers(text: string): FoundNumber[] {
  const { s, at } = readable(text);
  const found: FoundNumber[] = [];
  const taken = new Uint8Array(s.length + 1);
  const add = (kind: NumberKind, start: number, end: number, value: string) => {
    for (let i = start; i < end; i++) if (taken[i]) return;
    taken.fill(1, start, end);
    const a = at ? at[start]! : start;
    const b = at ? at[end - 1]! + 1 : end;
    found.push({ kind, start: a, end: b, text: text.slice(a, b), value });
  };

  // E-mails, from each "@": the address around it, at most 64 characters before and 255 after.
  const local = /[\p{L}\p{N}._%+-]/u;
  const domain = /[\p{L}\p{N}.-]/u;
  for (let i = s.indexOf("@"); i >= 0; i = s.indexOf("@", i + 1)) {
    let a = i;
    while (a > 0 && i - a < 64 && local.test(s[a - 1]!)) a--;
    let b = i + 1;
    while (b < s.length && b - i < 256 && domain.test(s[b]!)) b++;
    while (b > i + 1 && (s[b - 1] === "." || s[b - 1] === "-")) b--;
    while (a < i && s[a] === ".") a++;
    const host = s.slice(i + 1, b);
    const dot = host.lastIndexOf(".");
    if (a < i && dot > 0 && /^\p{L}{2,}$/u.test(host.slice(dot + 1))) add("EMAIL", a, b, s.slice(a, b).toLowerCase());
  }

  // Next to their word first: a CR number would otherwise be read as an ID.
  for (const m of s.matchAll(PASSPORT_WORD)) {
    const i = afterJoiners(s, m.index + m[0].length);
    const n = /^(?:[A-Za-z]{1,2}[ -]?)?\d{6,9}(?![A-Za-z0-9])/.exec(s.slice(i, i + 16));
    if (n && !isLatinWord(s[i - 1])) add("PASSPORT", i, i + n[0].length, n[0].toUpperCase().replace(/[^0-9A-Z]/g, ""));
  }
  for (const m of s.matchAll(CR_WORD)) {
    const i = afterJoiners(s, m.index + m[0].length);
    const n = /^\d{10}(?![A-Za-z0-9])/.exec(s.slice(i, i + 12));
    if (n && !isLatinWord(s[i - 1])) add("CR", i, i + 10, n[0]);
  }

  // IBANs: a country's two letters (either case) and two check digits, then letters and digits in
  // groups split by a space, dot, dash or line break. Written in lower case, only digits follow (so
  // ordinary words are never read into one); in capitals, capital letters may (bank codes).
  for (const m of s.matchAll(/(?<![A-Za-z0-9])[A-Za-z]{2}(?=[ .\-]?\d{2})/g)) {
    const country = m[0].toUpperCase();
    const want = IBAN_LENGTH[country];
    if (!want) continue;
    // Written in capitals, a bank code's capital letters may follow the check digits (the next four
    // characters only); in lower case, only digits.
    const caps = m[0] === country;
    const chars: number[] = [m.index, m.index + 1];
    let j = m.index + 2;
    while (j < s.length && chars.length < want) {
      if (ibanChar(s[j], caps && chars.length < 8)) {
        chars.push(j++);
        continue;
      }
      const next = s[j] === " " || s[j] === "." || s[j] === "-" || s[j] === "\n" ? j + 1 : -1;
      if (next > 0 && ibanChar(s[next], caps && chars.length < 8)) {
        j = next;
        continue;
      }
      break;
    }
    if (chars.length < want) continue;
    const end = chars[want - 1]! + 1;
    // It ends where a group ends (what follows may be another number).
    if (isLatinWord(s[end])) continue;
    const iban = chars
      .map((c) => s[c]!)
      .join("")
      .toUpperCase();
    if (ibanValid(iban)) add("IBAN", m.index, end, iban);
  }

  // Runs of digit groups, by hand.
  for (let i = 0; i < s.length; ) {
    if (!isDigit(s[i]) || taken[i]) {
      i++;
      continue;
    }
    // Where the run starts: a "+" just before ("+966"), and a bracket ("(011)", "(+966)"), belong to it.
    let start = i;
    let plus = false;
    if (s[start - 1] === "+") {
      start--;
      plus = true;
    }
    if (s[start - 1] === "(") start--;
    const groups: { s: number; e: number }[] = [];
    let j = i;
    for (;;) {
      let e = j;
      while (isDigit(s[e])) e++;
      groups.push({ s: j, e });
      const next = separatorEnd(s, e);
      if (next < 0 || taken[next]) {
        j = e;
        break;
      }
      j = next;
    }
    // Not part of a code or a word: no Latin letter, digit or "_" against it, also across a dash
    // ("INV-2026-00123"); an Arabic letter is fine («رقم الهوية1012345672»).
    const glued = isLatinWord(s[start - 1]) || (s[start - 1] === "-" && isLatinWord(s[start - 2]));
    if (!glued) {
      const idWord = wordBefore(s, start, ID_WORD);
      const docWord = wordBefore(s, start, DOC_WORD);
      for (let g = 0; g < groups.length; ) {
        let best: { h: number; kind: NumberKind } | null = null;
        let n = 0;
        let head = "";
        // At most 19 digits from one group on: bounded, so a long run stays linear.
        // A number written in groups has groups of two digits or more (one digit first only after "+"),
        // at most six of them.
        for (let h = g; h < groups.length && h - g < 6 && n + groups[h]!.e - groups[h]!.s <= 19; h++) {
          const size = groups[h]!.e - groups[h]!.s;
          if (h > g && (size < 2 || (groups[g]!.e - groups[g]!.s < 2 && !(plus && g === 0)))) break;
          n += size;
          if (head.length < 5) head = (head + s.slice(groups[h]!.s, groups[h]!.e)).slice(0, 5);
          const after = s[groups[h]!.e];
          if (isLatinWord(after)) continue;
          // An amount's decimals ("1012345672.50") or a number after a decimal point is no ID.
          const decimal = (after === "." || after === ",") && isDigit(s[groups[h]!.e + 1]) && !isDigit(s[groups[h]!.e + 3]);
          const prev = s[groups[g]!.s - 1];
          const afterPoint = (prev === "." || prev === ",") && isDigit(s[groups[g]!.s - 2]);
          const whole = !decimal && !afterPoint && (h === g || (g === 0 && idWord));
          const kind = n < 8 ? null : kindOfDigits(n, head, { text: s, groups, g, h }, plus && g === 0, whole, docWord && g === 0);
          if (kind) best = { h, kind };
        }
        if (best) {
          add(best.kind, g === 0 ? start : groups[g]!.s, groups[best.h]!.e, joined({ text: s, groups, g, h: best.h }));
          g = best.h + 1;
        } else g++;
      }
    }
    i = Math.max(j, i + 1);
  }
  return found.sort((a, b) => a.start - b.start);
}

/** How many different numbers of each kind a text (or a file's pages) holds. */
export function countNumbers(texts: string | string[]): NumberCounts {
  const seen = new Map<NumberKind, Set<string>>();
  for (const text of typeof texts === "string" ? [texts] : texts) {
    for (const f of findNumbers(text)) seen.set(f.kind, (seen.get(f.kind) ?? new Set()).add(f.value));
  }
  const out: NumberCounts = {};
  for (const k of NUMBER_KINDS) if (seen.has(k)) out[k] = seen.get(k)!.size;
  return out;
}

/** A tag this module writes: [ID_1], [IBAN_12]; the last line's own are [ID_S1] (see `prefix`). */
export const NUMBER_TAG = new RegExp(`\\[(${NUMBER_KINDS.join("|")})_(\\d+)\\]`, "g");

export interface NumberTagger {
  /**
   * The text with each personal number replaced by its tag. Tags already in the text (a
   * passage indexed with its own) are numbered again for this tagger, keyed by `from` (the
   * file they came from), so two files' [ID_1] never read as one number.
   */
  tag(text: string, from?: string): string;
  /** Only numbers written out get a tag; tags already in the text stay as they are (an answer). */
  tagNew(text: string): string;
  /** Tags this tagger made back into the numbers they stand for (a translation shown to someone who reads the original). */
  restore(text: string): string;
  /** Different numbers tagged so far, by kind. */
  readonly counts: NumberCounts;
  /** Different numbers tagged so far, all kinds. */
  readonly found: number;
}

/**
 * `prefix`: written before the tag's number ([ID_S1]), for a tagger whose tags must never be
 * read as another tagger's: the last check before the AI service (ai-client.ts, sealed()).
 */
export function createNumberTagger(opts: { prefix?: string } = {}): NumberTagger {
  const prefix = opts.prefix ?? "";
  const tagOf = new Map<string, string>();
  const textOf = new Map<string, string>();
  const n = new Map<NumberKind, number>();
  const counts: NumberCounts = {};
  const tagFor = (kind: NumberKind, key: string, written: string | null) => {
    let tag = tagOf.get(`${kind}:${key}`);
    if (!tag) {
      const next = (n.get(kind) ?? 0) + 1;
      n.set(kind, next);
      tag = `[${kind}_${prefix}${next}]`;
      tagOf.set(`${kind}:${key}`, tag);
      if (written !== null) {
        textOf.set(tag, written);
        counts[kind] = (counts[kind] ?? 0) + 1;
      }
    }
    return tag;
  };
  const tagRaw = (text: string) => {
    const found = findNumbers(text);
    if (!found.length) return text;
    let out = "";
    let at = 0;
    for (const f of found) {
      out += text.slice(at, f.start) + tagFor(f.kind, f.value, f.text);
      at = f.end;
    }
    return out + text.slice(at);
  };
  return {
    tag(text, from = "") {
      // Tags already there first, so a number found below never takes their place.
      return tagRaw(text.replace(NUMBER_TAG, (_m, kind: NumberKind, k: string) => tagFor(kind, `tag:${from}:${k}`, null)));
    },
    tagNew: tagRaw,
    restore(text) {
      return text.replace(NUMBER_TAG, (m) => textOf.get(m) ?? m);
    },
    get counts() {
      return { ...counts };
    },
    get found() {
      return textOf.size;
    },
  };
}

/** True when a text still holds a personal number as written (the check on what goes out and what is kept). */
export const hasRawNumbers = (text: string) => findNumbers(text).length > 0;

/** Counts as one number, all kinds. */
export const totalNumbers = (c: NumberCounts | null | undefined) => Object.values(c ?? {}).reduce((a, b) => a + (b ?? 0), 0);
