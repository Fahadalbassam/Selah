"use client";

import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatValue, periodLabel, type IndicatorFrequency } from "@/lib/indicators";

export interface TrendPoint {
  period: string;
  value: number | null;
}

const W = 960;
const H = 220;
const PAD = { top: 14, right: 16, bottom: 26, left: 56 };

/**
 * The indicator over time: the baseline, each period's value (a gap where
 * none was given, never a zero) and the target as a dashed line. Hover a
 * period for its value; the table view lists them all.
 */
export function IndicatorTrend({
  baseline,
  baselinePeriod,
  target,
  unit,
  frequency,
  points,
}: {
  baseline: number;
  baselinePeriod: string;
  target: number | null;
  unit: string;
  frequency: IndicatorFrequency;
  points: TrendPoint[];
}) {
  const t = useTranslations("indicators");
  const locale = useLocale() as "ar" | "en";
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const all: TrendPoint[] = [{ period: baselinePeriod, value: baseline }, ...points];
  const values = all.map((p) => p.value).filter((v): v is number => v !== null);
  const ext = target === null ? values : [...values, target];
  const lo = Math.min(...ext);
  const hi = Math.max(...ext);
  const pad = (hi - lo) * 0.1 || Math.abs(hi) * 0.1 || 1;
  const min = lo - pad;
  const max = hi + pad;
  const iw = W - PAD.left - PAD.right;
  const ih = H - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (all.length === 1 ? iw / 2 : (i / (all.length - 1)) * iw);
  const y = (v: number) => PAD.top + ih - ((v - min) / (max - min)) * ih;
  // Separate runs where a period has no value: the line breaks instead of inventing one.
  let d = "";
  let pen = false;
  all.forEach((p, i) => {
    if (p.value === null) return void (pen = false);
    d += `${pen ? "L" : "M"}${x(i).toFixed(1)},${y(p.value).toFixed(1)} `;
    pen = true;
  });
  const label = (p: TrendPoint, i: number) =>
    `${i === 0 ? t("baselineAt", { period: periodLabel(p.period, "monthly", locale) }) : periodLabel(p.period, frequency, locale)}: ${
      p.value === null ? t("noValueShort") : `${formatValue(p.value, locale)} ${unit}`
    }`;
  const shown = hover === null ? null : all[hover]!;

  return (
    <div className="space-y-2">
      {table ? (
        <div className="overflow-hidden rounded-xl border">
          <Table>
            <TableHeader className="bg-muted/50">
              <TableRow>
                <TableHead>{t("fields.period")}</TableHead>
                <TableHead>{t("valueCol")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {all.map((p, i) => (
                <TableRow key={p.period}>
                  <TableCell>{i === 0 ? t("baselineAt", { period: periodLabel(p.period, "monthly", locale) }) : periodLabel(p.period, frequency, locale)}</TableCell>
                  <TableCell className="tabular-nums">{p.value === null ? "—" : `${formatValue(p.value, locale)} ${unit}`}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <div className="relative" dir="ltr">
          <svg viewBox={`0 0 ${W} ${H}`} className="h-52 w-full text-foreground" role="img" aria-label={t("trend")}>
            {[min + (max - min) * 0.1, (min + max) / 2, max - (max - min) * 0.1].map((v) => (
              <g key={v}>
                <line x1={PAD.left} x2={W - PAD.right} y1={y(v)} y2={y(v)} className="stroke-border" strokeWidth={1} />
                <text x={PAD.left - 6} y={y(v) + 4} textAnchor="end" className="fill-muted-foreground text-xs">
                  {formatValue(Math.round(v * 100) / 100, locale)}
                </text>
              </g>
            ))}
            {target !== null ? (
              <>
                <line x1={PAD.left} x2={W - PAD.right} y1={y(target)} y2={y(target)} className="stroke-muted-foreground" strokeWidth={1.25} strokeDasharray="5 4" />
                <text x={W - PAD.right} y={y(target) - 5} textAnchor="end" className="fill-muted-foreground text-xs">
                  {t("targetLine")}
                </text>
              </>
            ) : null}
            {[0, all.length - 1]
              .filter((i, k, a) => a.indexOf(i) === k)
              .map((i) => (
                <text key={i} x={x(i)} y={H - 6} textAnchor={all.length === 1 ? "middle" : i === 0 ? "start" : "end"} className="fill-muted-foreground text-xs">
                  {periodLabel(all[i]!.period, i === 0 ? "monthly" : frequency, locale)}
                </text>
              ))}
            <path d={d} fill="none" stroke="currentColor" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            {all.map((p, i) =>
              p.value === null ? null : (
                <circle key={p.period} cx={x(i)} cy={y(p.value)} r={i === 0 ? 3 : 3.5} className={i === 0 ? "fill-muted-foreground" : ""} fill={i === 0 ? undefined : "currentColor"} />
              ),
            )}
            {shown ? (
              <line x1={x(hover!)} x2={x(hover!)} y1={PAD.top} y2={PAD.top + ih} className="stroke-muted-foreground" strokeDasharray="3 3" />
            ) : null}
            {all.map((p, i) => (
              <rect
                key={`h-${p.period}`}
                x={x(i) - iw / Math.max(all.length - 1, 1) / 2}
                y={PAD.top}
                width={iw / Math.max(all.length - 1, 1)}
                height={ih}
                fill="transparent"
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
              >
                <title>{label(p, i)}</title>
              </rect>
            ))}
          </svg>
          {shown ? (
            <p className="pointer-events-none absolute top-1 left-14 rounded-md border bg-popover px-2 py-1 text-xs text-popover-foreground shadow-xs" dir="auto">
              {label(shown, hover!)}
            </p>
          ) : null}
        </div>
      )}
      <Button variant="ghost" size="sm" onClick={() => setTable((v) => !v)}>
        {table ? t("showChart") : t("showTable")}
      </Button>
    </div>
  );
}
