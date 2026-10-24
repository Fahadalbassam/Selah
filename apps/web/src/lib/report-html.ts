/**
 * A report as a printable HTML page, for the PDF service. Pure: every value
 * is escaped here, the page carries no script and loads nothing but the
 * font files sent with it, and it mirrors the report screen (the frozen
 * numbers, the notes) plus the actions as they stand on the export day.
 */

export const REPORT_FONTS = [
  { file: "plex-arabic-400.woff2", source: "ibm-plex-sans-arabic-arabic-400-normal.woff2", weight: 400, range: "U+0600-06FF, U+0750-077F, U+0870-089F, U+08A0-08FF, U+200C-200E, U+2010-2011, U+204F, U+2E41, U+FB50-FDFF, U+FE70-FEFC" },
  { file: "plex-arabic-600.woff2", source: "ibm-plex-sans-arabic-arabic-600-normal.woff2", weight: 600, range: "U+0600-06FF, U+0750-077F, U+0870-089F, U+08A0-08FF, U+200C-200E, U+2010-2011, U+204F, U+2E41, U+FB50-FDFF, U+FE70-FEFC" },
  { file: "plex-latin-400.woff2", source: "ibm-plex-sans-arabic-latin-400-normal.woff2", weight: 400, range: "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD" },
  { file: "plex-latin-600.woff2", source: "ibm-plex-sans-arabic-latin-600-normal.woff2", weight: 600, range: "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD" },
] as const;

export interface ReportHtmlInput {
  locale: "ar" | "en";
  firmName: string;
  clientName: string | null;
  projectTitle: string;
  report: {
    title: string;
    periodStart: string | null;
    periodEnd: string | null;
    author: string | null;
    createdAt: string;
    bodyMd: string;
    metrics: {
      total: number;
      verified: number;
      partially: number;
      riskAccepted: number;
      notApplicable: number;
      superseded: number;
      open: number;
      overdue: number;
      implementedPct: number | null;
    } | null;
    /** Not shared with the client yet (said only to the firm). */
    firmOnly: boolean;
  };
  actions: { title: string; recommendation: string; owner: string | null; dueDate: string | null; status: string; overdue: boolean }[];
  exportedOn: string;
  /** Strings under messages "reportPdf". */
  t: (key: string, values?: Record<string, string | number>) => string;
  /** Names of the ways an action can end (messages "metrics.outcome"). */
  outcome: (key: "verified" | "partially" | "riskAccepted" | "notApplicable" | "superseded" | "open") => string;
}

