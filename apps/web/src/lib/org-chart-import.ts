import { z } from "zod";
import type { DocBlock } from "./office/docx-read";
import { cleanSpecialties, nextCode, ORG_CHART_LIMITS, ORG_CODE, ORG_UNIT_KINDS, type OrgUnitKind } from "./org-chart";
import { compareCodes } from "./org-chart-tree";
import { asciiDigits, normText } from "./plan-import";

/**
 * Org chart, part 4: the ways a client's structure gets into the firm's
 * draft. The Excel template (its columns, both languages), a Word outline
 * (Heading 1, 2 and 3 are units at levels 1, 2 and 3; the bullets under a
 * heading are its positions), and the assistant's draft from pasted text
 * all become the same rows, and every row goes through the same checks
 * here before anything is saved. Pure, so the review screen and the server
 * run the very same checks: the screen to show each row's problems as the
 * person fixes them, the server again on saving, where nothing the browser
 * sends is trusted. services/org-chart-import.ts writes the reviewed rows
 * into the draft through the org chart's own services.
 *
 * Selah records the structure the firm decides. The checks are about the
 * data only (a code that points nowhere, a loop, a duplicate, a missing
 * title, a holder who is not a person of the client, a level that
 * contradicts its parent, a warning only); nothing here suggests, scores or judges a
 * structure, and the assistant's draft never adds a unit, a position or a
 * name that is not in the text it was given.
 */

/** The template's columns, in order. One row is a unit, or a position in its unit. */
export const ORG_IMPORT_FIELDS = [
  "unitCode",
  "unitNameAr",
  "unitNameEn",
  "unitKind",
  "parentCode",
  "level",
  "advisory",
  "positionCode",
  "titleAr",
  "titleEn",
  "reportsTo",
  "head",
  "holder",
  "specialties",
  "vacant",
  "planned",
] as const;
export type OrgField = (typeof ORG_IMPORT_FIELDS)[number];
export type OrgValues = Partial<Record<OrgField, string>>;

/** The columns that hold codes: the template formats them as Text, so Excel keeps a code as typed. */
export const ORG_CODE_FIELDS: readonly OrgField[] = ["unitCode", "parentCode", "positionCode", "reportsTo"];

/** What a row says about its unit (besides the unit's code). */
const UNIT_DETAIL: readonly OrgField[] = ["unitNameAr", "unitNameEn", "unitKind", "parentCode", "level", "advisory"];
/** What makes a row a position. */
const POSITION_FIELDS: readonly OrgField[] = ["positionCode", "titleAr", "titleEn", "reportsTo", "head", "holder", "specialties", "vacant", "planned"];

export interface OrgRow {
  /** Where it came from (a sheet's row number, the outline's or the draft's order), for messages. */
  line: number;
  include: boolean;
  values: OrgValues;
  /** Fields Selah filled: a unit's code taken from the row above, or a code given where there was none. */
  filled: OrgField[];
  /** Code columns Excel stored as a number with a decimal point, which may not be what was typed (2.10 is kept as 2.1). */
  numbers?: OrgField[];
}

export type OrgImportSource = "xlsx" | "docx" | "text";
/** Replace the draft with the rows, or add the rows to it. */
export type OrgImportMode = "replace" | "add";

export const ORG_IMPORT_LIMITS = {
  /** The most rows one import takes. */
  rows: 500,
  /** The most characters of pasted text the assistant drafts from (the AI service takes as much). */
  text: 20_000,
} as const;

/**
 * The pasted-text route's body: far more than the limit is accepted, so the
 * server can say by how many characters a text must be shorter ("text too
 * long: N") instead of refusing it unread.
 */
export const ORG_DRAFT_BODY = z.object({ text: z.string().max(ORG_IMPORT_LIMITS.text * 10) });

/** Codes already used, which a code Selah gives must avoid. */
export interface Taken {
  units: ReadonlySet<string>;
  positions: ReadonlySet<string>;
}

// ------------------------------------------------------------ words

const ARABIC = /[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]/;
const isArabic = (s: string) => ARABIC.test(s);
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A code as stored: Arabic-Indic digits as ASCII, no spaces around it. */
export function normCode(raw: string | undefined): string | undefined {
  const c = asciiDigits(raw ?? "").trim();
  return c || undefined;
}

/** The words the template writes for yes and no, the unit kinds and lists, in each language. */
export const TEMPLATE_WORDS = {
  ar: {
    yes: "نعم",
    no: "لا",
    list: "؛ ",
    kinds: { board: "مجلس", committee: "لجنة", executive: "تنفيذي", sector: "قطاع", department: "إدارة", section: "قسم", unit: "وحدة", office: "مكتب" },
  },
  en: {
    yes: "yes",
    no: "no",
    list: "; ",
    kinds: { board: "board", committee: "committee", executive: "executive", sector: "sector", department: "department", section: "section", unit: "unit", office: "office" },
  },
} as const satisfies Record<"ar" | "en", { yes: string; no: string; list: string; kinds: Record<OrgUnitKind, string> }>;

const YES_MARKS = new Set(["✓", "✔", "☑", "x"]);
const YES = new Set(["yes", "y", "true", "1", "نعم", "اجل", "صح"].map(normText));
const NO = new Set(["no", "n", "false", "0", "لا", "كلا"].map(normText));

/** Yes (true) or no (false) in Arabic or English; undefined when empty, null when it is neither. */
export function parseYesNo(raw: string | undefined): boolean | null | undefined {
  const t = (raw ?? "").trim().toLowerCase();
  if (!t) return undefined;
  if (YES_MARKS.has(t)) return true;
  const n = normText(t);
  if (YES.has(n)) return true;
  if (NO.has(n)) return false;
  return null;
}

/** Other words for each kind, written in a kind column. */
const KIND_WORDS: Record<OrgUnitKind, string[]> = {
  board: ["board of directors", "مجلس الإدارة", "مجلس ادارة"],
  committee: ["لجان"],
  executive: ["executive management", "executive office", "تنفيذية", "الإدارة التنفيذية"],
  sector: ["قطاعات"],
  department: ["directorate", "إدارة عامة", "إدارات"],
  section: ["أقسام"],
  unit: ["وحدات"],
  office: ["مكاتب"],
};
const KINDS = new Map<string, OrgUnitKind>();
for (const k of ORG_UNIT_KINDS) {
  for (const w of [k, TEMPLATE_WORDS.ar.kinds[k], TEMPLATE_WORDS.en.kinds[k], ...KIND_WORDS[k]]) KINDS.set(normText(w), k);
}

/** A unit kind written in Arabic or English ("إدارة", "department"); null when it is not one. */
export function parseKind(raw: string | undefined): OrgUnitKind | null {
  const n = normText(raw ?? "");
  if (!n) return null;
  return KINDS.get(n) ?? (n.startsWith("ال") ? (KINDS.get(n.slice(2)) ?? null) : null);
}

