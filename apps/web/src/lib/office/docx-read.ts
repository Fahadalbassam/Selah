import { parseXml } from "./xml";
import { OfficeFileError, readEntries } from "./zip";

/** The body of a Word document, in reading order. */
export type DocBlock =
  | { type: "heading"; level: number; text: string }
  | { type: "paragraph"; text: string; list: boolean }
  | { type: "table"; rows: string[][] };

export const DOCX_LIMITS = { blocks: 5000, tableRows: 2000, tableColumns: 60 };

type ONode = Record<string, unknown>;

function tagOf(n: ONode): string | null {
  for (const k of Object.keys(n)) if (k !== ":@") return k;
  return null;
}
const kids = (n: ONode): ONode[] => {
  const t = tagOf(n);
  const v = t ? n[t] : undefined;
  return Array.isArray(v) ? (v as ONode[]) : [];
};
const attrOf = (n: ONode | undefined, name: string) => ((n?.[":@"] as Record<string, string> | undefined) ?? {})[`@_${name}`];
const child = (n: ONode, tag: string) => kids(n).find((k) => tagOf(k) === tag);

// Parts of a run that carry no visible text, or text that was deleted (tracked changes).
const SKIP = new Set(["pPr", "rPr", "del", "delText", "instrText", "moveFrom", "commentReference", "footnoteReference", "endnoteReference"]);

function textOf(n: ONode): string {
  const tag = tagOf(n);
  if (tag === "#text") return String(n["#text"] ?? "");
  if (!tag || SKIP.has(tag)) return "";
  if (tag === "tab") return "\t";
  if (tag === "br" || tag === "cr") return "\n";
  if (tag === "noBreakHyphen") return "-";
  if (tag === "t") return kids(n).map((k) => String(k["#text"] ?? "")).join("");
  return kids(n).map(textOf).join("");
}

interface StyleInfo {
  name: string;
  level: number | null;
  list: boolean;
  basedOn?: string;
}

/** Heading level and list-ness of each paragraph style, from styles.xml (style names stay English in every Word language). */
function readStyles(xml: string | undefined): Map<string, StyleInfo> {
  const styles = new Map<string, StyleInfo>();
  if (!xml) return styles;
  const root = (parseXml(xml, { arrays: ["style"] }) as ONode).styles as ONode | undefined;
  const all = root?.style;
  for (const s of (Array.isArray(all) ? all : []) as ONode[]) {
    const id = s["@_styleId"] as string | undefined;
    if (!id) continue;
    const name = String((s.name as ONode | undefined)?.["@_val"] ?? id).toLowerCase();
    const pPr = s.pPr as ONode | undefined;
    const outline = (pPr?.outlineLvl as ONode | undefined)?.["@_val"];
    const heading = /^heading\s*(\d)$/.exec(name);
    styles.set(id, {
      name,
      level: heading ? Number(heading[1]) : outline !== undefined ? Number(outline) + 1 : null,
      list: name.startsWith("list") || pPr?.numPr !== undefined,
      basedOn: (s.basedOn as ONode | undefined)?.["@_val"] as string | undefined,
    });
  }
  return styles;
}

function styleOf(styles: Map<string, StyleInfo>, id: string | undefined): { level: number | null; list: boolean; name: string } {
  let s = id ? styles.get(id) : undefined;
  const name = s?.name ?? "";
  let level: number | null = null;
  let list = false;
  // Follow "based on" a few steps, for styles derived from a heading.
  for (let i = 0; s && i < 5; i++) {
    level ??= s.level;
    list ||= s.list;
    s = s.basedOn ? styles.get(s.basedOn) : undefined;
  }
  return { level, list, name };
}

/** Read the paragraphs, headings, list items and tables of a .docx body. Headers, footers and comments are left out. */
export function readDocx(bytes: Uint8Array): DocBlock[] {
  const files = readEntries(bytes, (p) => p === "word/document.xml" || p === "word/styles.xml");
  const xml = files.get("word/document.xml");
  if (!xml) throw new OfficeFileError("not_office");
  const styles = readStyles(files.get("word/styles.xml"));
  const root = parseXml(xml, { ordered: true }) as ONode[];
  const doc = root.find((n) => tagOf(n) === "document");
  const body = doc ? child(doc, "body") : undefined;
  if (!body) throw new OfficeFileError("not_office");

  const blocks: DocBlock[] = [];
  const paragraph = (p: ONode) => {
    const pPr = child(p, "pPr");
    const styleId = pPr ? attrOf(child(pPr, "pStyle"), "val") : undefined;
    const style = styleOf(styles, styleId);
    if (style.name.startsWith("toc") || style.name === "title" || style.name === "subtitle") return;
    const text = kids(p).map(textOf).join("").replace(/[ \t ]+/g, " ").trim();
    if (!text) return;
    const outline = pPr ? attrOf(child(pPr, "outlineLvl"), "val") : undefined;
    const level = outline !== undefined && Number(outline) < 9 ? Number(outline) + 1 : style.level;
    if (level !== null && level >= 1 && level <= 9) blocks.push({ type: "heading", level, text });
    else blocks.push({ type: "paragraph", text, list: style.list || (pPr ? child(pPr, "numPr") !== undefined : false) });
  };
  const table = (tbl: ONode) => {
    const rows: string[][] = [];
    for (const tr of kids(tbl).filter((k) => tagOf(k) === "tr")) {
      if (rows.length >= DOCX_LIMITS.tableRows) break;
      const cells: string[] = [];
      for (const tc of kids(tr).filter((k) => tagOf(k) === "tc")) {
        const tcPr = child(tc, "tcPr");
        const span = Math.max(1, Math.min(DOCX_LIMITS.tableColumns, Number(attrOf(tcPr ? child(tcPr, "gridSpan") : undefined, "val") ?? 1) || 1));
        // A vertically merged continuation cell is empty here; the importer fills it from above.
        const text = cellText(tc);
        cells.push(text, ...Array<string>(span - 1).fill(""));
      }
      rows.push(cells.slice(0, DOCX_LIMITS.tableColumns));
    }
    if (rows.some((r) => r.some((c) => c))) blocks.push({ type: "table", rows });
  };
  const walk = (nodes: ONode[]) => {
    for (const n of nodes) {
      if (blocks.length >= DOCX_LIMITS.blocks) return;
      const tag = tagOf(n);
      if (tag === "p") paragraph(n);
      else if (tag === "tbl") table(n);
      // Content controls and tracked insertions wrap ordinary body content.
      else if (tag === "sdt") walk(kids(child(n, "sdtContent") ?? {}));
      else if (tag === "ins" || tag === "customXml" || tag === "smartTag") walk(kids(n));
    }
  };
  walk(kids(body));
  return blocks;
}

/** A table cell's paragraphs (and any nested table's text), one per line. */
function cellText(tc: ONode): string {
  const lines: string[] = [];
  const walk = (nodes: ONode[]) => {
    for (const n of nodes) {
      const tag = tagOf(n);
      if (tag === "p") {
        const t = kids(n).map(textOf).join("").replace(/[ \t ]+/g, " ").trim();
        if (t) lines.push(t);
      } else if (tag === "tbl" || tag === "tr" || tag === "tc" || tag === "sdt" || tag === "sdtContent") walk(kids(n));
    }
  };
  walk(kids(tc));
  return lines.join("\n");
}
