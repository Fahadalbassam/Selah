import { useTranslations } from "next-intl";
import { ToneBadge, type Tone } from "@/components/tone-badge";
import type { StanceState } from "@/lib/responses";

// Where a released recommendation stands with the client (F10). Disagreeing
// is the disputed state, so it reads as a problem; waiting reads as waiting.
const STANCE_TONE: Record<StanceState, Tone> = {
  agree: "verified",
  partly_agree: "active",
  disagree: "problem",
  unconfirmed: "waiting",
  awaiting: "neutral",
};

export function StanceBadge({ stance }: { stance: StanceState }) {
  const t = useTranslations("response.stances");
  return <ToneBadge tone={STANCE_TONE[stance]}>{t(stance)}</ToneBadge>;
}
