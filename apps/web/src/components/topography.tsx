import { cn } from "@/lib/utils";

/*
 * A quiet topographic-contour backdrop in the spirit of Animate UI's
 * "topography" background, drawn as plain SVG (no runtime cost). Contours
 * are rings around a few peaks, wobbled by a fixed sum of sines so the
 * markup is identical on server and client. Two layers drift slowly in
 * opposite directions; reduced motion leaves them still.
 */

const PEAKS = [
  { x: 180, y: 160, rings: 9, seed: 1.3 },
  { x: 860, y: 260, rings: 11, seed: 2.7 },
  { x: 520, y: 700, rings: 10, seed: 4.1 },
  { x: 1180, y: 820, rings: 8, seed: 5.9 },
];

function ring(cx: number, cy: number, r: number, seed: number) {
  const steps = 72;
  const pts: string[] = [];
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    const wobble =
      1 + 0.16 * Math.sin(3 * a + seed) + 0.09 * Math.sin(5 * a + seed * 2.1 + r * 0.01) + 0.05 * Math.sin(9 * a + seed * 0.7);
    const x = cx + Math.cos(a) * r * wobble;
    const y = cy + Math.sin(a) * r * 0.8 * wobble;
    pts.push(`${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`);
  }
  return pts.join("") + "Z";
}

const PATHS = PEAKS.map((p) => Array.from({ length: p.rings }, (_, i) => ring(p.x, p.y, 34 + i * 38, p.seed + i * 0.35)).join(""));

export function Topography({ className }: { className?: string }) {
  return (
    <div aria-hidden className={cn("pointer-events-none absolute inset-0 overflow-hidden text-foreground", className)}>
      <svg
        viewBox="0 0 1400 1000"
        preserveAspectRatio="xMidYMid slice"
        className="absolute -inset-[10%] size-[120%] animate-[topo-drift_60s_ease-in-out_infinite_alternate] opacity-[0.07] dark:opacity-[0.09]"
      >
        <g fill="none" stroke="currentColor" strokeWidth="1.1">
          {PATHS.slice(0, 2).map((d, i) => (
            <path key={i} d={d} />
          ))}
        </g>
      </svg>
      <svg
        viewBox="0 0 1400 1000"
        preserveAspectRatio="xMidYMid slice"
        className="absolute -inset-[10%] size-[120%] animate-[topo-drift_80s_ease-in-out_infinite_alternate-reverse] opacity-[0.05] dark:opacity-[0.07]"
      >
        <g fill="none" stroke="currentColor" strokeWidth="1">
          {PATHS.slice(2).map((d, i) => (
            <path key={i} d={d} />
          ))}
        </g>
      </svg>
      {/* Fade the lines out toward the centre so the form stays clean. */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,var(--background)_20%,transparent_70%)]" />
    </div>
  );
}
