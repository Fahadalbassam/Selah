import { escapeHtml, REPORT_FONTS } from "./report-html";
import { indicatorSection, type IndicatorTable } from "./indicator-html";

/**
 * The closure report as a printable HTML page, for the PDF service. Pure:
 * every value is escaped here and the page loads nothing but the fonts sent
 * with it. A closed project is read-only, so what it shows is what was
 * settled when the project closed. The firm's lessons are not in it.
 */
export interface ClosureHtmlInput {
  locale: "ar" | "en";
  firmName: string;
  clientName: string | null;
  projectTitle: string;
  startedAt: string;
  closedAt: string | null;
  closedBy: string | null;
  counts: { total: number; verified: number; closed: number; open: number };
  items: { title: string; recommendation: string; status: string; disposition: string; sustainer: string | null; note: string | null }[];
  /** The client's business indicators (KPI layer B), with the note that they are the client's own figures. */
  indicators?: { table: IndicatorTable; claim: string } | null;
  /** Strings under messages "closurePdf". */
  t: (key: string, values?: Record<string, string | number>) => string;
}

export function renderClosureHtml(input: ClosureHtmlInput): string {
  const { locale, t } = input;
  const e = escapeHtml;
  const day = (iso: string) => new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "Asia/Riyadh" }).format(new Date(iso));
  const num = (n: number) => new Intl.NumberFormat(locale).format(n);
  const fonts = REPORT_FONTS.map(
    (f) => `@font-face{font-family:"Plex";src:url("${f.file}") format("woff2");font-weight:${f.weight};font-style:normal;unicode-range:${f.range};}`,
  ).join("");
  const tiles = (["total", "verified", "closed", "open"] as const)
    .map((k) => `<div class="tile"><p class="muted">${e(t(`count.${k}`))}</p><p class="value">${num(input.counts[k])}</p></div>`)
    .join("");
  const rows = input.items
    .map(
      (i) => `<tr>
      <td><span dir="auto">${e(i.title)}</span><br><span class="muted small" dir="auto">${e(i.recommendation)}</span></td>
      <td>${e(i.status)}</td>
      <td>${e(i.disposition)}${i.sustainer ? `<br><span class="small" dir="auto">${e(t("sustainedBy", { name: i.sustainer }))}</span>` : ""}</td>
      <td class="small" dir="auto">${e(i.note ?? "")}</td>
    </tr>`,
    )
    .join("");
  return `<!doctype html>
<html lang="${locale}" dir="${locale === "ar" ? "rtl" : "ltr"}">
<head>
<meta charset="utf-8">
<title>${e(t("title"))}</title>
<style>
${fonts}
@page{size:A4;margin:16mm 15mm 18mm;}
*{box-sizing:border-box;}
html{-webkit-print-color-adjust:exact;print-color-adjust:exact;}
body{margin:0;font-family:"Plex",sans-serif;font-size:10pt;line-height:1.6;color:#262626;background:#fff;}
p{margin:0;}
h1{font-size:18pt;font-weight:600;margin:4mm 0 1mm;line-height:1.3;}
h2{font-size:12pt;font-weight:600;margin:0 0 2mm;}
section{margin-top:7mm;}
.muted{color:#6b6b6b;}
.small{font-size:8.5pt;}
.top{display:flex;justify-content:space-between;align-items:baseline;border-bottom:1px solid #dcdcdc;padding-bottom:3mm;font-size:9pt;}
.firm{font-weight:600;}
.tiles{display:grid;grid-template-columns:repeat(4,1fr);gap:3mm;}
.tile{border:1px solid #dcdcdc;border-radius:3mm;padding:3mm;}
.tile .muted{font-size:8.5pt;line-height:1.35;}
.value{font-size:16pt;font-weight:600;font-variant-numeric:tabular-nums;margin-top:1mm;}
table{width:100%;border-collapse:collapse;margin-top:3mm;font-size:9pt;}
thead{display:table-header-group;}
tr{break-inside:avoid;}
th{font-weight:600;text-align:start;background:#f1f1f1;padding:2mm;border-bottom:1px solid #cfcfcf;}
td{padding:2mm;border-bottom:1px solid #e4e4e4;vertical-align:top;}
.claim{margin-top:8mm;font-size:8.5pt;color:#6b6b6b;border-top:1px solid #dcdcdc;padding-top:3mm;}
</style>
</head>
<body>
<div class="top"><span class="firm" dir="auto">${e(input.firmName)}</span><span class="muted">${e(t("kind"))}</span></div>
<p class="muted" style="margin-top:4mm" dir="auto">${e(input.clientName ? `${input.clientName} · ${input.projectTitle}` : input.projectTitle)}</p>
<h1>${e(t("title"))}</h1>
<p class="muted">${e(t("started", { date: day(input.startedAt) }))}${
    input.closedAt ? ` · ${e(t("closed", { date: day(input.closedAt), who: input.closedBy ?? "—" }))}` : ""
  }</p>
<section><div class="tiles">${tiles}</div></section>
<section>
  <h2>${e(t("openTitle"))}</h2>
  <p class="muted small">${e(t("openNote"))}</p>
  ${
    input.items.length
      ? `<table><thead><tr><th>${e(t("colAction"))}</th><th>${e(t("colStatus"))}</th><th>${e(t("colDecision"))}</th><th>${e(t("colNote"))}</th></tr></thead><tbody>${rows}</tbody></table>`
      : `<p class="muted">${e(t("noOpen"))}</p>`
  }
</section>
${indicatorSection(input.indicators?.table, input.indicators?.claim ?? "")}
<p class="claim">${e(t("claimNote"))}</p>
</body>
</html>`;
}
