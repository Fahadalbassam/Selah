import { cn } from "@/lib/utils";

/**
 * The S mark, drawn from a single-colour PNG used as a mask so it takes the
 * theme's brand colour (navy in light mode, silver in dark mode).
 */
export function BrandMark({ className, label }: { className?: string; label?: string }) {
  return (
    <span
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={cn("inline-block bg-brand-mark [mask:url(/brand/mark.png)_center/contain_no-repeat]", className)}
    />
  );
}

/** The full wordmark: navy and teal on light, silver on dark. */
export function BrandWordmark({ className, label }: { className?: string; label: string }) {
  return (
    <span className={cn("inline-flex", className)}>
      {/* eslint-disable-next-line @next/next/no-img-element -- static, already sized */}
      <img src="/brand/wordmark-light.png" alt={label} className="h-full w-auto dark:hidden" />
      {/* eslint-disable-next-line @next/next/no-img-element -- static, already sized */}
      <img src="/brand/wordmark-dark.png" alt={label} className="hidden h-full w-auto dark:block" />
    </span>
  );
}
