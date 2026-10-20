import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";

const MASK = "[mask:url(/brand/mark.png)_center/contain_no-repeat]";

/**
 * The S mark, drawn from a single-colour PNG used as a mask so it takes the
 * theme's brand colour (near-black in light mode, silver in dark mode).
 */
export function BrandMark({ className, label }: { className?: string; label?: string }) {
  return (
    <span
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={cn("inline-block bg-brand-mark", MASK, className)}
    />
  );
}

/** The full wordmark: matte black on light, silver on dark. */
export function BrandWordmark({ className, label }: { className?: string; label: string }) {
  return (
    <span className={cn("inline-flex", className)}>
      {/* eslint-disable-next-line @next/next/no-img-element -- static, already sized */}
      <img src="/brand/wordmark-light.png" alt={label} className="h-full w-auto dark:hidden" />
      {/* eslint-disable-next-line @next/next/no-img-element -- static, already sized */}
      <img src="/brand/wordmark-dark.png" alt="" aria-hidden className="hidden h-full w-auto dark:block" />
    </span>
  );
}

/**
 * The sidebar logo. Both marks stay mounted so the change animates with the
 * panel instead of swapping: as the sidebar closes, the wordmark is wiped
 * away toward the side the panel is closing to (right-to-left in English,
 * left-to-right in Arabic) and the S mark turns into place. Opening plays it
 * backwards. Must sit inside the sidebar (it reads group-data-collapsible).
 */
export function SidebarBrand({ label }: { label: string }) {
  const ease = "duration-(--duration-slow) ease-(--ease-out-soft)";
  return (
    <span className="relative block h-10 w-full" role="img" aria-label={label}>
      <BrandWordmark
        label=""
        className={cn(
          "absolute start-2 top-1/2 h-7 -translate-y-1/2 transition-[clip-path,opacity]",
          ease,
          "[clip-path:inset(0_0_0_0)]",
          "group-data-[collapsible=icon]:opacity-0 group-data-[collapsible=icon]:[clip-path:inset(0_100%_0_0)]",
          "rtl:group-data-[collapsible=icon]:[clip-path:inset(0_0_0_100%)]",
        )}
      />
      <BrandMark
        className={cn(
          "absolute inset-0 m-auto size-7 transition-[opacity,rotate,scale]",
          ease,
          "pointer-events-none scale-50 -rotate-90 opacity-0 rtl:rotate-90",
          "group-data-[collapsible=icon]:scale-100 group-data-[collapsible=icon]:rotate-0 group-data-[collapsible=icon]:opacity-100",
        )}
      />
    </span>
  );
}

/**
 * The S mark as an activity indicator: a light sweep runs across it while
 * something is saving or loading. With reduced motion it is a still mark.
 */
export function BrandLoader({
  className,
  label,
  tone = "brand",
}: {
  className?: string;
  label?: string;
  /** "current" takes the text colour, for use inside buttons. */
  tone?: "brand" | "current";
}) {
  const color = tone === "current" ? "currentColor" : "var(--brand-mark)";
  return (
    <span
      role="status"
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={cn(
        "inline-block size-5 animate-shimmer bg-[length:250%_100%]",
        "bg-[linear-gradient(110deg,var(--loader)_35%,color-mix(in_oklch,var(--loader)_25%,transparent)_50%,var(--loader)_65%)]",
        "rtl:[animation-direction:reverse] motion-reduce:[background:var(--loader)] motion-reduce:opacity-60",
        MASK,
        className,
      )}
      style={{ "--loader": color } as CSSProperties}
    />
  );
}
