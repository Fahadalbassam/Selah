import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { env } from "@/env";
import { escapeHtml, REPORT_FONTS } from "@/lib/report-html";
import { UnavailableError } from "@/server/errors";

// PDFs are drawn by Chromium in its own container (Gotenberg, see
// docker-compose.yml), never inside the web app: the renderer has JavaScript
// off, no route to the internet, and only ever receives HTML we built and
// escaped (lib/report-html.ts) plus the font files. If it is down, the export
// is refused and the screen says so; nothing falls back to a weaker renderer.

const FONT_DIR = path.join(process.cwd(), "node_modules/@fontsource/ibm-plex-sans-arabic/files");

let fonts: Promise<{ name: string; bytes: Buffer }[]> | undefined;
function loadFonts() {
  fonts ??= Promise.all(REPORT_FONTS.map(async (f) => ({ name: f.file, bytes: await readFile(path.join(FONT_DIR, f.source)) })));
  return fonts;
}

/** Page numbers at the bottom of each page (Chromium fills in the two spans). */
function footerHtml(text: string, rtl: boolean): string {
  return `<!doctype html><html dir="${rtl ? "rtl" : "ltr"}"><head><meta charset="utf-8"><style>
body{margin:0 15mm;font-family:sans-serif;font-size:8pt;color:#6b6b6b;width:100%;display:flex;justify-content:space-between;}
</style></head><body><span>${escapeHtml(text)}</span><span dir="ltr"><span class="pageNumber"></span> / <span class="totalPages"></span></span></body></html>`;
}

export async function renderPdf(html: string, options: { locale: "ar" | "en"; footer: string }): Promise<Uint8Array> {
  const base = env().PDF_SERVICE_URL;
  if (!base) throw new UnavailableError("pdf service is not configured");
  const form = new FormData();
  form.append("files", new Blob([html], { type: "text/html" }), "index.html");
  form.append("files", new Blob([footerHtml(options.footer, options.locale === "ar")], { type: "text/html" }), "footer.html");
  for (const f of await loadFonts()) form.append("files", new Blob([new Uint8Array(f.bytes)], { type: "font/woff2" }), f.name);
  form.append("preferCssPageSize", "true");
  form.append("printBackground", "true");
  form.append("failOnConsoleExceptions", "true");
  let res: Response;
  try {
    res = await fetch(new URL("/forms/chromium/convert/html", base), { method: "POST", body: form, signal: AbortSignal.timeout(45_000) });
  } catch (err) {
    console.error("[pdf] renderer unreachable", err);
    throw new UnavailableError("pdf service is unavailable");
  }
  if (!res.ok) {
    console.error("[pdf] renderer refused", res.status, (await res.text().catch(() => "")).slice(0, 300));
    throw new UnavailableError("pdf service is unavailable");
  }
  const bytes = new Uint8Array(await res.arrayBuffer());
  // A PDF starts with "%PDF-"; anything else is not passed on.
  if (bytes.byteLength < 5 || String.fromCharCode(...bytes.subarray(0, 5)) !== "%PDF-") throw new UnavailableError("pdf service is unavailable");
  return bytes;
}
