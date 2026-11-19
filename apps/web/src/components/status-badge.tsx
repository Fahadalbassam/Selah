import { useTranslations } from "next-intl";
import { Hint } from "@/components/hint";
import { ToneBadge } from "@/components/tone-badge";
import type { ActionStatus } from "@/authz";
import {
  actionExactShown,
  actionPlacement,
  labelKey,
  meetingPlacement,
  meetingTip,
  placementTone,
  statusTipKey,
  type ClosureOutcome,
  type MeetingState,
  type Placement,
  type Reader,
  type TipKind,
} from "@/lib/status-words";

/**
 * One of the six visible status words (decision D3, lib/status-words.ts,
 * docs/placement.md) as a badge: what lists, homes and cards draw for any
 * kind of thing. `reader` is the side reading the screen, so the reader's own
 * side reads "Waiting for you". `tip` is the exact state behind the word and
 * what it means (big prompt 6.1), opened by hover or keyboard focus.
 */
export function WordBadge({ placement, reader, className, tip }: { placement: Placement; reader: Reader; className?: string; tip?: string }) {
  const t = useTranslations("statusWords");
  if (!tip) {
    return (
      <ToneBadge tone={placementTone(placement)} className={className}>
        {t(labelKey(placement, reader))}
      </ToneBadge>
    );
  }
  return (
    <Hint tip={tip} className={className}>
      <ToneBadge tone={placementTone(placement)}>{t(labelKey(placement, reader))}</ToneBadge>
    </Hint>
  );
}

/** A status tooltip's text, from `tips.status.*` (lib/status-words.ts statusTipKey). */
export function useStatusTip() {
  const t = useTranslations("tips");
  return (kind: TipKind, state: string, reader: Reader) => t(statusTipKey(kind, state, reader));
}

/** A word with its tooltip, for a kind whose badge is drawn from a placement (projects, inquiries). */
export function KindWord({ kind, state, placement, reader, className }: { kind: TipKind; state: string; placement: Placement; reader: Reader; className?: string }) {
  const tip = useStatusTip();
  return <WordBadge placement={placement} reader={reader} className={className} tip={tip(kind, state, reader)} />;
}

/**
 * A meeting's word, as its list draws it (review S1), with the exact state
 * beside it while it is still to come ("Waiting for you · Scheduled").
 */
export function MeetingWord({ status, unanswered, reader, className }: { status: MeetingState; unanswered: boolean; reader: Reader; className?: string }) {
  const t = useTranslations("statusWords");
  const tm = useTranslations("meeting");
  const tip = useStatusTip();
  const placement = meetingPlacement(status, unanswered);
  const word = <WordBadge placement={placement} reader={reader} tip={tip("meeting", meetingTip(status, unanswered), reader)} className={className} />;
  if (status !== "scheduled") return word;
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      {word}
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
 * accepted"). Its tooltip says what the state means for the reader.
 */
export function StatusBadge({
  status,
  reader,
  exact = false,
  outcome,
  outcomeKey,
}: {
  status: ActionStatus;
  reader: Reader;
  exact?: boolean;
  /** A closed action's outcome label, already translated. */
  outcome?: string | null;
  /** The same outcome as stored, for its tooltip. */
  outcomeKey?: ClosureOutcome | null;
}) {
  const t = useTranslations("statusWords");
  const ts = useTranslations("status");
  const tip = useStatusTip();
  const placement = actionPlacement(status);
  if (exact && status === "closed" && outcome) {
    const badge = <ToneBadge tone={placementTone(placement)}>{t("closedAs", { outcome })}</ToneBadge>;
    return outcomeKey ? <Hint tip={tip("outcome", outcomeKey, reader)}>{badge}</Hint> : badge;
  }
  const word = <WordBadge placement={placement} reader={reader} tip={tip("action", status, reader)} />;
  if (!exact || !actionExactShown(status)) return word;
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      {word}
      <span className="text-xs text-muted-foreground" title={t("exactLabel")}>
        {ts(status)}
      </span>
    </span>
  );
}
