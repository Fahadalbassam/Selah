import { asciiDigits, normText } from "./plan-import";

/**
 * Reading a client's indicator figures from what its systems export: an
 * Excel or CSV file, a published sheet, or a list a system sends. Pure, so
 * the review screen and the server run the same checks; nothing here writes
 * (services/indicator-data.ts saves what a person confirms, or what a
 * connection sends).
 *
 * Exports come in three shapes, and each client's indicators are its own, so
 * nothing assumes fixed column names:
 *   rows    - one row per indicator, periods across (a monthly management report)
 *   columns - one row per period, indicators across (most system exports, a shared sheet)
 *   list    - one row per figure: indicator, period, value (a database or BI export)
 * Indicators are matched by the short code the client gave them, else by
 * name in either language; a person can match the rest by hand.
 */

export type Layout = "rows" | "columns" | "list";

/** The most values one batch may bring. */
export const MAX_IMPORT_VALUES = 2000;
/** The most a sheet or a CSV may hold, in bytes. */
export const MAX_SHEET_BYTES = 2 * 1024 * 1024;

// ------------------------------------------------------------ CSV

/** A CSV file as rows: a byte-order mark dropped, the delimiter guessed (comma, semicolon or tab), quotes honoured. */
export function readCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const firstLine = src.slice(0, src.search(/\r?\n|$/));
  const counts = [",", ";", "\t"].map((d) => [d, firstLine.split(d).length] as const);
  const delim = counts.reduce((a, b) => (b[1] > a[1] ? b : a))[0];
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"' && cell === "") quoted = true;
    else if (c === delim) {
      row.push(cell.trim());
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(cell.trim());
      rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (cell !== "" || row.length) {
    row.push(cell.trim());
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c !== ""));
}

// ------------------------------------------------------------ periods

const MONTHS: Record<string, number> = {};
const monthNames: [number, string[]][] = [
  [1, ["jan", "january", "يناير", "كانون الثاني", "جانفي"]],
  [2, ["feb", "february", "فبراير", "شباط", "فيفري"]],
  [3, ["mar", "march", "مارس", "آذار", "اذار"]],
  [4, ["apr", "april", "أبريل", "ابريل", "إبريل", "نيسان", "افريل"]],
  [5, ["may", "مايو", "أيار", "ايار", "ماي"]],
  [6, ["jun", "june", "يونيو", "يونيه", "حزيران", "جوان"]],
  [7, ["jul", "july", "يوليو", "يوليه", "تموز", "جويلية"]],
  [8, ["aug", "august", "أغسطس", "اغسطس", "آب", "اب", "اوت"]],
  [9, ["sep", "sept", "september", "سبتمبر", "أيلول", "ايلول"]],
  [10, ["oct", "october", "أكتوبر", "اكتوبر", "تشرين الأول", "تشرين الاول"]],
  [11, ["nov", "november", "نوفمبر", "تشرين الثاني"]],
  [12, ["dec", "december", "ديسمبر", "كانون الأول", "كانون الاول"]],
];
for (const [m, names] of monthNames) for (const n of names) MONTHS[normText(n)] = m;

const QUARTER_WORDS: Record<string, number> = {};
for (const [q, words] of [
  [1, ["q1", "الربع الأول", "الربع الاول", "ر1"]],
  [2, ["q2", "الربع الثاني", "ر2"]],
  [3, ["q3", "الربع الثالث", "ر3"]],
  [4, ["q4", "الربع الرابع", "ر4"]],
] as [number, string[]][])
  for (const w of words) QUARTER_WORDS[normText(w)] = q;

const iso = (y: number, m: number) => (y >= 1990 && y <= 2100 && m >= 1 && m <= 12 ? `${y}-${String(m).padStart(2, "0")}-01` : null);
const fullYear = (y: string) => (y.length === 2 ? 2000 + Number(y) : Number(y));

/**
 * The month a period label means, as its first day (YYYY-MM-01). Takes dates
 * (2026-03-15, 15/03/2026, day first as in Saudi use), months (2026-03,
 * 03/2026, Mar 2026, March-26, مارس 2026, آذار 2026) and quarters (Q1 2026,
 * الربع الأول 2026: the quarter's first month). Null when it is not one.
 */
