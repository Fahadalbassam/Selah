import { useTranslations } from "next-intl";
import { ToneBadge } from "@/components/tone-badge";
import type { ActionStatus } from "@/authz";
import { actionExactShown, actionPlacement, labelKey, meetingPlacement, placementTone, type MeetingState, type Placement, type Reader } from "@/lib/status-words";

/**
 * One of the six visible status words (decision D3, lib/status-words.ts,
 * docs/placement.md) as a badge: what lists, homes and cards draw for any
 * kind of thing. `reader` is the side reading the screen, so the reader's own
 * side reads "Waiting for you".
 */
export function WordBadge({ placement, reader, className }: { placement: Placement; reader: Reader; className?: string }) {
  const t = useTranslations("statusWords");
  return (
    <ToneBadge tone={placementTone(placement)} className={className}>
      {t(labelKey(placement, reader))}
    </ToneBadge>
  );
}

/**
 * A meeting's word, as its list draws it (review S1), with the exact state
 * beside it while it is still to come ("Waiting for you · Scheduled").
 */
export function MeetingWord({ status, unanswered, reader }: { status: MeetingState; unanswered: boolean; reader: Reader }) {
  const t = useTranslations("statusWords");
  const tm = useTranslations("meeting");
  const placement = meetingPlacement(status, unanswered);
  if (status !== "scheduled") return <WordBadge placement={placement} reader={reader} />;
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <WordBadge placement={placement} reader={reader} />
      <span className="text-xs text-muted-foreground" title={t("exactLabel")}>
        {tm(`status.${status}`)}
      </span>
    </span>
  );
}

/**
 * An action's word. On the action page (`exact`) the exact stored state
 * follows the word when the word does not already say it ("Waiting for you ·
 * Revision requested"), and a closed action says how it ended ("Closed: risk
 * accepted").
 */
export function StatusBadge({
  status,
  reader,
  exact = false,
  outcome,
}: {
  status: ActionStatus;
  reader: Reader;
  exact?: boolean;
  /** A closed action's outcome label, already translated. */
  outcome?: string | null;
}) {
  const t = useTranslations("statusWords");
  const ts = useTranslations("status");
  const placement = actionPlacement(status);
  if (exact && status === "closed" && outcome) {
    return <ToneBadge tone={placementTone(placement)}>{t("closedAs", { outcome })}</ToneBadge>;
  }
  if (!exact || !actionExactShown(status)) return <WordBadge placement={placement} reader={reader} />;
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <WordBadge placement={placement} reader={reader} />
      <span className="text-xs text-muted-foreground" title={t("exactLabel")}>
        {ts(status)}
      </span>
    </span>
  );
}