// Words in a unit's name that say what it is, in the order they win ("مكتب الرئيس التنفيذي" is the executive office).
const NAME_KEYWORDS: [OrgUnitKind, string[]][] = [
  ["board", ["مجلس", "board"]],
  ["committee", ["لجنه", "committee"]],
  ["executive", ["تنفيذي", "تنفيذيه", "executive", "ceo"]],
  ["sector", ["قطاع", "sector"]],
  ["department", ["اداره", "department", "directorate"]],
  ["section", ["قسم", "section"]],
  ["unit", ["وحده", "unit"]],
  ["office", ["مكتب", "office"]],
];

/** The kind a unit's name says it is ("الإدارة المالية" is a department), or null when the name does not say. */
export function guessKind(name: string): OrgUnitKind | null {
  const words = normText(name).split(" ").filter(Boolean);
  for (const [kind, keys] of NAME_KEYWORDS) {
    if (words.some((w) => keys.includes(w) || (w.startsWith("ال") && keys.includes(w.slice(2))))) return kind;
  }
  return null;
}

/** Specialties and holders: split on ";" or "؛" or new lines, trimmed, blanks dropped. */
export function splitList(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(/[;؛\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// ------------------------------------------------------------ the template's headings

const SYNONYMS: Record<OrgField, string[]> = {
  unitCode: ["Unit code", "unit no", "رمز الوحدة", "رقم الوحدة", "كود الوحدة"],
  unitNameAr: ["Unit name (Arabic)", "unit (arabic)", "اسم الوحدة بالعربية", "اسم الوحدة (عربي)", "اسم الوحدة", "الوحدة"],
  unitNameEn: ["Unit name (English)", "unit (english)", "unit name", "unit", "اسم الوحدة بالإنجليزية", "اسم الوحدة (إنجليزي)"],
  unitKind: ["Unit kind", "unit type", "kind", "type", "نوع الوحدة", "النوع"],
  parentCode: ["Parent unit code", "parent code", "parent unit", "parent", "رمز الوحدة الأعلى", "الوحدة الأعلى", "رمز الوحدة الأم", "تتبع الوحدة"],
  level: ["Level", "المستوى", "المستوى التنظيمي"],
  advisory: ["Advisory (dotted line)", "advisory", "dotted line", "وحدة استشارية (خط منقط)", "وحدة استشارية", "استشارية", "خط منقط"],
  positionCode: ["Position code", "job code", "رمز الوظيفة", "رقم الوظيفة", "كود الوظيفة"],
  titleAr: ["Position title (Arabic)", "title (arabic)", "job title (arabic)", "المسمى الوظيفي بالعربية", "المسمى الوظيفي (عربي)", "المسمى الوظيفي", "المسمى"],
  titleEn: ["Position title (English)", "title (english)", "job title (english)", "position title", "job title", "title", "المسمى الوظيفي بالإنجليزية", "المسمى الوظيفي (إنجليزي)"],
  reportsTo: ["Reports to (position code)", "reports to", "manager code", "ترتبط بـ (رمز الوظيفة)", "ترتبط بـ", "يرتبط بـ", "رمز الوظيفة الأعلى", "المرجع الإداري"],
  head: ["Head of unit", "unit head", "head", "رئيس الوحدة"],
  holder: ["Holder (e-mail or name)", "holder", "holder e-mail or name", "employee", "name", "شاغل الوظيفة (بريد أو اسم)", "شاغل الوظيفة", "الشاغل", "اسم الموظف"],
  specialties: ["Specialties", "specialities", "duties", "التخصصات", "المهام", "الاختصاصات"],
  vacant: ["Vacant", "vacancy", "شاغرة", "شاغر"],
  planned: ["Planned people", "planned", "headcount", "planned headcount", "العدد المخطط", "العدد"],
};
const HEADER_FIELD = new Map<string, OrgField>();
for (const f of ORG_IMPORT_FIELDS) for (const s of SYNONYMS[f]) if (!HEADER_FIELD.has(normText(s))) HEADER_FIELD.set(normText(s), f);

/** The field a column heading names, in Arabic or English; a heading may hold both, one per line. */
export function fieldOfHeader(header: string): OrgField | null {
  for (const part of header.split(/\r?\n|\s[/|]\s/)) {
    const f = HEADER_FIELD.get(normText(part));
    if (f) return f;
  }
  return null;
}

/** The sheet that holds the template's columns, the row of its headings and what each column is; null when no sheet does. */
export function findTemplateSheet<S extends { name: string; rows: string[][] }>(sheets: readonly S[]): { sheet: S; headerRow: number; mapping: (OrgField | null)[] } | null {
  for (const sheet of sheets) {
    for (let i = 0; i < Math.min(sheet.rows.length, 15); i++) {
      const seen = new Set<OrgField>();
      const mapping = (sheet.rows[i] ?? []).map((h) => {
        const f = fieldOfHeader(h);
        if (!f || seen.has(f)) return null;
        seen.add(f);
        return f;
      });
      if (seen.size >= 3 && (seen.has("unitCode") || seen.has("positionCode") || seen.has("titleAr") || seen.has("titleEn"))) return { sheet, headerRow: i, mapping };
    }
  }
  return null;
}

// ------------------------------------------------------------ rows from a sheet, an outline, a draft

const has = (v: OrgValues, fields: readonly OrgField[]) => fields.some((f) => !!v[f]?.trim());

/** A sheet's rows under the mapping. Blank rows are skipped; a position row with no unit at all takes the unit of the row above (merged or empty cells). */
export function sheetRows(rows: string[][], headerRow: number, mapping: (OrgField | null)[], numeric: readonly string[] = []): OrgRow[] {
  const stored = new Set(numeric);
  const out: OrgRow[] = [];
  let unit: string | undefined;
  for (let r = headerRow + 1; r < rows.length; r++) {
    const values: OrgValues = {};
    mapping.forEach((f, c) => {
      if (!f) return;
      const v = (rows[r]?.[c] ?? "").replace(/\r\n?/g, "\n").trim();
      if (v) values[f] = values[f] ? `${values[f]}\n${v}` : v;
    });
    if (!Object.keys(values).length) continue;
    const filled: OrgField[] = [];
    if (!values.unitCode && !has(values, UNIT_DETAIL) && has(values, POSITION_FIELDS) && unit) {
      values.unitCode = unit;
      filled.push("unitCode");
    }
    if (values.unitCode) unit = values.unitCode;
    // A code Excel kept as a number with a decimal point may have lost a trailing zero (2.10 is 2.1).
    const numbers = mapping.flatMap((f, c) => (f && ORG_CODE_FIELDS.includes(f) && stored.has(`${r}:${c}`) && (rows[r]?.[c] ?? "").includes(".") ? [f] : []));
    out.push({ line: r + 1, include: true, values, filled, ...(numbers.length ? { numbers } : {}) });
  }
  return out;
}

const sameText = (a: string | undefined, b: string | undefined) => normText(a ?? "") === normText(b ?? "");

/**
 * Codes for rows that have none: a unit with the names of the unit above is
 * that unit, a new one gets the next code under its parent ("2" gives "2.1"),
 * and a position the next code under its unit. Codes already used (in the
 * rows or the draft) are avoided.
 */
export function fillCodes(rows: readonly OrgRow[], taken: Taken): OrgRow[] {
  const units = new Set(taken.units);
  const positions = new Set(taken.positions);
  for (const r of rows) {
    const u = normCode(r.values.unitCode);
    const p = normCode(r.values.positionCode);
    if (u) units.add(u);
    if (p) positions.add(p);
  }
  const names = new Map<string, OrgValues>();
  let prev: string | undefined;
  return rows.map((r) => {
    const values = { ...r.values };
    const filled = [...r.filled];
    if (!values.unitCode) {
      const before = prev ? names.get(prev) : undefined;
      const same = !!prev && (!(values.unitNameAr || values.unitNameEn) || (before && (!values.unitNameAr || sameText(values.unitNameAr, before.unitNameAr)) && (!values.unitNameEn || sameText(values.unitNameEn, before.unitNameEn))));
      if (same && (has(values, UNIT_DETAIL) || has(values, POSITION_FIELDS))) {
        values.unitCode = prev;
        filled.push("unitCode");
      } else if (values.unitNameAr || values.unitNameEn) {
        const code = nextCode(normCode(values.parentCode) ?? null, units);
        if (code) {
          units.add(code);
          values.unitCode = code;
          filled.push("unitCode");
        }
      }
    }
    const unit = normCode(values.unitCode);
    if (unit) {
      if ((values.unitNameAr || values.unitNameEn) && !names.has(unit)) names.set(unit, values);
      prev = values.unitCode;
    }
    if (!values.positionCode && (values.titleAr || values.titleEn)) {
      const code = nextCode(unit ?? null, positions);
      if (code) {
        positions.add(code);
        values.positionCode = code;
        filled.push("positionCode");
      }
    }
    return { ...r, values, filled };
  });
}

/** Leading numbering on a heading or a line ("2.4 ", "١. ", "أ- "): the number, when it is one, and the text without it. */
function splitNumbering(text: string): { number: string | null; text: string } {
  const m = /^\s*([0-9٠-٩۰-۹]+(?:\.[0-9٠-٩۰-۹]+)*)[.\-):]?\s+(.+)$/.exec(text);
  if (m) return { number: asciiDigits(m[1]!), text: m[2]!.trim() };
  const letter = /^\s*[a-zA-Zء-ي][.)\-]\s+(.+)$/.exec(text);
  return { number: null, text: (letter ? letter[1]! : text).trim() };
}

/**
 * A Word outline as rows: each heading is a unit at its heading's level,
 * under the nearest heading above it of a higher level; bulleted or
 * numbered lines under a heading are positions in that unit. Other
 * paragraphs and tables are left out. A heading numbered like a code
 * ("2.4 Finance") keeps it; everything else gets the next free code.
 */
export function outlineRows(blocks: readonly DocBlock[], taken: Taken): OrgRow[] {
  const units = new Set(taken.units);
  const positions = new Set(taken.positions);
  const rows: OrgRow[] = [];
  const stack: { level: number; code: string }[] = [];
  let current: string | null = null;
  for (const b of blocks) {
    if (b.type === "table") continue;
    if (b.type === "heading") {
      while (stack.length && stack.at(-1)!.level >= b.level) stack.pop();
      const parent = stack.at(-1)?.code ?? null;
      const { number, text } = splitNumbering(b.text);
      const code = number && ORG_CODE.test(number) && !units.has(number) ? number : nextCode(parent, units);
      if (!code || !text) continue;
      units.add(code);
      stack.push({ level: b.level, code });
      current = code;
      rows.push({
        line: rows.length + 1,
        include: true,
        values: { unitCode: code, [isArabic(text) ? "unitNameAr" : "unitNameEn"]: text, parentCode: parent ?? "", level: String(b.level) },
        filled: code === number ? [] : ["unitCode"],
      });
    } else if (b.list) {
      const { text } = splitNumbering(b.text);
      const code = text ? nextCode(current, positions) : null;
      if (!code) continue;
      positions.add(code);
      rows.push({
        line: rows.length + 1,
        include: true,
        values: { ...(current ? { unitCode: current } : {}), positionCode: code, [isArabic(text) ? "titleAr" : "titleEn"]: text },
        filled: ["positionCode"],
      });
    }
  }
  return rows;
}

/**
 * What the assistant returns (services/ai: ORG_DRAFT_SCHEMA), after any
 * placeholder is put back: units and positions only, never a person.
 */
export interface DraftReply {
  units: { ref: string; parent: string; code: string; name: string; kind: string }[];
  positions: { ref: string; unit: string; code: string; title: string; reports_to: string; head: boolean; specialties: string[] }[];
}

/** Something the assistant returned that is not in the text, so it was left out. */
export interface Dropped {
  kind: "unit" | "position" | "specialty";
  text: string;
}

/**
 * The assistant's draft as rows, keeping only what is in the pasted text.
 * Each unit and each position must be written in the text, and each mention
 * carries one unit or one position at most: a title written once makes one
 * position, never two. A specialty must be in the text too. Anything else is
 * left out and listed, never added. The draft never handles people: no row
 * it makes names anyone (they are added later, by the firm). A code is kept
 * only when the text writes it; the rest get the next free code. A position
 * whose unit was left out has no unit, for the person to place it.
 */
export function draftRows(reply: DraftReply, text: string, taken: Taken): { rows: OrgRow[]; dropped: Dropped[] } {
  // Words as normText compares them, and a full stop that ends a sentence is not part of the word before it.
  const words = (s: string) =>
    normText(s)
      .replace(/(?<![0-9])\.|\.(?![0-9])/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  const T = ` ${words(text)} `;
  const dropped: Dropped[] = [];
  /** Whether the term is written in the text; with `pool`, a mention no earlier term took (and it is taken). */
  const inText = (term: string, pool: [number, number][] | null): boolean => {
    const n = words(term);
    if (!n) return false;
    // A word may carry a one-letter Arabic prefix ("والمحاسب").
    const re = new RegExp(`(?<= )[وفبلك]?${escapeRe(n)}(?= )`, "gu");
    for (const m of T.matchAll(re)) {
      const span: [number, number] = [m.index, m.index + m[0].length];
      if (!pool) return true;
      if (pool.some(([s, e]) => span[0] < e && s < span[1])) continue;
      pool.push(span);
      return true;
    }
    return false;
  };
  const longestFirst = <X>(list: X[], key: (x: X) => string) =>
    list.map((x, i) => ({ x, i, n: words(key(x)).length })).sort((a, b) => b.n - a.n || a.i - b.i);

  const unitPool: [number, number][] = [];
  const keptUnits = new Set<string>();
  for (const { x } of longestFirst(reply.units, (u) => u.name)) {
    if (x.name.trim() && !keptUnits.has(x.ref) && inText(x.name, unitPool)) keptUnits.add(x.ref);
    else dropped.push({ kind: "unit", text: x.name });
  }
  const positionPool: [number, number][] = [];
  const keptPositions = new Set<string>();
  for (const { x } of longestFirst(reply.positions, (p) => p.title)) {
    if (x.title.trim() && !keptPositions.has(x.ref) && inText(x.title, positionPool)) keptPositions.add(x.ref);
    else dropped.push({ kind: "position", text: x.title });
  }
  // One position per title in a unit, unless the text lists the title separately more than once
  // (one per line or item: "- Accountant / - Accountant"). A second mention inside a sentence
  // ("reports to the Finance Manager") is not a second position.
  const items = text
    .split(/\r?\n|[;؛,،:]/)
    .map((s) => ` ${words(s.replace(/^\s*(?:[-*•·–]|[0-9٠-٩]+[.)\-])\s*/, ""))} `);
  const listings = (title: string) => {
    const t = ` ${words(title)} `;
    return items.filter((s) => s.startsWith(t)).length;
  };
  const byTitle = new Map<string, string[]>();
  for (const p of reply.positions) {
    if (!keptPositions.has(p.ref)) continue;
    const key = `${keptUnits.has(p.unit) ? p.unit : ""}\u0000${words(p.title)}`;
    byTitle.set(key, [...(byTitle.get(key) ?? []), p.ref]);
  }
  for (const refs of byTitle.values()) {
    if (refs.length < 2) continue;
    const title = reply.positions.find((p) => p.ref === refs[0])!.title;
    for (const ref of refs.slice(Math.max(1, listings(title)))) {
      keptPositions.delete(ref);
      dropped.push({ kind: "position", text: title });
    }
  }

  const units = reply.units.filter((u) => keptUnits.has(u.ref));
  const byRef = new Map(units.map((u) => [u.ref, u]));
  // A parent that was left out, or a loop, leaves the unit at the top.
  const parentOf = new Map<string, string | null>();
  for (const u of units) {
    let parent: string | null = byRef.has(u.parent) && u.parent !== u.ref ? u.parent : null;
    for (let at = parent, n = 0; at && n <= units.length; at = byRef.get(at)!.parent, n++) {
      if (at === u.ref || !byRef.has(at)) {
        if (at === u.ref) parent = null;
        break;
      }
    }
    parentOf.set(u.ref, parent);
  }
  for (const u of units) {
    // A loop through several units: cut it where it closes.
    const seen = new Set<string>([u.ref]);
    for (let at = parentOf.get(u.ref) ?? null; at; at = parentOf.get(at) ?? null) {
      if (seen.has(at)) {
        parentOf.set(u.ref, null);
        break;
      }
      seen.add(at);
    }
  }

  const unitCodes = new Set(taken.units);
  const positionCodes = new Set(taken.positions);
  const written = (code: string) => {
    const c = normCode(code);
    return !!c && ORG_CODE.test(c) && new RegExp(`(?<![0-9A-Za-z.])${escapeRe(c)}(?![0-9A-Za-z]|\\.[0-9A-Za-z])`).test(asciiDigits(text)) ? c : null;
  };
  const order: DraftReply["units"] = [];
  const level = new Map<string, number>();
  const code = new Map<string, string>();
  const visit = (u: DraftReply["units"][number], depth: number) => {
    order.push(u);
    level.set(u.ref, depth);
    const parentCode = parentOf.get(u.ref) ? code.get(parentOf.get(u.ref)!)! : null;
    const own = written(u.code);
    const c = own && !unitCodes.has(own) ? own : nextCode(parentCode, unitCodes);
    if (c) {
      unitCodes.add(c);
      code.set(u.ref, c);
    }
    for (const child of units.filter((x) => parentOf.get(x.ref) === u.ref)) visit(child, depth + 1);
  };
  for (const u of units.filter((x) => !parentOf.get(x.ref))) visit(u, 1);

  const positions = reply.positions.filter((p) => keptPositions.has(p.ref));
  const pcode = new Map<string, string>();
  for (const p of positions) {
    const unitCode = keptUnits.has(p.unit) ? code.get(p.unit) : undefined;
    const own = written(p.code);
    const c = own && !positionCodes.has(own) ? own : nextCode(unitCode ?? null, positionCodes);
    if (c) {
      positionCodes.add(c);
      pcode.set(p.ref, c);
    }
  }
  const positionRow = (p: DraftReply["positions"][number]): OrgValues => {
    const values: OrgValues = {};
    const unitCode = keptUnits.has(p.unit) ? code.get(p.unit) : undefined;
    if (unitCode) values.unitCode = unitCode;
    values.positionCode = pcode.get(p.ref);
    values[isArabic(p.title) ? "titleAr" : "titleEn"] = p.title.trim();
    const boss = p.reports_to !== p.ref ? pcode.get(p.reports_to) : undefined;
    if (boss) values.reportsTo = boss;
    if (p.head) values.head = TEMPLATE_WORDS.en.yes;
    const specialties = p.specialties.filter((s) => {
      if (!s.trim()) return false;
      if (inText(s, null)) return true;
      dropped.push({ kind: "specialty", text: s.trim() });
      return false;
    });
    if (specialties.length) values.specialties = specialties.map((s) => s.trim()).join(TEMPLATE_WORDS.en.list);
    return values;
  };

  const rows: OrgRow[] = [];
  const push = (values: OrgValues, filled: OrgField[]) => rows.push({ line: rows.length + 1, include: true, values, filled });
  for (const u of order) {
    const c = code.get(u.ref);
    if (!c) continue;
    const parent = parentOf.get(u.ref);
    push(
      {
        unitCode: c,
        [isArabic(u.name) ? "unitNameAr" : "unitNameEn"]: u.name.trim(),
        unitKind: (ORG_UNIT_KINDS as readonly string[]).includes(u.kind) ? u.kind : "unit",
        parentCode: parent ? (code.get(parent) ?? "") : "",
        level: String(Math.min(level.get(u.ref)!, ORG_CHART_LIMITS.level.max)),
      },
      written(u.code) === c ? [] : ["unitCode"],
    );
    for (const p of positions.filter((x) => x.unit === u.ref)) push(positionRow(p), written(p.code) === pcode.get(p.ref) ? [] : ["positionCode"]);
  }
  for (const p of positions.filter((x) => !keptUnits.has(x.unit))) push(positionRow(p), ["positionCode"]);
  return { rows, dropped };
}

// ------------------------------------------------------------ the export

export interface ExportUnit {
  id: string;
  parentId: string | null;
  kind: OrgUnitKind;
  code: string;
  nameAr: string | null;
  nameEn: string | null;
  level: number;
  sortOrder: number;
  advisory: boolean;
}

export interface ExportPosition {
  id: string;
  unitId: string;
  code: string;
  titleAr: string | null;
  titleEn: string | null;
  reportsToId: string | null;
  isHead: boolean;
  specialties: string[];
  plannedCount: number;
  sortOrder: number;
  /** As the services return them: a name only where the reader may see it. */
  holders: { userId: string | null; name: string | null; named: boolean }[];
  /** Null where the reader gets titles only: nothing is said about who holds it. */
  vacant: boolean | null;
}

/**
 * A version's structure as the template's rows, so it can come back in:
 * units in the drawing's order, each followed by its positions (the head
 * first), or a row of its own when it has none. Holders only with `names`,
 * and only those the services sent a name for; `holderText` gives a
 * person's e-mail (an account) or the typed name.
 */
export function structureRows(
  units: readonly ExportUnit[],
  positions: readonly ExportPosition[],
  opts: { locale: "ar" | "en"; names: boolean; holderText: (h: { userId: string | null; name: string | null }) => string | null },
): string[][] {
  const words = TEMPLATE_WORDS[opts.locale];
  const yesNo = (b: boolean) => (b ? words.yes : words.no);
  const byOrder = <X extends { sortOrder: number; code: string }>(a: X, b: X) => a.sortOrder - b.sortOrder || compareCodes(a.code, b.code);
  const ids = new Set(units.map((u) => u.id));
  const unitCode = new Map(units.map((u) => [u.id, u.code]));
  const positionCode = new Map(positions.map((p) => [p.id, p.code]));
  const rows: string[][] = [];
  const unitValues = (u: ExportUnit): OrgValues => ({
    unitCode: u.code,
    unitNameAr: u.nameAr ?? "",
    unitNameEn: u.nameEn ?? "",
    unitKind: words.kinds[u.kind],
    parentCode: u.parentId ? (unitCode.get(u.parentId) ?? "") : "",
    level: String(u.level),
    advisory: yesNo(u.advisory),
  });
  const seen = new Set<string>();
  const visit = (u: ExportUnit) => {
    if (seen.has(u.id)) return;
    seen.add(u.id);
    const mine = positions.filter((p) => p.unitId === u.id).sort((a, b) => Number(b.isHead) - Number(a.isHead) || byOrder(a, b));
    if (!mine.length) rows.push(ORG_IMPORT_FIELDS.map((f) => unitValues(u)[f] ?? ""));
    for (const p of mine) {
      const holders = opts.names ? p.holders.filter((h) => h.named && h.name).flatMap((h) => opts.holderText(h) ?? []) : [];
      const values: OrgValues = {
        ...unitValues(u),
        positionCode: p.code,
        titleAr: p.titleAr ?? "",
        titleEn: p.titleEn ?? "",
        reportsTo: p.reportsToId ? (positionCode.get(p.reportsToId) ?? "") : "",
        head: yesNo(p.isHead),
        holder: holders.join(words.list),
        specialties: p.specialties.join(words.list),
        vacant: p.vacant === null ? "" : yesNo(p.vacant),
        planned: String(p.plannedCount),
      };
      rows.push(ORG_IMPORT_FIELDS.map((f) => values[f] ?? ""));
    }
    units.filter((c) => c.parentId === u.id).sort(byOrder).forEach(visit);
  };
  units.filter((u) => !u.parentId || !ids.has(u.parentId)).sort(byOrder).forEach(visit);
  return rows;
}

// ------------------------------------------------------------ checking

/** The client and the draft an import is checked against. */
export interface OrgImportContext {
  /** The client keeps minimal records: titles only, no names. */
  minimalRecords: boolean;
  /** The client's people with an account: a holder written as one of their e-mails becomes them. */
  people: { userId: string; email: string; name: string }[];
  /** What the draft holds now (nothing while the client has no structure). */
  draft: { units: DraftUnit[]; positions: DraftPosition[] };
}

export interface DraftUnit {
  code: string;
  parentCode: string | null;
  level: number;
  nameAr: string | null;
  nameEn: string | null;
  kind: OrgUnitKind;
  advisory: boolean;
}

export interface DraftPosition {
  code: string;
  unitCode: string;
  reportsTo: string | null;
  isHead: boolean;
  titleAr: string | null;
  titleEn: string | null;
  /** Who holds it today (its lineage's holdings, on the live structure): never changed by an import. */
  holders: { userId: string | null; name: string | null }[];
  /** Who is planned for it (org_chart_planned_holders), placed when the draft is published (part 5). */
  planned?: { userId: string | null; name: string | null }[];
}

export type OrgIssueCode =
  // Errors: the row cannot be saved until it is fixed or skipped.
  | "noUnit"
  | "noCode"
  | "badCode"
  | "noUnitName"
  | "noTitle"
  | "duplicateUnit"
  | "duplicatePosition"
  | "positionInDraft"
  | "unknownParent"
  | "unknownUnit"
  | "unknownReportsTo"
  | "loop"
  | "unitLoop"
  | "badLevel"
  | "badKind"
  | "badYesNo"
  | "twoHeads"
  | "headInDraft"
  | "holderNotUser"
  | "holderName"
  | "holderAndVacant"
  | "badPlanned"
  | "specialties"
  | "tooLong"
  // Warnings: saved as they are, since the app allows them (a level set by hand, more people than planned).
  | "levelParent"
  | "tooManyHolders"
  | "numericCode"
  // Notes: plain facts about what saving does.
  | "filled"
  | "codeGiven"
  | "kindGuessed"
  | "kindDefault"
  | "levelGiven"
  | "unitInDraft"
  | "unitUpdated"
  | "positionUpdated"
  | "planned"
  | "namesNotKept";

export interface OrgIssue {
  code: OrgIssueCode;
  field?: OrgField;
  /** Values for the message: a code, another row, a level, a unit kind. */
  values?: Record<string, string | number>;
}

export interface OrgRowCheck {
  line: number;
  /** The row cannot be saved until it is fixed or skipped. */
  errors: OrgIssue[];
  /** It can be saved as it is, but look first: something the app allows yet may be a slip. */
  warnings: OrgIssue[];
  /** Plain facts about what saving does. */
  notes: OrgIssue[];
}

export interface PlannedUnit {
  code: string;
  nameAr: string | null;
  nameEn: string | null;
  kind: OrgUnitKind;
  parentCode: string | null;
  level: number;
  advisory: boolean;
  /** A unit of the draft with this code (replacing: it is updated). */
  inDraft: boolean;
  line: number;
}

export type PlannedHolder = { userId: string } | { name: string };

export interface PlannedPosition {
  code: string;
  unitCode: string;
  titleAr: string | null;
  titleEn: string | null;
  reportsTo: string | null;
  isHead: boolean;
  specialties: string[];
  plannedCount: number;
  /**
   * Who is planned for it: the row's holder column, saved as the position's
   * planned holders (never a holding) and placed when the draft is published.
   * None when vacant, and always none at a minimal-records client.
   */
  holders: PlannedHolder[];
  /** A position of the draft with this code (replacing: it is updated, and its plan becomes the row's; who holds it today does not change). */
  inDraft: boolean;
  line: number;
}

/** A position of the draft that saving with "Replace" removes, and the names of who holds it today. */
export interface LeavingPosition {
  code: string;
  titleAr: string | null;
  titleEn: string | null;
  holders: string[];
}

export interface OrgImportCheck {
  rows: OrgRowCheck[];
  plan: {
    /** Parents before their units. */
    units: PlannedUnit[];
    positions: PlannedPosition[];
    /** Replacing: the draft's units and positions the rows do not hold, removed on saving. */
    removeUnits: string[];
    removePositions: string[];
    /** Replacing: what leaves the draft, by name, and who holds each position today (their holding ends when the draft is published). */
    leaving: { positions: LeavingPosition[]; units: { code: string; nameAr: string | null; nameEn: string | null }[] };
  };
  counts: { units: number; positions: number; withErrors: number; withWarnings: number; removeUnits: number; removePositions: number };
  /** More rows than one import takes. */
  tooMany: boolean;
}

const NAME_MAX = ORG_CHART_LIMITS.name;
const trimmed = (s: string | undefined) => s?.trim() || null;

function parseLevel(raw: string | undefined): number | null | undefined {
  const t = asciiDigits(raw ?? "").trim();
  if (!t) return undefined;
  if (!/^\d{1,2}$/.test(t)) return null;
  const n = Number(t);
  return n >= ORG_CHART_LIMITS.level.min && n <= ORG_CHART_LIMITS.level.max ? n : null;
}

/**
 * Check the rows and work out what saving them would do. Rows left out are
 * not checked and nothing may point to them. Replacing, the draft becomes
 * these rows (a unit or position with the same code is updated in place, the
 * rest of the draft is removed); adding, the draft stays and a row may use
 * its units and positions by code. The server runs this again with its own
 * context and refuses the whole save if any row has an error.
 */
export function checkOrgImport(rows: readonly OrgRow[], ctx: OrgImportContext, mode: OrgImportMode): OrgImportCheck {
  const replace = mode === "replace";
  const included = rows.filter((r) => r.include);
  const checks = new Map<number, OrgRowCheck>(included.map((r) => [r.line, { line: r.line, errors: [], warnings: [], notes: [] }]));
  const err = (line: number, issue: OrgIssue) => checks.get(line)!.errors.push(issue);
  const warn = (line: number, issue: OrgIssue) => checks.get(line)!.warnings.push(issue);
  const note = (line: number, issue: OrgIssue) => checks.get(line)!.notes.push(issue);
  const draftUnit = new Map(ctx.draft.units.map((u) => [u.code, u]));
  const draftPosition = new Map(ctx.draft.positions.map((p) => [p.code, p]));
  const email = new Map(ctx.people.map((p) => [p.email.trim().toLowerCase(), p]));

  // 1. Each row on its own: its codes and lengths.
  interface Parsed {
    line: number;
    v: OrgValues;
    unit?: string;
    defines: boolean;
    position?: string;
    isPosition: boolean;
    parent?: string;
    reportsTo?: string;
  }
  const parsed: Parsed[] = [];
  const unitSeen = new Set<string>();
  for (const r of included) {
    const v = r.values;
    const p: Parsed = { line: r.line, v, defines: has(v, UNIT_DETAIL), isPosition: has(v, POSITION_FIELDS) };
    parsed.push(p);
    const code = (field: OrgField): string | undefined => {
      const c = normCode(v[field]);
      if (!c) return undefined;
      if (ORG_CODE.test(c)) return c;
      err(r.line, { code: "badCode", field, values: { value: v[field]!.trim() } });
      return undefined;
    };
    p.unit = code("unitCode");
    if (r.filled.includes("unitCode") && p.unit) note(r.line, unitSeen.has(p.unit) ? { code: "filled", field: "unitCode" } : { code: "codeGiven", field: "unitCode", values: { code: p.unit } });
    if (p.unit) unitSeen.add(p.unit);
    if (p.defines && !v.unitCode?.trim()) err(r.line, { code: "noCode", field: "unitCode" });
    p.parent = code("parentCode");
    for (const f of ["unitNameAr", "unitNameEn", "titleAr", "titleEn"] as const) {
      if ((v[f]?.trim().length ?? 0) > NAME_MAX) err(r.line, { code: "tooLong", field: f, values: { max: NAME_MAX } });
    }
    if (p.isPosition) {
      if (!v.unitCode?.trim()) err(r.line, { code: "noUnit", field: "unitCode" });
      if (!v.positionCode?.trim()) err(r.line, { code: "noCode", field: "positionCode" });
      p.position = code("positionCode");
      if (r.filled.includes("positionCode") && p.position) note(r.line, { code: "codeGiven", field: "positionCode", values: { code: p.position } });
      p.reportsTo = code("reportsTo");
    }
    for (const f of r.numbers ?? []) {
      if (v[f]?.trim()) warn(r.line, { code: "numericCode", field: f, values: { value: v[f]!.trim() } });
    }
  }

  // 2. Units: the first row that says anything about a unit defines it; a later row may not say otherwise.
  const defs = new Map<string, { line: number; v: OrgValues; parent?: string }>();
  const conflicts = (a: OrgValues, b: OrgValues, f: OrgField) => {
    const x = a[f]?.trim();
    const y = b[f]?.trim();
    if (!x || !y) return false;
    if (f === "unitKind") return parseKind(x) !== parseKind(y);
    if (f === "parentCode") return normCode(x) !== normCode(y);
    if (f === "level") return parseLevel(x) !== parseLevel(y);
    if (f === "advisory") return parseYesNo(x) !== parseYesNo(y);
    return normText(x) !== normText(y);
  };
  for (const p of parsed) {
    if (!p.unit || !p.defines) continue;
    const def = defs.get(p.unit);
    if (!def) defs.set(p.unit, { line: p.line, v: { ...p.v }, parent: p.parent });
    else if (UNIT_DETAIL.some((f) => conflicts(def.v, p.v, f))) err(p.line, { code: "duplicateUnit", values: { code: p.unit, line: def.line } });
    else
      for (const f of UNIT_DETAIL) {
        // A later row may fill what the first left empty.
        if (!def.v[f]?.trim() && p.v[f]?.trim()) {
          def.v[f] = p.v[f];
          if (f === "parentCode") def.parent = p.parent;
        }
      }
  }

  // The units the rows may use: the rows' own, and adding, the draft's.
  const known = new Set<string>([...defs.keys(), ...(replace ? [] : draftUnit.keys())]);
  const units = new Map<string, { kind: OrgUnitKind; nameAr: string | null; nameEn: string | null; advisory: boolean; parent: string | null; level?: number; line: number; inDraft: boolean; given: boolean }>();
  for (const [code, def] of defs) {
    const v = def.v;
    const inDraft = draftUnit.has(code);
    const d = draftUnit.get(code);
    if (!replace && inDraft) {
      note(def.line, { code: "unitInDraft", values: { code } });
      continue;
    }
    if (inDraft) note(def.line, { code: "unitUpdated", values: { code } });
    let nameAr = trimmed(v.unitNameAr);
    let nameEn = trimmed(v.unitNameEn);
    if (!nameAr && !nameEn && d) [nameAr, nameEn] = [d.nameAr, d.nameEn];
    if (!nameAr && !nameEn) err(def.line, { code: "noUnitName" });
    let kind: OrgUnitKind = "unit";
    if (v.unitKind?.trim()) {
      const k = parseKind(v.unitKind);
      if (k) kind = k;
      else err(def.line, { code: "badKind", field: "unitKind", values: { value: v.unitKind.trim() } });
    } else if (d) kind = d.kind;
    else {
      const guessed = guessKind(`${nameAr ?? ""} ${nameEn ?? ""}`);
      kind = guessed ?? "unit";
      note(def.line, { code: guessed ? "kindGuessed" : "kindDefault", values: { kind } });
    }
    let advisory = d?.advisory ?? false;
    if (v.advisory?.trim()) {
      const a = parseYesNo(v.advisory);
      if (a === null) err(def.line, { code: "badYesNo", field: "advisory" });
      else advisory = a ?? false;
    }
    const level = parseLevel(v.level);
    if (level === null) err(def.line, { code: "badLevel", field: "level", values: { value: v.level!.trim() } });
    const parent = def.parent ?? null;
    if (parent === code) err(def.line, { code: "unitLoop", field: "parentCode" });
    else if (parent && !known.has(parent)) err(def.line, { code: "unknownParent", field: "parentCode", values: { code: parent } });
    units.set(code, { kind, nameAr, nameEn, advisory, parent, level: level ?? undefined, line: def.line, inDraft, given: level !== undefined && level !== null });
  }

  // Loops through several units.
  const parentOf = (code: string): string | null | undefined => (units.has(code) ? units.get(code)!.parent : !replace ? (draftUnit.get(code)?.parentCode ?? null) : undefined);
  const inUnitLoop = new Set<string>();
  for (const code of units.keys()) {
    const seen = new Set<string>();
    for (let at = parentOf(code); at; at = parentOf(at)) {
      if (at === code) {
        inUnitLoop.add(code);
        break;
      }
      if (seen.has(at)) break;
      seen.add(at);
    }
  }
  for (const code of inUnitLoop) {
    const u = units.get(code)!;
    if (u.parent !== code) err(u.line, { code: "unitLoop", field: "parentCode" });
  }

  // Levels: given, or one below the parent (the top is 1). A unit is expected to sit lower than its
  // parent; one that does not is taken and warned of, since the firm may set levels by hand.
  const levelOf = new Map<string, number>();
  const resolve = (code: string, depth = 0): number => {
    if (levelOf.has(code)) return levelOf.get(code)!;
    const u = units.get(code);
    if (!u) return draftUnit.get(code)?.level ?? 1;
    if (u.level !== undefined) return u.level;
    if (depth > 50 || inUnitLoop.has(code)) return 1;
    const d = draftUnit.get(code);
    const lvl = u.parent && known.has(u.parent) ? (d && d.parentCode === u.parent ? d.level : resolve(u.parent, depth + 1) + 1) : (d && !u.parent && !d.parentCode ? d.level : 1);
    levelOf.set(code, lvl);
    return lvl;
  };
  for (const [code, u] of units) {
    const lvl = resolve(code);
    levelOf.set(code, lvl);
    if (!u.parent || !known.has(u.parent) || inUnitLoop.has(code)) continue;
    const parentLevel = resolve(u.parent);
    if (!u.given) {
      if (lvl > ORG_CHART_LIMITS.level.max) err(u.line, { code: "badLevel", field: "level", values: { value: lvl } });
      else note(u.line, { code: "levelGiven", values: { level: lvl } });
    } else if (lvl <= parentLevel) warn(u.line, { code: "levelParent", field: "level", values: { level: lvl, parent: parentLevel } });
  }

  // 3. Positions.
  const positionRows = parsed.filter((p) => p.isPosition && p.position);
  const linesOf = new Map<string, number[]>();
  for (const p of positionRows) linesOf.set(p.position!, [...(linesOf.get(p.position!) ?? []), p.line]);
  const knownPositions = new Set<string>([...linesOf.keys(), ...(replace ? [] : draftPosition.keys())]);
  const lineOf = new Map<string, Parsed>();
  for (const p of positionRows) {
    const others = linesOf.get(p.position!)!.filter((l) => l !== p.line);
    if (others.length) err(p.line, { code: "duplicatePosition", field: "positionCode", values: { code: p.position!, line: others[0]! } });
    else if (!replace && draftPosition.has(p.position!)) err(p.line, { code: "positionInDraft", field: "positionCode", values: { code: p.position! } });
    if (!lineOf.has(p.position!)) lineOf.set(p.position!, p);
  }
  const planned: PlannedPosition[] = [];
  const heads = new Map<string, number>();
  const draftUnitsUsed = new Set<string>();
  for (const p of parsed.filter((x) => x.isPosition)) {
    const v = p.v;
    const line = p.line;
    if (p.unit && !known.has(p.unit)) err(line, { code: "unknownUnit", field: "unitCode", values: { code: p.unit } });
    else if (p.unit && !replace && !defs.has(p.unit) && !draftUnitsUsed.has(p.unit)) {
      // Adding to a unit of the draft: said once, on the first row that does.
      draftUnitsUsed.add(p.unit);
      note(line, { code: "unitInDraft", values: { code: p.unit } });
    }
    const titleAr = trimmed(v.titleAr);
    const titleEn = trimmed(v.titleEn);
    if (!titleAr && !titleEn) err(line, { code: "noTitle" });
    let isHead = false;
    if (v.head?.trim()) {
      const h = parseYesNo(v.head);
      if (h === null) err(line, { code: "badYesNo", field: "head" });
      else isHead = h ?? false;
    }
    if (p.reportsTo) {
      if (p.reportsTo === p.position) err(line, { code: "loop", field: "reportsTo" });
      else if (!knownPositions.has(p.reportsTo)) err(line, { code: "unknownReportsTo", field: "reportsTo", values: { code: p.reportsTo } });
    }
    let plannedCount = 1;
    if (v.planned?.trim()) {
      const t = asciiDigits(v.planned).trim();
      const n = /^\d{1,3}$/.test(t) ? Number(t) : NaN;
      if (n >= ORG_CHART_LIMITS.planned.min && n <= ORG_CHART_LIMITS.planned.max) plannedCount = n;
      else err(line, { code: "badPlanned", field: "planned" });
    }
    const specialties = cleanSpecialties(splitList(v.specialties));
    if (specialties.length > ORG_CHART_LIMITS.specialties.count || specialties.some((s) => s.length > ORG_CHART_LIMITS.specialties.length))
      err(line, { code: "specialties", field: "specialties" });
    let vacant: boolean | undefined;
    if (v.vacant?.trim()) {
      const x = parseYesNo(v.vacant);
      if (x === null) err(line, { code: "badYesNo", field: "vacant" });
      else vacant = x;
    }
    const holders: PlannedHolder[] = [];
    if (ctx.minimalRecords) {
      if (v.holder?.trim()) note(line, { code: "namesNotKept", field: "holder" });
    } else {
      const seen = new Set<string>();
      for (const h of splitList(v.holder)) {
        if (h.includes("@")) {
          const person = email.get(h.toLowerCase());
          if (!person) err(line, { code: "holderNotUser", field: "holder", values: { value: h } });
          else if (!seen.has(`u:${person.userId}`)) {
            seen.add(`u:${person.userId}`);
            holders.push({ userId: person.userId });
          }
        } else if (h.length < ORG_CHART_LIMITS.holderName.min || h.length > ORG_CHART_LIMITS.holderName.max) {
          err(line, { code: "holderName", field: "holder", values: { value: h.length > 40 ? `${h.slice(0, 40)}…` : h } });
        } else if (!seen.has(`n:${h.toLowerCase()}`)) {
          seen.add(`n:${h.toLowerCase()}`);
          holders.push({ name: h });
        }
      }
      if (vacant === true && splitList(v.holder).length) err(line, { code: "holderAndVacant", field: "vacant" });
      else if (holders.length > plannedCount) warn(line, { code: "tooManyHolders", field: "holder", values: { planned: plannedCount, count: holders.length } });
    }
    if (isHead && p.unit) {
      const first = heads.get(p.unit);
      if (first !== undefined) err(line, { code: "twoHeads", field: "head", values: { line: first, code: p.unit } });
      else {
        heads.set(p.unit, line);
        if (!replace && draftUnit.has(p.unit) && !units.has(p.unit) && ctx.draft.positions.some((d) => d.unitCode === p.unit && d.isHead))
          err(line, { code: "headInDraft", field: "head", values: { code: p.unit } });
      }
    }
    const inDraft = !!p.position && replace && draftPosition.has(p.position);
    if (inDraft) note(line, { code: "positionUpdated", values: { code: p.position! } });
    // The holder column is a plan: nobody is placed until the draft is published.
    if (holders.length && vacant !== true) note(line, { code: "planned", field: "holder" });
    if (p.position && p.unit && lineOf.get(p.position) === p)
      planned.push({ code: p.position, unitCode: p.unit, titleAr, titleEn, reportsTo: p.reportsTo ?? null, isHead, specialties, plannedCount, holders: vacant === true ? [] : holders, inDraft, line });
  }

  // Loops in "reports to" through several positions (the draft's own lines count when adding).
  const bossOf = (code: string): string | null | undefined => {
    const p = lineOf.get(code);
    if (p) return p.reportsTo ?? null;
    return replace ? undefined : (draftPosition.get(code)?.reportsTo ?? null);
  };
  for (const [code, p] of lineOf) {
    if (p.reportsTo === code) continue;
    const seen = new Set<string>();
    for (let at = bossOf(code); at; at = bossOf(at)) {
      if (at === code) {
        err(p.line, { code: "loop", field: "reportsTo" });
        break;
      }
      if (seen.has(at)) break;
      seen.add(at);
    }
  }

  // The plan: units parents first.
  const plannedUnits: PlannedUnit[] = [];
  const placed = new Set<string>();
  const place = (code: string, depth = 0) => {
    if (placed.has(code) || !units.has(code) || depth > 50) return;
    placed.add(code);
    const u = units.get(code)!;
    if (u.parent && units.has(u.parent) && !inUnitLoop.has(code)) place(u.parent, depth + 1);
    plannedUnits.push({ code, nameAr: u.nameAr, nameEn: u.nameEn, kind: u.kind, parentCode: u.parent, level: levelOf.get(code) ?? 1, advisory: u.advisory, inDraft: u.inDraft, line: u.line });
  };
  for (const code of units.keys()) place(code);

  const out = included.map((r) => checks.get(r.line)!);
  const removeUnits = replace ? ctx.draft.units.map((u) => u.code).filter((c) => !units.has(c)) : [];
  const removePositions = replace ? ctx.draft.positions.map((p) => p.code).filter((c) => !lineOf.has(c)) : [];
  const leaving = {
    positions: ctx.draft.positions
      .filter((p) => removePositions.includes(p.code))
      .map((p) => ({ code: p.code, titleAr: p.titleAr, titleEn: p.titleEn, holders: p.holders.flatMap((h) => (h.name ? [h.name] : [])) })),
    units: ctx.draft.units.filter((u) => removeUnits.includes(u.code)).map((u) => ({ code: u.code, nameAr: u.nameAr, nameEn: u.nameEn })),
  };
  return {
    rows: out,
    plan: { units: plannedUnits, positions: planned, removeUnits, removePositions, leaving },
    counts: {
      units: plannedUnits.length,
      positions: planned.length,
      withErrors: out.filter((c) => c.errors.length).length,
      withWarnings: out.filter((c) => c.warnings.length).length,
      removeUnits: removeUnits.length,
      removePositions: removePositions.length,
    },
    tooMany: included.length > ORG_IMPORT_LIMITS.rows,
  };
}

/**
 * What leaving one row out takes out of the draft when replacing it: the
 * draft's positions and units that only that row kept ("Skip this row" says
 * so). Nothing when adding, where the draft stays as it is.
 */
export function removedIfSkipped(rows: readonly OrgRow[], line: number, ctx: OrgImportContext, mode: OrgImportMode): { positions: string[]; units: string[] } {
  if (mode !== "replace") return { positions: [], units: [] };
  const kept = checkOrgImport(rows, ctx, mode).plan;
  const skipped = checkOrgImport(
    rows.map((r) => (r.line === line ? { ...r, include: false } : r)),
    ctx,
    mode,
  ).plan;
  return {
    positions: skipped.removePositions.filter((c) => !kept.removePositions.includes(c)),
    units: skipped.removeUnits.filter((c) => !kept.removeUnits.includes(c)),
  };
}
