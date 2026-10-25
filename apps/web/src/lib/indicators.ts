// Business indicators (KPI layer B): pure helpers shared by the screens, the
// reports and the assistant. Every number here is worked out from what the
// client reported; nothing is estimated, weighted or turned into a score, and
// the words around them say the figures are the client's, not verified impact.

export const INDICATOR_LIMITS = { name: 200, unit: 40, definition: 1000, source: 300, note: 1000 } as const;
export const INDICATOR_DIRECTIONS = ["higher_better", "lower_better"] as const;
export const INDICATOR_FREQUENCIES = ["monthly", "quarterly"] as const;
export type IndicatorDirection = (typeof INDICATOR_DIRECTIONS)[number];
export type IndicatorFrequency = (typeof INDICATOR_FREQUENCIES)[number];

/** A period's state (app_kpi_series): a value, waiting within the grace days, or missing after them. */
export type PeriodStatus = "reported" | "due" | "missing";

export interface SeriesPoint {
  period: string;
  value: number | null;
  status: PeriodStatus;
}

export interface IndicatorBasis {
  direction: IndicatorDirection;
  baseline: number;
  target: number | null;
}

/** Which way the latest value moved from the baseline, read with the indicator's direction. */
export type Movement = "better" | "worse" | "same";

export interface IndicatorSummary {
  latest: { period: string; value: number } | null;
  previous: { period: string; value: number } | null;
  /** latest - baseline; null before the first value. */
  change: number | null;
  movement: Movement | null;
  /** How far the latest value is from the baseline to the target, in percent; null without a target or a value. */
  towardTarget: number | null;
  /** The most recent period's state; null before the first period after the baseline has started. */
  current: PeriodStatus | null;
  /** Periods past their grace days with no value. */
  missing: number;
  /** The baseline, then each reported value in order: the trend line. */
  points: number[];
}

export function movement(direction: IndicatorDirection, from: number, to: number): Movement {
  if (to === from) return "same";
  return (to > from) === (direction === "higher_better") ? "better" : "worse";
}

export function summarize(basis: IndicatorBasis, series: SeriesPoint[]): IndicatorSummary {
  const reported = series.filter((p): p is SeriesPoint & { value: number } => p.status === "reported" && p.value !== null);
  const latest = reported.at(-1) ?? null;
  const previous = reported.at(-2) ?? null;
  const change = latest ? latest.value - basis.baseline : null;
  const span = basis.target === null ? 0 : basis.target - basis.baseline;
  return {
    latest: latest && { period: latest.period, value: latest.value },
    previous: previous && { period: previous.period, value: previous.value },
    change,
    movement: latest ? movement(basis.direction, basis.baseline, latest.value) : null,
    towardTarget: latest && span !== 0 ? Math.round((1000 * (latest.value - basis.baseline)) / span) / 10 : null,
    current: series.at(-1)?.status ?? null,
    missing: series.filter((p) => p.status === "missing").length,
    points: [basis.baseline, ...reported.map((p) => p.value)],
  };
}

export interface IndicatorCounts {
  total: number;
  /** The latest period has a value, or is still within its grace days. */
  upToDate: number;
  /** At least one period past its grace days has no value. */
  missing: number;
  better: number;
  worse: number;
  /** No value yet. */
  noValue: number;
}

/** Pooled counts over a set of indicators: how many, never an average of their percentages. */
export function countIndicators(list: IndicatorSummary[]): IndicatorCounts {
  return {
    total: list.length,
    upToDate: list.filter((s) => s.current !== "missing").length,
    missing: list.filter((s) => s.missing > 0).length,
    better: list.filter((s) => s.movement === "better").length,
    worse: list.filter((s) => s.movement === "worse").length,
    noValue: list.filter((s) => s.latest === null).length,
  };
}

/** The 1st of the month a date falls in. */
export function monthStart(day: string): string {
  return `${day.slice(0, 7)}-01`;
}

function addMonths(first: string, months: number): string {
  const [y, m] = first.split("-").map(Number) as [number, number];
  const total = y * 12 + (m - 1) + months;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}-01`;
}

/**
 * The periods a value can be entered for on a day: each one after the
 * baseline that has started, newest first (the database checks the same).
 */
export function openPeriods(baselinePeriod: string, frequency: IndicatorFrequency, today: string, max = 24): string[] {
  const step = frequency === "quarterly" ? 3 : 1;
  const out: string[] = [];
  for (let p = addMonths(baselinePeriod, step); p <= today; p = addMonths(p, step)) out.push(p);
  return out.reverse().slice(0, max);
}

/** A period's label: "Sep 2026", or "Q3 2026" style "Jul–Sep 2026" for a quarter. */
export function periodLabel(period: string, frequency: IndicatorFrequency, locale: "ar" | "en"): string {
  const d = new Date(`${period}T00:00:00Z`);
  const month = (x: Date) => new Intl.DateTimeFormat(locale, { month: "short", timeZone: "UTC" }).format(x);
  const year = new Intl.DateTimeFormat(locale, { year: "numeric", timeZone: "UTC" }).format(d);
  if (frequency === "monthly") return `${month(d)} ${year}`;
  const end = new Date(`${addMonths(period, 2)}T00:00:00Z`);
  return `${month(d)}–${month(end)} ${year}`;
}

/** A number in the reader's language, with up to two decimals. */
export function formatValue(v: number, locale: "ar" | "en"): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(v);
}

/** A change with its sign: "+3", "−1.5". */
export function formatChange(v: number, locale: "ar" | "en"): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 2, signDisplay: "exceptZero" }).format(v);
}
