// The notice that an indicator's latest value moved away (indicator.moved_away,
// migration 0090): the figures behind it, and the values its sentence in
// messages "notifications.kinds.indicator_moved_away" is filled with. Pure,
// so the notification list and the tests share it. The sentence states the
// value, its period, the baseline (and the target once its date has passed)
// and the direction the client chose, as the indicator page shows them, and
// never a word that judges.
import { formatValue, periodLabel, type IndicatorDirection, type IndicatorFrequency } from "./indicators";

export const MOVED_AWAY_KIND = "indicator.moved_away";

/** What the notice says, read from the value it is about and its indicator. */
export interface MovedAwayFacts {
  kpiId: string;
  value: number;
  /** The period's first day, YYYY-MM-DD. */
  period: string;
  frequency: IndicatorFrequency;
  unit: string;
  baseline: number;
  direction: IndicatorDirection;
  target: number | null;
  targetDate: string | null;
  /** The target's date had passed on the day the period was judged (firm day): the target is named too. */
  targetPassed: boolean;
  /** Who reads it: the client's own people are spoken to ("your company"), the firm reads "the client". */
  reader: "firm" | "client";
}

/** The sentence's values in the reader's language: numbers and periods as the indicator page writes them. */
export function movedAwayValues(f: MovedAwayFacts, locale: "ar" | "en"): Record<string, string> {
  const withTarget = f.targetPassed && f.target !== null && f.targetDate !== null;
  return {
    value: formatValue(f.value, locale),
    unit: f.unit,
    period: periodLabel(f.period, f.frequency, locale),
    baseline: formatValue(f.baseline, locale),
    direction: f.direction,
    reader: f.reader,
    withTarget: withTarget ? "yes" : "no",
    target: withTarget ? formatValue(f.target!, locale) : "",
    targetDate: withTarget
      ? new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${f.targetDate}T00:00:00Z`))
      : "",
  };
}
