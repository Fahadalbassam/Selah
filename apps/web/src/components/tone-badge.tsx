import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/**
 * The status tones (docs/ui-guidelines.md). Colour is reserved for these and
 * stays muted: claims and open work are grey, waiting is amber, problems are
 * red, and only human-verified work is green.
 */
export type Tone = "open" | "neutral" | "active" | "waiting" | "problem" | "verified" | "new";

export const TONE: Record<Tone, string> = {
  open: "border-border bg-transparent text-foreground",
  neutral: "bg-muted text-muted-foreground",
  active: "bg-accent text-accent-foreground",
  waiting: "bg-warning/15 text-foreground",
  problem: "bg-destructive/10 text-destructive",
  verified: "bg-success/15 text-success",
  new: "bg-primary text-primary-foreground",
};

export function ToneBadge({ tone, className, children }: { tone: Tone; className?: string; children: ReactNode }) {
  return (
    <Badge variant="outline" className={cn("font-medium", tone !== "open" && "border-transparent", TONE[tone], className)}>
      {children}
    </Badge>
  );
}
