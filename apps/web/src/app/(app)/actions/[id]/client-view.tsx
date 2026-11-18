"use client";

import { BellOff, ShieldCheck } from "lucide-react";
import { Ellipsis } from "@/components/animate-ui/icons/ellipsis";
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "@/components/ui/toast";
import { callApi } from "@/components/form-dialog";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { LastLine, NextLine, PlainWho } from "@/lib/action-plain";
import { SignDialog } from "./closure-panels";
import { AskForDate } from "./follow-through-panels";

// The action page for a client reader (page audit 4.5, batch 1): the rare
// things sit in a menu, and two plain lines stand in for the firm's reminder
// ladder and date history.

/**
 * The page menu for a client reader: mail about this action, and accepting the
 * risk of not finishing it (a client admin or manager, while it is open). Both
 * were buttons on every action before.
 */
export function ActionMenu({ actionId, muted, canSign }: { actionId: string; muted: boolean; canSign: boolean }) {
  const t = useTranslations("action.menu");
  const tm = useTranslations("notifications.mail");
  const tc = useTranslations("common");
  const router = useRouter();
  const [signing, setSigning] = useState(false);
  async function toggleMute() {
    const r = await callApi(`/api/actions/${actionId}/mute`, "PUT", { muted: !muted });
    if (!r.ok) return void toast.error(tc(`errors.${r.error}`));
    toast.success(muted ? tm("unmuted") : tm("mutedDone"));
    router.refresh();
  }
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="ghost" size="icon-sm" aria-label={t("label")} title={t("label")}>
            <Ellipsis className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => void toggleMute()}>
            <BellOff />
            {muted ? tm("unmute") : tm("mute")}
          </DropdownMenuItem>
          {canSign ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => setSigning(true)}>
                <ShieldCheck />
                {t("acceptRisk")}
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      {canSign ? <SignDialog actionId={actionId} open={signing} onOpenChange={setSigning} /> : null}
    </>
  );
}

/**
 * Two plain lines for a client reader, in place of the reminder ladder and
 * the date history: what is expected next and by when, and what happened last
 * to the date (lib/action-plain.ts). With `ask`, a quiet "I need more time"
 * that proposes a new date.
 */
export function PlainDateLines({
  next,
  last,
  ask,
}: {
  next: NextLine | null;
  last: LastLine | null;
  ask?: { actionId: string; dueDate: string | null };
}) {
  const t = useTranslations("action.plain");
  const format = useFormatter();
  const router = useRouter();
  if (!next && !last && !ask) return null;
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
      {ask ? (
        <AskForDate
          actionId={ask.actionId}
          dueDate={ask.dueDate}
          onDone={() => router.refresh()}
          trigger={
            <Button type="button" variant="link" size="sm" className="h-auto px-0">
              {t("ask")}
            </Button>
          }
        />
      ) : null}
    </div>
  );
}
