import { useTranslations } from "next-intl";
import { ToneBadge, type Tone } from "@/components/tone-badge";
import type { ActionStatus } from "@/authz";

// Colours separate claims (neutral), waiting (amber), problems (red) and
// human-verified work (green), so a dashboard never blurs them together.
const STATUS_TONE: Record<ActionStatus, Tone> = {
  draft: "neutral",
  assigned: "neutral",
  in_progress: "active",
  blocked: "problem",
  awaiting_review: "waiting",
  revision_requested: "problem",
  verified_complete: "verified",
  closed: "neutral",
};

export function StatusBadge({ status }: { status: ActionStatus }) {
  const t = useTranslations("status");
  return (
    <ToneBadge tone={STATUS_TONE[status]} className={status === "assigned" ? "text-foreground" : undefined}>
      {t(status)}
    </ToneBadge>
  );
}
