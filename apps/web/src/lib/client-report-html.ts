/**
 * A client's progress across its projects as a printable HTML page, for the
 * PDF service (F30). Pure, like the project report (report-html.ts): every
 * value is escaped, no script, nothing loaded but the report fonts. Live
 * numbers on the export day, not frozen ones.
 */
import { escapeHtml, reportStyles } from "./report-html";
import { indicatorSection, type IndicatorTable } from "./indicator-html";

export interface ClientReportNumbers {
  total: number;
  verified: number;
  notApplicable: number;
  superseded: number;
  open: number;
  overdue: number;
  awaitingReview: number;
  blocked: number;
  implementedPct: number | null;
}

export interface ClientReportHtmlInput {
  locale: "ar" | "en";
  firmName: string;
  clientName: string;
  total: ClientReportNumbers;
  projects: { title: string; state: string | null; numbers: ClientReportNumbers }[];
  /** Empty when the client doesn't file work under departments. */
  departments: { name: string; numbers: ClientReportNumbers }[];
  attention: { title: string; project: string; owner: string | null; dueDate: string | null; status: string; overdue: boolean }[];
  exportedOn: string;
  /** The client's business indicators (KPI layer B), with the note that they are the client's own figures. */
  indicators?: { table: IndicatorTable; claim: string } | null;
  /** Strings under messages "clientProgress.pdf". */
  t: (key: string, values?: Record<string, string | number>) => string;
}

export function renderClientReportHtml(input: ClientReportHtmlInput): string {
  const { locale, t, total } = input;
  const ar = locale === "ar";
  const day = (iso: string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${iso.slice(0, 10)}T00:00:00Z`));
  const num = (n: number) => new Intl.NumberFormat(locale).format(n);
  const pct = (v: number | null) => (v === null ? "—" : `${num(Math.round(v))}%`);
  const applies = (n: ClientReportNumbers) => n.total - n.notApplicable - n.superseded;
  const e = escapeHtml;

  const headline = `<section class="headline">
  <div class="big">
    <p class="muted">${e(t("implemented"))}</p>
    <p class="pct">${pct(total.implementedPct)}</p>
    ${
      total.implementedPct === null
        ? `<p class="muted">${e(t("noneYet"))}</p>`
        : `<div class="meter" role="img" aria-label="${e(t("implemented"))}"><span style="width:${Math.max(0, Math.min(100, total.implementedPct)).toFixed(1)}%"></span></div>
    <p class="muted">${e(t("implementedOf", { verified: num(total.verified), applies: num(applies(total)) }))}</p>`
    }
  </div>
  <div class="tiles">
    ${(
      [
        ["open", total.open],
        ["overdue", total.overdue],
        ["awaiting", total.awaitingReview],
        ["blocked", total.blocked],
      ] as const
    )
      .map(([k, v]) => `<div class="tile"><p class="muted">${e(t(k))}</p><p class="value">${num(v)}</p></div>`)
      .join("")}
  </div>
</section>`;

  const breakdown = (title: string, first: string, rows: { name: string; note?: string | null; numbers: ClientReportNumbers }[]) =>
    rows.length
      ? `<section>
  <h2>${e(title)}</h2>
  <table>
    <thead><tr><th>${e(first)}</th><th>${e(t("implemented"))}</th><th>${e(t("verifiedCol"))}</th><th>${e(t("open"))}</th><th>${e(t("overdue"))}</th></tr></thead>
    <tbody>${rows
      .map(
        (r) => `<tr>
      <td><span dir="auto">${e(r.name)}</span>${r.note ? `<br><span class="muted small">${e(r.note)}</span>` : ""}</td>
      <td class="nowrap">${pct(r.numbers.implementedPct)}</td>
      <td class="nowrap">${e(t("ofApplies", { verified: num(r.numbers.verified), applies: num(applies(r.numbers)) }))}</td>
      <td>${num(r.numbers.open)}</td>
      <td>${num(r.numbers.overdue)}</td>
    </tr>`,
      )
      .join("")}</tbody>
  </table>
</section>`
      : "";

  const attention = `<section class="actions">
  <h2>${e(t("attentionTitle"))}</h2>
  ${
    input.attention.length
      ? `<table>
    <thead><tr><th>${e(t("colAction"))}</th><th>${e(t("colOwner"))}</th><th>${e(t("colDue"))}</th><th>${e(t("colStatus"))}</th></tr></thead>
    <tbody>${input.attention
      .map(
        (a) => `<tr>
      <td><span dir="auto">${e(a.title)}</span><br><span class="muted small" dir="auto">${e(a.project)}</span></td>
      <td dir="auto">${e(a.owner ?? t("noOwner"))}</td>
      <td class="nowrap">${a.dueDate ? e(day(a.dueDate)) : "—"}${a.overdue ? `<br><span class="small">${e(t("overdueMark"))}</span>` : ""}</td>
      <td>${e(a.status)}</td>
    </tr>`,
      )
      .join("")}</tbody>
  </table>`
      : `<p class="muted">${e(t("attentionNone"))}</p>`
  }
</section>`;

  return `<!doctype html>
<html lang="${locale}" dir="${ar ? "rtl" : "ltr"}">
<head>
<meta charset="utf-8">
<title>${e(t("title", { client: input.clientName }))}</title>
<style>
${reportStyles()}
</style>
</head>
<body>
<div class="top"><span class="firm" dir="auto">${e(input.firmName)}</span><span class="muted">${e(t("kind"))}</span></div>
<h1 dir="auto">${e(input.clientName)}</h1>
<p class="muted">${e(t("asOf", { date: day(input.exportedOn) }))}</p>
${headline}
${breakdown(
  t("byProject"),
  t("project"),
  input.projects.map((p) => ({ name: p.title, note: p.state, numbers: p.numbers })),
)}
${breakdown(
  t("byDepartment"),
  t("department"),
  input.departments.map((d) => ({ name: d.name, numbers: d.numbers })),
)}
${attention}
${indicatorSection(input.indicators?.table, input.indicators?.claim ?? "")}
<p class="claim">${e(t("pooledNote"))} ${e(t("claimNote"))}</p>
</body>
</html>`;
}
