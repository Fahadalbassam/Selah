import { xmlEscape } from "./xml";
import { writeZip } from "./zip";

/**
 * A minimal .xlsx writer for exports. Every text cell is an inline string, so
 * nothing a user typed can become a formula when the file is opened (the
 * "CSV injection" problem does not arise). Dates are real dates.
 */
export type CellValue = string | number | { date: string } | null | undefined;

export interface SheetSpec {
  name: string;
  /** Right-to-left sheet (Arabic). */
  rtl: boolean;
  columns: { header: string; width?: number }[];
  rows: CellValue[][];
}

const STYLE = { text: 0, header: 1, date: 2, wrap: 3 } as const;

function columnLetters(i: number): string {
  let s = "";
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

/** Days since 1899-12-30, Excel's day number for an ISO date. */
function isoToSerial(iso: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return null;
  return Math.round((Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!) - Date.UTC(1899, 11, 30)) / 86_400_000);
}

/** Sheet names: at most 31 characters, none of []:*?/\ */
export function sheetName(name: string): string {
  return name.replace(/[[\]:*?/\\]/g, " ").trim().slice(0, 31) || "Sheet";
}

function sheetXml(sheet: SheetSpec): string {
  const cols = sheet.columns
    .map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.width ?? 18}" customWidth="1"/>`)
    .join("");
  const cell = (v: CellValue, r: number, c: number, header: boolean): string => {
    const ref = `${columnLetters(c)}${r}`;
    if (v === null || v === undefined || v === "") return "";
    if (typeof v === "number") return Number.isFinite(v) ? `<c r="${ref}"><v>${v}</v></c>` : "";
    if (typeof v === "object") {
      const serial = isoToSerial(v.date);
      return serial === null ? "" : `<c r="${ref}" s="${STYLE.date}"><v>${serial}</v></c>`;
    }
    const style = header ? STYLE.header : v.length > 60 || v.includes("\n") ? STYLE.wrap : STYLE.text;
    // Excel's limit for one cell.
    const text = xmlEscape(v.slice(0, 32_000));
    return `<c r="${ref}" t="inlineStr"${style ? ` s="${style}"` : ""}><is><t xml:space="preserve">${text}</t></is></c>`;
  };
  const header = `<row r="1">${sheet.columns.map((c, i) => cell(c.header, 1, i, true)).join("")}</row>`;
  const body = sheet.rows.map((row, r) => `<row r="${r + 2}">${row.map((v, c) => cell(v, r + 2, c, false)).join("")}</row>`).join("");
  const last = `${columnLetters(Math.max(0, sheet.columns.length - 1))}${sheet.rows.length + 1}`;
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<sheetViews><sheetView workbookViewId="0"${sheet.rtl ? ` rightToLeft="1"` : ""}>` +
    `<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>` +
    `<sheetFormatPr defaultRowHeight="15"/>` +
    (cols ? `<cols>${cols}</cols>` : "") +
    `<sheetData>${header}${body}</sheetData>` +
    (sheet.columns.length ? `<autoFilter ref="A1:${last}"/>` : "") +
    `</worksheet>`
  );
}

const STYLES =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
  `<numFmts count="1"><numFmt numFmtId="164" formatCode="yyyy-mm-dd"/></numFmts>` +
  `<fonts count="2"><font><sz val="11"/><name val="Arial"/></font><font><b/><sz val="11"/><name val="Arial"/></font></fonts>` +
  `<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>` +
  `<fill><patternFill patternType="solid"><fgColor rgb="FFEDEDED"/><bgColor indexed="64"/></patternFill></fill></fills>` +
  `<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>` +
  `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
  `<cellXfs count="4">` +
  `<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"><alignment vertical="top"/></xf>` +
  `<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"><alignment vertical="top" wrapText="1"/></xf>` +
  `<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"><alignment vertical="top" horizontal="left"/></xf>` +
  `<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>` +
  `</cellXfs>` +
  `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>` +
  `</styleSheet>`;

/** The hidden ranges that make each header row's filter work. */
function definedNames(sheets: SheetSpec[], names: string[]): string {
  const items = sheets
    .map((s, i) =>
      s.columns.length
        ? `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">'${xmlEscape(names[i]!.replace(/'/g, "''"))}'!$A$1:$${columnLetters(s.columns.length - 1)}$${s.rows.length + 1}</definedName>`
        : "",
    )
    .join("");
  return items ? `<definedNames>${items}</definedNames>` : "";
}

/** Build an .xlsx file from one or more sheets. */
export function writeXlsx(sheets: SheetSpec[]): Uint8Array {
  const names = new Set<string>();
  const unique = sheets.map((s, i) => {
    let n = sheetName(s.name);
    while (names.has(n.toLowerCase())) n = sheetName(`${n.slice(0, 27)} ${i + 1}`);
    names.add(n.toLowerCase());
    return n;
  });
  const entries: Record<string, string> = {
    "[Content_Types].xml":
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
      `<Default Extension="xml" ContentType="application/xml"/>` +
      `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
      `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
      sheets
        .map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`)
        .join("") +
      `</Types>`,
    "_rels/.rels":
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
      `</Relationships>`,
    "xl/workbook.xml":
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
      `<bookViews><workbookView${sheets[0]?.rtl ? ` rightToLeft="1"` : ""}/></bookViews>` +
      `<sheets>${unique.map((n, i) => `<sheet name="${xmlEscape(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets>` +
      definedNames(sheets, unique) +
      `</workbook>`,
    "xl/_rels/workbook.xml.rels":
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      sheets
        .map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`)
        .join("") +
      `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
      `</Relationships>`,
    "xl/styles.xml": STYLES,
  };
  sheets.forEach((s, i) => (entries[`xl/worksheets/sheet${i + 1}.xml`] = sheetXml(s)));
  return writeZip(entries);
}
