"use client";

import { CountingNumber } from "@animate-ui/react/primitives/texts/counting-number";
import { cn } from "@/lib/utils";

/**
 * A count that rolls up from zero the first time it scrolls into view
 * (Animate UI counting number). Reduced motion shows the final value at once.
 * The number is the real figure from the server; only its arrival animates.
 */
export function AnimatedNumber({ value, className }: { value: number; className?: string }) {
  return (
    <CountingNumber
      number={value}
      inView
      inViewOnce
      transition={{ stiffness: 140, damping: 28 }}
      className={cn("tabular-nums", className)}
      aria-label={String(value)}
    />
  );
}
