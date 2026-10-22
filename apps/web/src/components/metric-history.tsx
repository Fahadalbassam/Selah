"use client";

import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";

export interface HistoryPoint {
  asOf: string;
  verified: number;
  total: number;
}

const W = 960;
const H = 200;
const PAD = { top: 12, right: 12, bottom: 24, left: 36 };

/**
 * One series: the share of released actions verified at each monthly
 * snapshot. Hover a month for its numbers; the table view lists them all.
 */
export function MetricHistory({ points }: { points: HistoryPoint[] }) {
  const t = useTranslations("metrics");
  const format = useFormatter();
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const day = (d: string) => format.dateTime(new Date(d), { month: "short", year: "numeric" });
  const pct = (p: HistoryPoint) => (p.total ? (p.verified / p.total) * 100 : 0);

  const iw = W - PAD.left - PAD.right;
  const ih = H - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (points.length === 1 ? iw / 2 : (i / (points.length - 1)) * iw);
  const y = (v: number) => PAD.top + ih - (v / 100) * ih;
  const line = points.map((p, i) => `${i ? "L" : "M"}${x(i)},${y(pct(p))}`).join(" ");
  const label = (p: HistoryPoint) => `${day(p.asOf)}: ${t("historyPoint", { verified: p.verified, total: p.total })}`;
  const shown = hover === null ? null : points[hover];

  return (
    <div className="space-y-2">
      <div className="relative" dir="ltr">
        <svg viewBox={`0 0 ${W} ${H}`} className="h-48 w-full text-foreground" role="img" aria-label={t("history")}>
          {[0, 50, 100].map((v) => (
            <g key={v}>
              <line x1={PAD.left} x2={W - PAD.right} y1={y(v)} y2={y(v)} className="stroke-border" strokeWidth={1} />
              <text x={PAD.left - 6} y={y(v) + 4} textAnchor="end" className="fill-muted-foreground text-xs">
                {v}%
              </text>
            </g>
          ))}
          {[0, points.length - 1]
            .filter((i, k, a) => a.indexOf(i) === k)
            .map((i) => (
              <text
                key={i}
                x={x(i)}
                y={H - 6}
                textAnchor={points.length === 1 ? "middle" : i === 0 ? "start" : "end"}
                className="fill-muted-foreground text-xs"
              >
                {day(points[i]!.asOf)}
              </text>
            ))}
          <path d={line} fill="none" stroke="currentColor" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          {shown ? (
            <>
              <line
                x1={x(hover!)}
                x2={x(hover!)}
                y1={PAD.top}
                y2={PAD.top + ih}
                className="stroke-muted-foreground"
                strokeDasharray="3 3"
              />
              <circle cx={x(hover!)} cy={y(pct(shown))} r={4.5} fill="currentColor" className="stroke-card" strokeWidth={2} />
            </>
          ) : null}
          {points.map((p, i) => (
            <rect
              key={p.asOf}
              x={x(i) - iw / Math.max(points.length - 1, 1) / 2}
              y={PAD.top}
              width={iw / Math.max(points.length - 1, 1)}
              height={ih}
              fill="transparent"
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
            >
              <title>{label(p)}</title>
            </rect>
          ))}
        </svg>
        {shown ? (
          <div
            className="pointer-events-none absolute top-0 rounded-md border bg-popover px-2 py-1 text-xs shadow-sm"
            style={{ left: `${(x(hover!) / W) * 100}%`, transform: `translateX(${hover! > points.length / 2 ? "-105%" : "5%"})` }}
          >
            <p className="font-medium tabular-nums">{Math.round(pct(shown))}%</p>
            <p className="text-muted-foreground">{label(shown)}</p>
          </div>
        ) : null}
      </div>
      <button
        type="button"
        className="text-xs text-muted-foreground underline-offset-2 hover:underline"
        onClick={() => setTable(!table)}
      >
        {t("table")}
      </button>
      {table ? (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-muted-foreground">
              <th className="py-1 text-start font-normal">{t("date")}</th>
              <th className="py-1 text-end font-normal">{t("outcome.verified")}</th>
            </tr>
          </thead>
          <tbody>
            {points.map((p) => (
              <tr key={p.asOf} className="border-t">
                <td className="py-1">{day(p.asOf)}</td>
                <td className="py-1 text-end tabular-nums">
                  {Math.round(pct(p))}% · {t("historyPoint", { verified: p.verified, total: p.total })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </div>
  );
}
