import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { ActionStatus } from "@/authz";

// Colours separate claims (neutral), waiting (amber), problems (red) and
// human-verified work (green), so a dashboard never blurs them together.
const TONE: Record<ActionStatus, string> = {
  draft: "bg-muted text-muted-foreground",
  assigned: "bg-muted text-foreground",
  in_progress: "bg-accent text-accent-foreground",
  blocked: "bg-destructive/10 text-destructive",
  awaiting_review: "bg-warning/15 text-foreground",
  revision_requested: "bg-destructive/10 text-destructive",
  verified_complete: "bg-success/15 text-success",
  closed: "bg-muted text-muted-foreground",
};

export function StatusBadge({ status }: { status: ActionStatus }) {
  const t = useTranslations("status");
  return (
    <Badge variant="outline" className={cn("border-transparent font-medium", TONE[status])}>
      {t(status)}
    </Badge>
  );
}
