/**
 * Business indicators (KPI layer B) as a table for the printable reports:
 * the status pack, the closure report and the client report. Pure and
 * escaped like the reports themselves; the strings come from messages
 * "indicators.report" in the reader's language. Every table carries the
 * note that these are the client's own figures, not verified impact.
 */
import { formatChange, formatValue, periodLabel, type IndicatorDirection, type IndicatorFrequency } from "./indicators";
import { escapeHtml } from "./report-html";

/** What a report needs of one indicator (IndicatorSnapshot satisfies it). */
export interface IndicatorReportRow {
  nameAr: string | null;
  nameEn: string | null;
  departmentAr: string | null;
  departmentEn: string | null;
  unit: string;
  direction: IndicatorDirection;
  frequency: IndicatorFrequency;
  baseline: number;
  target: number | null;
  latest: { period: string; value: number } | null;
  movement: "better" | "worse" | "same" | null;
  missing: number;
  recommendations: string[];
}

export interface IndicatorTable {
  title: string;
  hint: string;
  head: string[];
  rows: string[][];
}

type T = (key: string, values?: Record<string, string | number>) => string;

/** The table, already in the reader's language; t reads messages "indicators.report". */
export function indicatorTable(list: IndicatorReportRow[], locale: "ar" | "en", t: T, withRecommendations = true): IndicatorTable {
  const ar = locale === "ar";
  const name = (k: IndicatorReportRow) => (ar ? (k.nameAr ?? k.nameEn) : (k.nameEn ?? k.nameAr)) ?? "";
  const scope = (k: IndicatorReportRow) =>
    k.departmentAr || k.departmentEn ? ((ar ? k.departmentAr : (k.departmentEn ?? k.departmentAr)) ?? "") : t("company");
  const v = (n: number, unit: string) => `${formatValue(n, locale)} ${unit}`;
  return {
    title: t("title"),
    hint: t("hint"),
    head: [t("indicator"), t("scope"), t("baseline"), t("latest"), t("change"), t("target"), ...(withRecommendations ? [t("linked")] : [])],
    rows: list.map((k) => [
      name(k),
      scope(k),
      v(k.baseline, k.unit),
      k.latest ? `${v(k.latest.value, k.unit)} (${periodLabel(k.latest.period, k.frequency, locale)})` : t("noValue"),
      k.latest
        ? `${formatChange(k.latest.value - k.baseline, locale)} · ${t(`movement.${k.movement ?? "same"}`)}${k.missing ? ` · ${t("missing", { n: k.missing })}` : ""}`
        : "—",
      k.target === null ? "—" : v(k.target, k.unit),
      ...(withRecommendations ? [k.recommendations.join(ar ? "، " : ", ") || "—"] : []),
    ]),
  };
}

/** The table as an HTML section, or nothing when there are no indicators. */
export function indicatorSection(table: IndicatorTable | null | undefined, claim: string): string {
  if (!table || !table.rows.length) return "";
  const e = escapeHtml;
  return `<section>
  <h2>${e(table.title)}</h2>
  <p class="muted small">${e(table.hint)}</p>
  <table>
    <thead><tr>${table.head.map((h) => `<th>${e(h)}</th>`).join("")}</tr></thead>
    <tbody>${table.rows.map((r) => `<tr>${r.map((c) => `<td dir="auto">${e(c)}</td>`).join("")}</tr>`).join("")}</tbody>
  </table>
  <p class="muted small">${e(claim)}</p>
</section>`;
}
