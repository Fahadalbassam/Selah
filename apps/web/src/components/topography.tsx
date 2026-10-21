"use client";

import { TopographyBackground } from "@/components/animate-ui/backgrounds/topography";
import { cn } from "@/lib/utils";

/*
 * Animate UI's topography background, kept quiet for the monochrome theme:
 * the lines take the foreground grey at low opacity and fade out toward the
 * centre so forms stay clean. The canvas pauses off-screen and on hidden
 * tabs, and holds still under reduced motion.
 */
export function Topography({ className, interactive = true }: { className?: string; interactive?: boolean }) {
  return (
    <div aria-hidden className={cn("absolute inset-0 overflow-hidden", className)}>
      <TopographyBackground
        interactive={interactive}
        levels={14}
        speed={0.5}
        className="absolute inset-0 text-foreground opacity-[0.14] dark:opacity-[0.18]"
      />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,var(--background)_25%,transparent_75%)]" />
    </div>
  );
}