export function parsePeriod(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = asciiDigits(raw.normalize("NFKC")).trim();
  if (!s || s.length > 40) return null;
  let m: RegExpMatchArray | null;
  // 2026-03-15, 2026/03/15, 2026-03, 2026.03
  if ((m = s.match(/^(\d{4})[-/.](\d{1,2})(?:[-/.](\d{1,2}))?(?:[T ].*)?$/))) return iso(Number(m[1]), Number(m[2]));
  // 15/03/2026, 15-03-26 (day first)
  if ((m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4}|\d{2})$/))) return iso(fullYear(m[3]!), Number(m[2]));
  // 03/2026, 3-2026
  if ((m = s.match(/^(\d{1,2})[-/.](\d{4})$/))) return iso(Number(m[2]), Number(m[1]));
  // 202603
  if ((m = s.match(/^(20\d{2})(0[1-9]|1[0-2])$/))) return iso(Number(m[1]), Number(m[2]));
  const text = normText(s.replace(/[-_/,.']/g, " "));
  // Q1 2026, 2026 Q1, Q1-26, الربع الأول 2026
  const year = text.match(/(?:^|\s)(\d{4}|\d{2})(?:\s|$)/);
  const words = text.replace(/(?:^|\s)(\d{4}|\d{2})(?=\s|$)/, " ").replace(/\s+/g, " ").trim();
  if (year) {
    const y = fullYear(year[1]!);
    const qWord = QUARTER_WORDS[words] ?? QUARTER_WORDS[words.replace(/\s/g, "")];
    if (qWord) return iso(y, (qWord - 1) * 3 + 1);
    const month = MONTHS[words];
    if (month) return iso(y, month);
  }
  return null;
}

// ------------------------------------------------------------ numbers

/**
 * A figure as a number. Arabic digits and separators, thousands commas,
 * spaces, currency and percent signs and accounting brackets for negatives
 * are understood. Null for an empty cell or a dash; NaN for text that is not
 * a number.
 */
export function parseNumber(raw: string | number | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : NaN;
  let s = asciiDigits(raw.normalize("NFKC")).trim();
  if (!s || /^[-–—.]+$/.test(s) || /^(n\/?a|na|null|غير متوفر|لا يوجد)$/i.test(s)) return null;
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  s = s
    .replace(/(sar|sr|usd|ر\.?\s?س|ريال|﷼|\$|%|٪)/gi, "")
    .replace(/[\s  ]/g, "")
    .replace(/٬/g, ",")
    .replace(/٫/g, ".");
  if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, "");
  else if (/^-?\d+,\d{1,2}$/.test(s)) s = s.replace(",", ".");
  if (!/^-?\d+(\.\d+)?$/.test(s)) return NaN;
  const n = Number(s);
  return negative ? -n : n;
}

// ------------------------------------------------------------ shape of a table

const HEADER_WORDS: Record<"label" | "period" | "value" | "note", string[]> = {
  label: ["indicator", "kpi", "metric", "measure", "name", "code", "item", "المؤشر", "مؤشر", "اسم المؤشر", "البند", "الرمز", "المقياس"],
  period: ["period", "month", "date", "quarter", "الفترة", "الشهر", "التاريخ", "الربع", "الفتره"],
  value: ["value", "actual", "amount", "figure", "result", "القيمة", "القيمه", "الفعلي", "المبلغ", "النتيجة", "النتيجه", "الرقم"],
  note: ["note", "notes", "comment", "comments", "remarks", "ملاحظة", "ملاحظه", "ملاحظات", "تعليق"],
};
const headerKind = (h: string) => {
  const n = normText(h);
  if (!n) return null;
  for (const [kind, words] of Object.entries(HEADER_WORDS)) if (words.some((w) => normText(w) === n)) return kind as keyof typeof HEADER_WORDS;
  return null;
};

export interface TableShape {
  layout: Layout;
  headerRow: number;
  /** rows: the indicators' column; list: the indicator column. */
  labelCol: number | null;
  /** columns and list: the period column. */
  periodCol: number | null;
  /** list: the value column. */
  valueCol: number | null;
  /** list: an optional note column. */
  noteCol: number | null;
}

const width = (rows: string[][]) => rows.reduce((w, r) => Math.max(w, r.length), 0);

/** The first row of the first few with two or more filled cells: the header. */
function headerRowOf(rows: string[][]): number {
  for (let i = 0; i < Math.min(rows.length, 20); i++) if (rows[i]!.filter((c) => c.trim()).length >= 2) return i;
  return 0;
}

/** A guess at a table's shape; the review screen lets a person change it. */
export function detectShape(rows: string[][]): TableShape {
  const headerRow = headerRowOf(rows);
  const header = rows[headerRow] ?? [];
  const data = rows.slice(headerRow + 1, headerRow + 41);
  const none = { labelCol: null, periodCol: null, valueCol: null, noteCol: null };
  // Periods across the header: one row per indicator.
  const periodHeads = header.filter((h) => parsePeriod(h)).length;
  if (periodHeads >= 2) {
    const labelCol = header.findIndex((h) => !parsePeriod(h));
    return { ...none, layout: "rows", headerRow, labelCol: labelCol < 0 ? 0 : labelCol };
  }
  const kinds = header.map(headerKind);
  // A column whose cells are mostly periods (or named as one).
  let periodCol = kinds.indexOf("period");
  if (periodCol < 0) {
    for (let c = 0; c < width(rows); c++) {
      const cells = data.map((r) => r[c] ?? "").filter(Boolean);
      if (cells.length && cells.filter((x) => parsePeriod(x)).length / cells.length >= 0.8) {
        periodCol = c;
        break;
      }
    }
  }
  const valueCol = kinds.indexOf("value");
  const labelCol = kinds.indexOf("label");
  const noteCol = kinds.indexOf("note");
  if (labelCol >= 0 && valueCol >= 0) {
    return { layout: "list", headerRow, labelCol, periodCol: periodCol < 0 ? null : periodCol, valueCol, noteCol: noteCol < 0 ? null : noteCol };
  }
  return { ...none, layout: "columns", headerRow, periodCol: periodCol < 0 ? 0 : periodCol };
}

/** One figure read from a file, before it is matched to an indicator. */
export interface ReadValue {
  /** The file's row (1-based), for the review screen. */
  line: number;
  /** What the file calls the indicator. */
  label: string;
  rawPeriod: string;
  period: string | null;
  rawValue: string;
  value: number | null;
  note: string | null;
}

/** Every figure in a table of the given shape. Empty cells are left out; they are not zeros. */
export function readValues(rows: string[][], shape: TableShape): ReadValue[] {
  const out: ReadValue[] = [];
  const header = rows[shape.headerRow] ?? [];
  const push = (line: number, label: string, rawPeriod: string, rawValue: string, note: string | null = null) => {
    if (!label.trim() || !rawValue.trim()) return;
    const value = parseNumber(rawValue);
    if (value === null) return;
    out.push({ line, label: label.trim(), rawPeriod: rawPeriod.trim(), period: parsePeriod(rawPeriod), rawValue: rawValue.trim(), value, note: note?.trim() || null });
  };
  for (let r = shape.headerRow + 1; r < rows.length; r++) {
    const row = rows[r]!;
    if (shape.layout === "rows") {
      const label = row[shape.labelCol ?? 0] ?? "";
      header.forEach((h, c) => {
        if (c !== shape.labelCol && parsePeriod(h)) push(r + 1, label, h, row[c] ?? "");
      });
    } else if (shape.layout === "columns") {
      const rawPeriod = row[shape.periodCol ?? 0] ?? "";
      header.forEach((h, c) => {
        if (c !== shape.periodCol && h.trim()) push(r + 1, h, rawPeriod, row[c] ?? "");
      });
    } else {
      push(
        r + 1,
        row[shape.labelCol ?? 0] ?? "",
        shape.periodCol === null ? "" : (row[shape.periodCol] ?? ""),
        row[shape.valueCol ?? 0] ?? "",
        shape.noteCol === null ? null : (row[shape.noteCol] ?? null),
      );
    }
    if (out.length > MAX_IMPORT_VALUES * 2) break;
  }
  return out;
}

// ------------------------------------------------------------ matching and checking

export interface IndicatorRef {
  id: string;
  nameAr: string | null;
  nameEn: string | null;
  code: string | null;
  frequency: "monthly" | "quarterly";
  baselinePeriod: string;
  active: boolean;
  feedOn?: boolean;
}

/** The indicator a file's label means: its code, else its name in either language (spelling folded). */
export function matchIndicator(label: string, indicators: IndicatorRef[]): string | null {
  const raw = label.trim().toLowerCase();
  const byCode = indicators.find((k) => k.code && k.code === raw);
  if (byCode) return byCode.id;
  const n = normText(label);
  if (!n) return null;
  const byName = indicators.filter((k) => (k.nameAr && normText(k.nameAr) === n) || (k.nameEn && normText(k.nameEn) === n));
  return byName.length === 1 ? byName[0]!.id : null;
}

/** Labels to indicators: the automatic matches, with a person's choices on top (null: leave the label out). */
export function matchLabels(labels: string[], indicators: IndicatorRef[], chosen: Record<string, string | null> = {}): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const l of labels) out[l] = l in chosen ? chosen[l]! : matchIndicator(l, indicators);
  return out;
}

