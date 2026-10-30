import { parseXml } from "./xml";
import { OfficeFileError, readEntries } from "./zip";

/** One worksheet as text cells, top to bottom. Date cells come back as YYYY-MM-DD. */
export interface SheetData {
  name: string;
  rows: string[][];
  /** More rows or columns than the reader keeps. */
  truncated: boolean;
}

export const SHEET_LIMITS = { rows: 2000, columns: 60, sheets: 30 };

type Node = Record<string, unknown>;
const list = (v: unknown): Node[] => (Array.isArray(v) ? v : v === undefined || v === null ? [] : [v]) as Node[];
const attr = (n: Node | undefined, name: string) => (n ? (n[`@_${name}`] as string | undefined) : undefined);

/** The visible text of a shared or inline string (plain, or rich text runs). Phonetic hints are skipped. */
function stringText(si: unknown): string {
  if (si === undefined || si === null) return "";
  if (typeof si === "string") return si;
  const n = si as Node;
  if ("#text" in n && typeof n["#text"] === "string") return n["#text"] as string;
  let out = "";
  if (n.t !== undefined) out += stringText(n.t);
  for (const r of list(n.r)) out += stringText(r.t);
  return out;
}

/** Column letters of a cell reference ("BC12") as a 0-based index. */
export function columnIndex(ref: string): number {
  const letters = /^[A-Z]+/i.exec(ref)?.[0]?.toUpperCase() ?? "";
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

const BUILTIN_DATE_FORMATS = new Set([14, 15, 16, 17, 22, 27, 28, 29, 30, 31, 34, 35, 36, 45, 46, 47, 50, 51, 52, 53, 54, 55, 56, 57, 58]);

/** Whether a number format shows a date (not only a time of day). */
export function isDateFormat(code: string): boolean {
  const cleaned = code
    .replace(/"[^"]*"/g, "")
    .replace(/\[[^\]]*\]/g, "")
    .replace(/\\./g, "")
    .replace(/[_*]./g, "");
  if (/[dy]/i.test(cleaned)) return true;
  return /m/i.test(cleaned) && !/[hs]/i.test(cleaned);
}

/** An Excel serial day number as a calendar date. */
export function serialToIso(serial: number, date1904 = false): string | null {
  if (!Number.isFinite(serial) || serial < 1 || serial > 2958465) return null;
  const days = Math.floor(serial);
  const base = date1904 ? Date.UTC(1904, 0, 1) : days < 60 ? Date.UTC(1899, 11, 31) : Date.UTC(1899, 11, 30);
  return new Date(base + days * 86_400_000).toISOString().slice(0, 10);
}

function resolveTarget(target: string): string {
  if (target.startsWith("/")) return target.slice(1);
  const parts = `xl/${target}`.split("/");
  const out: string[] = [];
  for (const p of parts) {
    if (p === "..") out.pop();
    else if (p !== ".") out.push(p);
  }
  return out.join("/");
}

