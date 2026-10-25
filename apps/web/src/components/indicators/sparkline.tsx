import { cn } from "@/lib/utils";

/**
 * A small trend line: the baseline, then each reported value. The target,
 * when there is one, is a dashed line. Monochrome, like every chart here;
 * the words beside it say which way is better.
 */
export function Sparkline({
  points,
  target,
  label,
  className,
}: {
  points: number[];
  target?: number | null;
  label: string;
  className?: string;
}) {
  const W = 120;
  const H = 32;
  const P = 3;
  const all = target === null || target === undefined ? points : [...points, target];
  const min = Math.min(...all);
  const max = Math.max(...all);
  const span = max - min || 1;
  const x = (i: number) => P + (points.length === 1 ? (W - 2 * P) / 2 : (i / (points.length - 1)) * (W - 2 * P));
  const y = (v: number) => H - P - ((v - min) / span) * (H - 2 * P);
  const d = points.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const last = points.length - 1;
  return (
    // Time runs left to right in both languages, as on the progress chart.
    <svg viewBox={`0 0 ${W} ${H}`} className={cn("h-8 w-28 shrink-0 text-foreground", className)} role="img" aria-label={label} style={{ direction: "ltr" }}>
      {target !== null && target !== undefined ? (
        <line x1={P} x2={W - P} y1={y(target)} y2={y(target)} className="stroke-muted-foreground" strokeWidth={1} strokeDasharray="3 3" />
      ) : null}
      {points.length > 1 ? (
        <path d={d} fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinejoin="round" strokeLinecap="round" />
      ) : null}
      <circle cx={x(0)} cy={y(points[0]!)} r={2} className="fill-muted-foreground" />
      {last > 0 ? <circle cx={x(last)} cy={y(points[last]!)} r={2.75} fill="currentColor" /> : null}
    </svg>
  );
}
