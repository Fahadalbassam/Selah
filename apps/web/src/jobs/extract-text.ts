// A file's text by page, for the assistant's index (wave 1, item 4). PDF
// through pdftotext (poppler, installed in the jobs image); Word, PowerPoint
// and Excel through the same zip and XML readers the plan import uses, with
// the same limits. A PDF page with no text layer is a scan: it is listed for
// text recognition later instead of quietly indexing nothing.
import { spawn } from "node:child_process";
import { readDocxPages } from "../lib/office/docx-read";
import { readPptxSlides } from "../lib/office/pptx-read";
import { readXlsx } from "../lib/office/xlsx-read";
import type { Page } from "./index-documents";

export interface Extracted {
  pages: Page[];
  /** Pages with no text layer (scanned), waiting for text recognition. */
  scanned: number[];
}

/** Fewer letters than this on a PDF page means it is an image of a page. */
export const SCANNED_PAGE_LETTERS = 20;

const PDFTOTEXT_TIMEOUT_MS = 60_000;
const PDFTOTEXT_MAX_BYTES = 20 * 1024 * 1024;

/** pdftotext isn't installed: the file waits instead of being marked unreadable. */
export class ExtractorMissingError extends Error {}

const numbered = (texts: string[]): Page[] => texts.map((text, i) => ({ n: i + 1, text }));

/**
 * Arabic as pdftotext gives it, made to match what people type:
 *  - presentation forms (common in PDFs from older tools) fold back to
 *    ordinary letters (NFKC);
 *  - the direction marks it adds around each line are dropped;
 *  - poppler writes the lam-alef ligature in reverse. After the article
 *    ("الإدارة" comes out "اإلدارة") the reversed form can't occur in real
 *    Arabic, so it is put right. A plain lam-alef ("خلال" as "خالل") can't be
 *    told from real text and is left; the multilingual embedding still finds
 *    the passage, and the cited page shows the real words.
 */
export function cleanPdfText(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, "")
    .replace(/ا([إأآ])ل/g, "ال$1")
    .replace(/[ \t]+\n/g, "\n");
}

/** pdftotext's output: a form feed ends each page. */
export function pdfPages(raw: string): Extracted {
  const texts = raw.split("\f");
  if (texts.length > 1 && !texts[texts.length - 1]!.trim()) texts.pop();
  const pages = numbered(texts.map(cleanPdfText));
  const scanned = pages.filter((p) => (p.text.match(/\p{L}/gu)?.length ?? 0) < SCANNED_PAGE_LETTERS).map((p) => p.n);
  return { pages: pages.map((p) => (scanned.includes(p.n) ? { ...p, text: "" } : p)), scanned };
}

/** Run pdftotext on the bytes (stdin to stdout, never a file on disk). */
export function runPdftotext(bytes: Uint8Array): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("pdftotext", ["-enc", "UTF-8", "-q", "-", "-"], { stdio: ["pipe", "pipe", "ignore"], timeout: PDFTOTEXT_TIMEOUT_MS });
    const chunks: Buffer[] = [];
    let size = 0;
    child.stdout.on("data", (c: Buffer) => {
      size += c.length;
      if (size > PDFTOTEXT_MAX_BYTES) child.kill();
      else chunks.push(c);
    });
    child.on("error", (e: NodeJS.ErrnoException) => reject(e.code === "ENOENT" ? new ExtractorMissingError("pdftotext is not installed") : e));
    child.on("close", (code) => (code === 0 ? resolve(Buffer.concat(chunks).toString("utf8")) : reject(new Error(`pdftotext failed (${code})`))));
    child.stdin.on("error", () => undefined); // a file pdftotext refuses closes the pipe early
    child.stdin.end(Buffer.from(bytes));
  });
}

const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const PPTX = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/**
 * A file's pages. Throws on a file that can't be read (damaged, encrypted, a
 * crafted archive); the caller marks it not searchable.
 */
export async function extractText(contentType: string, bytes: Uint8Array, pdftotext = runPdftotext): Promise<Extracted> {
  switch (contentType) {
    case "application/pdf":
      return pdfPages(await pdftotext(bytes));
    case DOCX:
      return { pages: numbered(readDocxPages(bytes)), scanned: [] };
    case PPTX:
      return { pages: numbered(readPptxSlides(bytes)), scanned: [] };
    case XLSX:
      // A sheet is a page: an answer cites "page 2" for the second sheet.
      return {
        pages: numbered(readXlsx(bytes).map((s) => [s.name, ...s.rows.map((r) => r.join("\t").trim()).filter(Boolean)].join("\n"))),
        scanned: [],
      };
    default:
      if (contentType.startsWith("text/")) return { pages: numbered(new TextDecoder().decode(bytes).split("\f")), scanned: [] };
      if (contentType.startsWith("image/")) return { pages: [], scanned: [1] };
      throw new Error(`no reader for ${contentType}`);
  }
}