export type PlanStatus = "add" | "correct" | "same";
export type PlanIssue = "unmatched" | "no_period" | "bad_value" | "baseline" | "not_a_period" | "future" | "inactive" | "duplicate" | "not_connected" | "keep";

export interface PlannedValue {
  line: number;
  label: string;
  kpiId: string | null;
  period: string | null;
  value: number | null;
  note: string | null;
  /** What saving does with it, or why it is left out. */
  status: PlanStatus | null;
  issue: PlanIssue | null;
  /** The value it replaces, for a correction. */
  current: { id: string; value: number } | null;
}

const monthsBetween = (a: string, b: string) => (Number(b.slice(0, 4)) * 12 + Number(b.slice(5, 7))) - (Number(a.slice(0, 4)) * 12 + Number(a.slice(5, 7)));

/**
 * What a batch does: each figure added for a period with none, a correction
 * of a period's current value when the figure differs (only when corrections
 * are on), or nothing when it is the same. Figures that can't count say why:
 * no matching indicator, no period, not a number, the baseline's own period,
 * not one of the indicator's periods (a quarterly one), a period not started,
 * an indicator switched off, the same indicator and period twice in the
 * batch, or (from a connection) an indicator the client keeps off it.
 */
export function planValues(
  values: { line: number; label: string; period: string | null; value: number | null; note: string | null }[],
  labelMap: Record<string, string | null>,
  indicators: IndicatorRef[],
  current: Map<string, { id: string; value: number }>,
  opts: { today: string; corrections: boolean; connection?: boolean },
): PlannedValue[] {
  const byId = new Map(indicators.map((k) => [k.id, k]));
  const seen = new Set<string>();
  return values.map((v) => {
    const kpiId = labelMap[v.label] ?? null;
    const base = { line: v.line, label: v.label, kpiId, period: v.period, value: v.value, note: v.note, current: null, status: null };
    const k = kpiId ? byId.get(kpiId) : undefined;
    const issue = (i: PlanIssue): PlannedValue => ({ ...base, issue: i });
    if (!k) return issue("unmatched");
    if (!k.active) return issue("inactive");
    if (opts.connection && !k.feedOn) return issue("not_connected");
    if (v.value === null || Number.isNaN(v.value)) return issue("bad_value");
    if (!v.period) return issue("no_period");
    const diff = monthsBetween(k.baselinePeriod, v.period);
    if (diff === 0) return issue("baseline");
    if (diff < 0 || diff % (k.frequency === "quarterly" ? 3 : 1) !== 0) return issue("not_a_period");
    if (v.period > opts.today) return issue("future");
    const key = `${k.id}|${v.period}`;
    if (seen.has(key)) return issue("duplicate");
    seen.add(key);
    const cur = current.get(key) ?? null;
    if (!cur) return { ...base, issue: null, status: "add" };
    if (cur.value === v.value) return { ...base, issue: null, status: "same", current: cur };
    if (!opts.corrections) return { ...base, issue: "keep", current: cur };
    return { ...base, issue: null, status: "correct", current: cur };
  });
}