export function escapeHtml(value: string | null | undefined): string {
  return (value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** The fonts and print styles every exported report shares. */
export function reportStyles(): string {
  const fonts = REPORT_FONTS.map(
    (f) => `@font-face{font-family:"Plex";src:url("${f.file}") format("woff2");font-weight:${f.weight};font-style:normal;unicode-range:${f.range};}`,
  ).join("");
  return `${fonts}
@page{size:A4;margin:16mm 15mm 18mm;}
*{box-sizing:border-box;}
html{-webkit-print-color-adjust:exact;print-color-adjust:exact;}
body{margin:0;font-family:"Plex",sans-serif;font-size:10pt;line-height:1.6;color:#262626;background:#fff;}
p{margin:0;}
h1{font-size:18pt;font-weight:600;letter-spacing:-0.01em;margin:4mm 0 1mm;line-height:1.3;}
h2{font-size:12pt;font-weight:600;margin:0 0 2mm;}
section{margin-top:7mm;}
.muted{color:#6b6b6b;}
.small{font-size:8.5pt;}
.nowrap{white-space:nowrap;}
.top{display:flex;justify-content:space-between;align-items:baseline;border-bottom:1px solid #dcdcdc;padding-bottom:3mm;font-size:9pt;}
.firm{font-weight:600;}
.notice{margin-top:4mm;border:1px solid #cfcfcf;border-radius:2mm;padding:2mm 3mm;font-size:9pt;background:#f4f4f4;}
.headline{display:grid;grid-template-columns:1fr 2fr;gap:5mm;break-inside:avoid;}
.big{border:1px solid #dcdcdc;border-radius:3mm;padding:4mm;}
.pct{font-size:30pt;font-weight:600;line-height:1.2;margin:1mm 0 2mm;font-variant-numeric:tabular-nums;}
.meter{height:2mm;border-radius:1mm;background:#ebebeb;overflow:hidden;margin-bottom:2mm;}
.meter span{display:block;height:100%;background:#262626;}
.tiles{display:grid;grid-template-columns:repeat(4,1fr);gap:3mm;}
.tile{border:1px solid #dcdcdc;border-radius:3mm;padding:3mm;}
.tile .muted{font-size:8.5pt;line-height:1.35;}
.value{font-size:16pt;font-weight:600;font-variant-numeric:tabular-nums;margin-top:1mm;}
.notes{white-space:pre-wrap;border:1px solid #dcdcdc;border-radius:3mm;padding:4mm;}
table{width:100%;border-collapse:collapse;margin-top:3mm;font-size:9pt;}
thead{display:table-header-group;}
tr{break-inside:avoid;}
th{font-weight:600;text-align:start;background:#f1f1f1;padding:2mm;border-bottom:1px solid #cfcfcf;}
td{padding:2mm;border-bottom:1px solid #e4e4e4;vertical-align:top;}
.claim{margin-top:8mm;font-size:8.5pt;color:#6b6b6b;border-top:1px solid #dcdcdc;padding-top:3mm;}
`;
}

export function renderReportHtml(input: ReportHtmlInput): string {
  const { locale, report, t } = input;
  const ar = locale === "ar";
  const day = (iso: string) => new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${iso.slice(0, 10)}T00:00:00Z`));
  const num = (n: number) => new Intl.NumberFormat(locale).format(n);
  const e = escapeHtml;
  const m = report.metrics;

  const meta = [
    report.periodStart && report.periodEnd ? t("period", { start: day(report.periodStart), end: day(report.periodEnd) }) : null,
    t("by", { who: report.author ?? "—", date: day(report.createdAt) }),
  ].filter(Boolean);

  const headline = m
    ? `<section class="headline">
  <div class="big">
    <p class="muted">${e(report.periodEnd ? t("frozen", { date: day(report.periodEnd) }) : t("implemented"))}</p>
    <p class="pct">${m.implementedPct === null ? "—" : `${num(Math.round(m.implementedPct))}%`}</p>
    ${
      m.implementedPct === null
        ? `<p class="muted">${e(t("noneYet"))}</p>`
        : `<div class="meter" role="img" aria-label="${e(t("implemented"))}"><span style="width:${Math.max(0, Math.min(100, m.implementedPct)).toFixed(1)}%"></span></div>
    <p class="muted">${e(t("implementedOf", { verified: num(m.verified), applies: num(m.total - m.notApplicable - m.superseded) }))}</p>`
    }
  </div>
  <div class="tiles">
    ${(["verified", "partially", "riskAccepted", "notApplicable", "superseded", "open"] as const)
      .map((k) => `<div class="tile"><p class="muted">${e(input.outcome(k))}</p><p class="value">${num(m[k])}</p></div>`)
      .join("")}
    <div class="tile"><p class="muted">${e(t("overdue"))}</p><p class="value">${num(m.overdue)}</p></div>
  </div>
</section>`
    : "";

  const notes = report.bodyMd.trim()
    ? `<section><h2>${e(t("notes"))}</h2><div class="notes" dir="auto">${e(report.bodyMd)}</div></section>`
    : "";

  const actions = `<section class="actions">
  <h2>${e(t("actionsTitle", { date: day(input.exportedOn) }))}</h2>
  <p class="muted small">${e(t("actionsNote"))}</p>
  ${
    input.actions.length
      ? `<table>
    <thead><tr><th>${e(t("colAction"))}</th><th>${e(t("colOwner"))}</th><th>${e(t("colDue"))}</th><th>${e(t("colStatus"))}</th></tr></thead>
    <tbody>${input.actions
      .map(
        (a) => `<tr>
      <td><span dir="auto">${e(a.title)}</span><br><span class="muted small" dir="auto">${e(a.recommendation)}</span></td>
      <td dir="auto">${e(a.owner ?? t("noOwner"))}</td>
      <td class="nowrap">${a.dueDate ? e(day(a.dueDate)) : "—"}${a.overdue ? `<br><span class="small">${e(t("overdueMark"))}</span>` : ""}</td>
      <td>${e(a.status)}</td>
    </tr>`,
      )
      .join("")}</tbody>
  </table>`
      : `<p class="muted">${e(t("noActions"))}</p>`
  }
</section>`;

  return `<!doctype html>
<html lang="${locale}" dir="${ar ? "rtl" : "ltr"}">
<head>
<meta charset="utf-8">
<title>${e(report.title)}</title>
<style>
${reportStyles()}
</style>
</head>
<body>
<div class="top"><span class="firm" dir="auto">${e(input.firmName)}</span><span class="muted">${e(t("kind"))}</span></div>
<p class="muted" style="margin-top:4mm" dir="auto">${e(input.clientName ? `${input.clientName} · ${input.projectTitle}` : input.projectTitle)}</p>
<h1 dir="auto">${e(report.title)}</h1>
<p class="muted">${meta.map((x) => e(x)).join(" · ")}</p>
${report.firmOnly ? `<p class="notice">${e(t("firmOnly"))}</p>` : ""}
${headline}
${notes}
${actions}
<p class="claim">${e(t("claimNote"))}</p>
</body>
</html>`;
}
