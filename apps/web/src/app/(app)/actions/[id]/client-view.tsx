"use client";

import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { toast } from "@/components/ui/toast";
import { callApi } from "@/components/form-dialog";
import { RowMenu } from "@/components/row-menu";
import type { MenuItem } from "@/lib/action-next";
import type { LastLine, NextLine, PlainWho } from "@/lib/action-plain";
import { CloseDialog, json, ReasonDialog, send } from "./action-panel";
import { SignDialog } from "./closure-panels";

// The action page's rare things (page audit 4.5, batch 4), for every reader:
// close and reopen (the firm), accepting the risk of not finishing it (a
// client admin or manager), mail about it. They were buttons before. And for
// a client reader, two plain lines in place of the firm's reminder ladder
// and date history.

/** The page menu (⋯) beside the title. Only the items the server allows (nextStep().menu). */
export function ActionPageMenu({
  actionId,
  items,
  muted,
  close,
}: {
  actionId: string;
  items: MenuItem[];
  muted: boolean;
  close: { signed: boolean; replacements: { id: string; title: string }[] } | null;
}) {
  const t = useTranslations("action.menu");
  const ta = useTranslations("action");
  const tm = useTranslations("notifications.mail");
  const tc = useTranslations("common");
  const router = useRouter();
  const done = () => router.refresh();
  async function toggleMute() {
    const r = await callApi(`/api/actions/${actionId}/mute`, "PUT", { muted: !muted });
    if (!r.ok) return void toast.error(tc(`errors.${r.error}`));
    toast.success(muted ? tm("unmuted") : tm("mutedDone"));
    done();
  }
  return (
    <RowMenu
      label={t("label")}
      items={[
        { key: "mute", label: muted ? tm("unmute") : tm("mute"), allowed: items.includes("mute"), onSelect: () => void toggleMute() },
        {
          key: "acceptRisk",
          label: t("acceptRisk"),
          allowed: items.includes("acceptRisk"),
          dialog: (control) => <SignDialog actionId={actionId} open={control.open} onOpenChange={control.onOpenChange} />,
        },
        {
          key: "reopen",
          label: ta("reopen"),
          allowed: items.includes("reopen"),
          dialog: (control) => (
            <ReasonDialog control={control} title={ta("reopen")} hint={ta("reopenHint")} run={(reason) => send(`/api/actions/${actionId}/transition`, json({ to: "in_progress", reason }))} onDone={done} />
          ),
        },
        {
          key: "close",
          label: ta("move.closed"),
          allowed: items.includes("close"),
          destructive: true,
          dialog: (control) => (
            <CloseDialog actionId={actionId} signed={close?.signed ?? false} replacements={close?.replacements ?? []} control={control} onDone={done} />
          ),
        },
      ]}
    />
  );
}

/**
 * Two plain lines for a client reader, in place of the reminder ladder and
 * the date history: what is expected next and by when, and what happened last
 * to the date (lib/action-plain.ts). "I need more time" is one of the quiet
 * links under the next step.
 */
export function PlainDateLines({ next, last }: { next: NextLine | null; last: LastLine | null }) {
  const t = useTranslations("action.plain");
  const format = useFormatter();
  if (!next && !last) return null;
  const day = (d: string) => format.dateTime(new Date(`${d}T12:00:00Z`), { dateStyle: "medium", timeZone: "UTC" });
  const on = (d: Date | string) => format.dateTime(new Date(d), { dateStyle: "medium" });
  const who = (list: PlainWho[]) => format.list(list.map((w) => t(`who.${w}`)), { type: "conjunction" });

  const nextText = next
    ? [
        next.kind === "late" ? t("late", { due: day(next.due) }) : t("due", { due: day(next.due) }),
        next.kind === "due" && next.reminderOn ? t("reminder", { on: day(next.reminderOn) }) : null,
        next.tellOn ? t("tell", { on: day(next.tellOn), who: who(next.who) }) : null,
      ]
        .filter(Boolean)
        .join(" ")
    : null;
  const lastText = !last
    ? null
    : last.kind === "proposed"
      ? last.mine
        ? t("proposedMine", { date: day(last.date) })
        : t("proposedBy", { date: day(last.date), who: last.by ?? t("someone") })
      : last.kind === "declined"
        ? last.by
          ? t("declinedBy", { date: day(last.date), who: last.by, at: on(last.at) })
          : t("declined", { date: day(last.date), at: on(last.at) })
        : last.by
          ? t(last.agreed ? "movedAgreed" : "movedSet", { date: day(last.date), who: last.by, at: on(last.at) })
          : t("moved", { date: day(last.date), at: on(last.at) });

  return (
    <div className="space-y-1.5 border-t pt-4 text-sm" data-slot="plain-date-lines">
      {nextText ? <p>{nextText}</p> : null}
      {lastText ? <p className="text-muted-foreground">{lastText}</p> : null}
    </div>
  );
}