export function planCounts(plan: PlannedValue[]) {
  return {
    add: plan.filter((p) => p.status === "add").length,
    correct: plan.filter((p) => p.status === "correct").length,
    same: plan.filter((p) => p.status === "same").length,
    left: plan.filter((p) => p.issue !== null).length,
  };
}

// ------------------------------------------------------------ sheet links

/**
 * The CSV address of a Google Sheet link a person pastes: a "published to
 * the web" link (…/d/e/…/pub…) or a sharing link (…/d/<id>/edit#gid=…), as
 * the sheet's CSV export. Null for anything else: Selah reads only Google
 * Sheets links and plain https CSV links on the hosts the firm allows.
 */
export function sheetCsvUrl(raw: string, extraHosts: string[] = []): string | null {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || u.username || u.password || u.port) return null;
  if (u.hostname === "docs.google.com") {
    const published = u.pathname.match(/^\/spreadsheets\/d\/e\/([\w-]+)\/pub(?:html)?$/);
    if (published) {
      const gid = u.searchParams.get("gid");
      return `https://docs.google.com/spreadsheets/d/e/${published[1]}/pub?output=csv${gid && /^\d+$/.test(gid) ? `&gid=${gid}` : ""}`;
    }
    const shared = u.pathname.match(/^\/spreadsheets\/d\/([\w-]{20,})(?:\/.*)?$/);
    if (shared) {
      const gid = (u.hash.match(/gid=(\d+)/) ?? u.search.match(/gid=(\d+)/))?.[1];
      return `https://docs.google.com/spreadsheets/d/${shared[1]}/export?format=csv${gid ? `&gid=${gid}` : ""}`;
    }
    return null;
  }
  if (extraHosts.includes(u.hostname.toLowerCase())) return u.toString();
  return null;
}

/** Hosts a sheet read may be redirected to on its way (Google serves the CSV from its content host). */
export function sheetHostAllowed(host: string, extraHosts: string[] = []): boolean {
  const h = host.toLowerCase();
  return h === "docs.google.com" || h.endsWith(".googleusercontent.com") || extraHosts.includes(h);
}

/** A short key for files and systems from a name: "Customer complaints" → "customer-complaints". */
export function suggestCode(nameEn: string | null): string {
  return (nameEn ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}