/** Whether a number format shows a percentage (outside quoted text). */
export function isPercentFormat(code: string): boolean {
  return /%/.test(code.replace(/"[^"]*"/g, "").replace(/\\./g, ""));
}

/**
 * Read the visible worksheets of an .xlsx workbook. Formulas are never
 * evaluated: a cell gives its saved value. With `percents`, a cell formatted
 * as a percentage gives what it shows ("12.5%" for a stored 0.125), as a CSV
 * export of the same sheet would.
 */
export function readXlsx(bytes: Uint8Array, options: { percents?: boolean } = {}): SheetData[] {
  const files = readEntries(bytes, (p) => p.startsWith("xl/") && (p.endsWith(".xml") || p.endsWith(".rels")));
  const workbookXml = files.get("xl/workbook.xml");
  if (!workbookXml) throw new OfficeFileError("not_office");
  const workbook = (parseXml(workbookXml, { arrays: ["sheet"] }) as Node).workbook as Node | undefined;
  if (!workbook) throw new OfficeFileError("not_office");
  const date1904 = ["1", "true"].includes(attr(workbook.workbookPr as Node, "date1904") ?? "");

  const rels = new Map<string, string>();
  const relsXml = files.get("xl/_rels/workbook.xml.rels");
  if (relsXml) {
    const root = (parseXml(relsXml, { arrays: ["Relationship"] }) as Node).Relationships as Node | undefined;
    for (const r of list(root?.Relationship)) rels.set(attr(r, "Id") ?? "", resolveTarget(attr(r, "Target") ?? ""));
  }

  const shared: string[] = [];
  const sstXml = files.get("xl/sharedStrings.xml");
  if (sstXml) {
    const sst = (parseXml(sstXml, { arrays: ["si", "r"] }) as Node).sst as Node | undefined;
    for (const si of list(sst?.si)) shared.push(stringText(si));
  }

  // Which cell styles show dates.
  const dateStyles = new Set<number>();
  const percentStyles = new Set<number>();
  const stylesXml = files.get("xl/styles.xml");
  if (stylesXml) {
    const sheet = (parseXml(stylesXml, { arrays: ["xf", "numFmt"] }) as Node).styleSheet as Node | undefined;
    const custom = new Map<number, string>();
    for (const f of list((sheet?.numFmts as Node | undefined)?.numFmt)) custom.set(Number(attr(f, "numFmtId")), attr(f, "formatCode") ?? "");
    list((sheet?.cellXfs as Node | undefined)?.xf).forEach((xf, i) => {
      const id = Number(attr(xf, "numFmtId") ?? 0);
      if (BUILTIN_DATE_FORMATS.has(id) || (custom.has(id) && isDateFormat(custom.get(id)!))) dateStyles.add(i);
      else if (options.percents && (id === 9 || id === 10 || (custom.has(id) && isPercentFormat(custom.get(id)!)))) percentStyles.add(i);
    });
  }

  const sheets: SheetData[] = [];
  for (const s of list((workbook.sheets as Node | undefined)?.sheet)) {
    if (sheets.length >= SHEET_LIMITS.sheets) break;
    if (attr(s, "state") === "hidden" || attr(s, "state") === "veryHidden") continue;
    const path = rels.get(attr(s, "id") ?? "");
    const xml = path ? files.get(path) : undefined;
    if (!xml) continue;
    const ws = (parseXml(xml, { arrays: ["row", "c", "r"] }) as Node).worksheet as Node | undefined;
    const rows: string[][] = [];
    let truncated = false;
    for (const row of list((ws?.sheetData as Node | undefined)?.row)) {
      const rowNumber = Number(attr(row, "r") ?? rows.length + 1);
      if (rowNumber > SHEET_LIMITS.rows) {
        truncated = true;
        break;
      }
      const cells: string[] = [];
      let next = 0;
      for (const c of list(row.c)) {
        const ref = attr(c, "r");
        const col = ref ? columnIndex(ref) : next;
        next = col + 1;
        if (col >= SHEET_LIMITS.columns) {
          truncated = true;
          continue;
        }
        cells[col] = cellText(c, shared, dateStyles, date1904, percentStyles);
      }
      while (rows.length < rowNumber - 1) rows.push([]);
      rows.push(Array.from(cells, (v) => v ?? ""));
    }
    sheets.push({ name: attr(s, "name") ?? `Sheet ${sheets.length + 1}`, rows: trimRows(rows), truncated });
  }
  return sheets;
}

function cellText(c: Node, shared: string[], dateStyles: Set<number>, date1904: boolean, percentStyles: Set<number>): string {
  const type = attr(c, "t");
  const v = c.v === undefined ? undefined : stringText(c.v);
  switch (type) {
    case "s":
      return shared[Number(v)] ?? "";
    case "inlineStr":
      return stringText(c.is);
    case "str":
      return v ?? "";
    case "b":
      return v === "1" ? "TRUE" : "FALSE";
    case "e":
      return "";
    case "d":
      return (v ?? "").slice(0, 10);
    default: {
      if (v === undefined || v === "") return "";
      const style = Number(attr(c, "s") ?? -1);
      if (dateStyles.has(style)) return serialToIso(Number(v), date1904) ?? v;
      if (percentStyles.has(style) && Number.isFinite(Number(v))) return `${Number((Number(v) * 100).toPrecision(12))}%`;
      return v;
    }
  }
}

/** Drop trailing empty rows and cells. */
export function trimRows(rows: string[][]): string[][] {
  const out = rows.map((r) => {
    let end = r.length;
    while (end > 0 && !r[end - 1]?.trim()) end--;
    return r.slice(0, end);
  });
  while (out.length && out[out.length - 1]!.length === 0) out.pop();
  return out;
}
