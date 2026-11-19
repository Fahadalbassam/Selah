import { useTranslations } from "next-intl";
import { Lock } from "@/components/animate-ui/icons/lock";
import { Hint } from "@/components/hint";
import { Badge } from "@/components/ui/badge";

export type Visibility = "shared" | "firm_private" | "client_private" | "user_private";

/**
 * Who sees an item, as a quiet badge (shared, firm only, client only, only
 * me), with a tooltip saying who that is (big prompt 6.1). `label` is the
 * word the screen already uses ("Firm only", "Your company only"); the
 * tooltip is `tips.visibility.*`. It draws a label, never decides anything:
 * who may open the item is the database's rule.
 */
export function VisibilityBadge({ visibility, label, className }: { visibility: Visibility; label: string; className?: string }) {
  const t = useTranslations("tips.visibility");
  return (
    <Hint tip={t(visibility)} className={className}>
      {visibility === "shared" ? (
        <Badge variant="secondary">{label}</Badge>
      ) : (
        <Badge variant="outline" className="gap-1">
          <Lock className="size-3" />
          {label}
        </Badge>
      )}
    </Hint>
  );
}
