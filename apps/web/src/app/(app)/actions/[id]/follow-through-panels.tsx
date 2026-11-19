"use client";

import { CalendarClock } from "lucide-react";
import { Plus } from "@/components/animate-ui/icons/plus";
import { useFormatter, useTranslations } from "next-intl";
import { useState, type FormEvent, type ReactNode } from "react";
import { BrandLoader } from "@/components/brand";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { firmToday } from "@/lib/dates";
import type { AgingBucket } from "@/lib/slips";
import { ErrorText, json, send, useRun } from "./action-panel";

type ItemStatus = "open" | "submitted" | "accepted" | "rejected" | "waived";

export interface EvidenceItem {
  id: string;
  title: string;
  description: string | null;
  dueDate: string | null;
  status: ItemStatus;
  decisionNote: string | null;
  files: { documentId: string; title: string }[];
}

export interface DeadlineRequest {
  id: string;
  proposedDueDate: string;
  reason: string;
  status: "pending" | "approved" | "rejected";
  dueDateThen: string | null;
  raisedLate: boolean;
  requestedBy: string | null;
  createdAt: string | Date;
}

/** Where the action stands against the date agreed at release (F17, services/slips.ts). */
export interface Slip {
  baseline: string | null;
  extensions: number;
  slipDays: number;
  daysLate: number | null;
  bucket: AgingBucket | null;
  history: { id: string; from: string | null; to: string | null; by: string | null; viaRequest: boolean; at: string | Date }[];
  canExtend: boolean;
}


/** A YYYY-MM-DD day as local midnight, for the calendar's disabled range. */
function localDate(day: string) {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y!, m! - 1, d!);
}

/** Add an item to the evidence list (firm staff), from "What to send". */
export function AddItem({ actionId, onDone, hint }: { actionId: string; onDone: () => void; hint: string }) {
  const t = useTranslations("action.items");
  const ta = useTranslations("action");
  const [open, setOpen] = useState(false);
  const { busy, error, go } = useRun(onDone);
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const body: Record<string, string> = { title: String(form.get("title") ?? "").trim() };
    const description = String(form.get("description") ?? "").trim();
    const dueDate = String(form.get("dueDate") ?? "");
    if (description) body.description = description;
    if (dueDate) body.dueDate = dueDate;
    go(
      () => send(`/api/actions/${actionId}/evidence-requests`, json(body)),
      () => setOpen(false),
    );
  }
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Plus className="size-4" />
          {t("add")}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{t("add")}</DialogTitle>
            <DialogDescription>{hint}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="item-title">{t("itemTitle")}</Label>
            <Input id="item-title" name="title" required maxLength={300} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="item-description">{t("itemDescription")}</Label>
            <Textarea id="item-description" name="description" maxLength={4000} rows={3} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="item-due">{t("itemDue")}</Label>
            <DatePicker
              id="item-due"
              name="dueDate"
              placeholder={t("itemDue")}
              disabled={{ before: localDate(firmToday()) }}
              className="w-44"
            />
          </div>
          <ErrorText error={error} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              {ta("cancel")}
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? <BrandLoader tone="current" className="size-4" /> : null}
              {busy ? ta("saving") : t("add")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Asking for a new due date, and the firm's answer. One request waits at a
 * time; approving moves the due date.
 */
export function DeadlineRequests(props: {
  actionId: string;
  dueDate: string | null;
  requests: DeadlineRequest[];
  slip: Slip;
  canRequest: boolean;
  canDecide: boolean;
}) {
  const t = useTranslations("action.deadline");
  const tm = useTranslations("metrics.aging");
  const format = useFormatter();
  const { slip } = props;
  // Proposing and deciding a date are steps of the next-step card (page audit 4.5); this card is the record.
  if (!props.requests.length && !slip.history.length) return null;
  const day = (d: string) => format.dateTime(new Date(d), { dateStyle: "medium" });

  return (
    <Card className="gap-3 py-5 shadow-xs">
      <CardHeader className="px-5">
        <CardTitle className="flex items-center gap-2 text-base">
          <CalendarClock className="size-4 text-muted-foreground" />
          {t("title")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 px-5 text-sm">
        {slip.baseline && (slip.extensions > 0 || slip.daysLate) ? (
          <div className="space-y-1 rounded-md bg-muted/50 px-3 py-2">
            <p>{t("original", { date: day(slip.baseline) })}</p>
            {slip.extensions > 0 ? (
              <p className="text-muted-foreground">{t("slipped", { count: slip.extensions, days: slip.slipDays })}</p>
            ) : null}
            {slip.daysLate && slip.bucket ? (
              <p className="flex flex-wrap items-center gap-2 font-medium text-destructive">
                {t("late", { days: slip.daysLate })}
                <Badge variant="outline">{tm(slip.bucket)}</Badge>
              </p>
            ) : null}
          </div>
        ) : null}
        {props.requests.length === 0 ? <p className="text-muted-foreground">{t("none")}</p> : null}
        {props.requests.map((r) => (
          <div key={r.id} className="grid gap-1.5 border-t pt-3 first:border-t-0 first:pt-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium tabular-nums">{t("to", { date: day(r.proposedDueDate) })}</span>
              <Badge variant={r.status === "pending" ? "outline" : "secondary"}>{t(`status.${r.status}`)}</Badge>
              {r.raisedLate ? (
                <Badge variant="outline" title={r.dueDateThen ? t("raisedLateHint", { date: day(r.dueDateThen) }) : undefined}>
                  {t("raisedLate")}
                </Badge>
              ) : null}
              <span className="text-xs text-muted-foreground">
                {t("by", { who: r.requestedBy ?? "—", date: format.dateTime(new Date(r.createdAt), { dateStyle: "medium" }) })}
              </span>
            </div>
            <p className="whitespace-pre-wrap text-muted-foreground">{r.reason}</p>
          </div>
        ))}
        {slip.history.length ? (
          <div className="grid gap-2 border-t pt-3">
            <p className="text-xs font-medium text-muted-foreground">{t("history")}</p>
            <ol className="grid gap-1.5">
              {slip.history.map((h) => (
                <li key={h.id} className="grid gap-0.5">
                  <span className="tabular-nums">
                    {t("moved", { from: h.from ? day(h.from) : "—", to: h.to ? day(h.to) : "—" })}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {h.by
                      ? t(h.viaRequest ? "movedByRequest" : "movedByPlan", { who: h.by, date: format.dateTime(new Date(h.at), { dateStyle: "medium" }) })
                      : t("movedOn", { date: format.dateTime(new Date(h.at), { dateStyle: "medium" }) })}
                  </span>
                </li>
              ))}
            </ol>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

/** Propose a new due date with a reason; the consultant agrees or declines. `trigger` replaces the card's button (a client's quiet link). */
export function AskForDate({ actionId, dueDate, onDone, trigger }: { actionId: string; dueDate: string | null; onDone: () => void; trigger?: ReactNode }) {
  const t = useTranslations("action.deadline");
  const ta = useTranslations("action");
  const [open, setOpen] = useState(false);
  const { busy, error, go } = useRun(onDone);
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const body = { proposedDueDate: String(form.get("date") ?? ""), reason: String(form.get("reason") ?? "").trim() };
    if (body.proposedDueDate && body.reason)
      go(
        () => send(`/api/actions/${actionId}/deadline-requests`, json(body)),
        () => setOpen(false),
      );
  }
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button variant="outline" size="sm">
            {t("ask")}
          </Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{t("ask")}</DialogTitle>
            <DialogDescription>{t("askHint")}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="new-date">{t("newDate")}</Label>
            <DatePicker
              id="new-date"
              name="date"
              required
              placeholder={t("newDate")}
              disabled={{ before: localDate(firmToday()) }}
              defaultValue={dueDate ?? undefined}
              className="w-44"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="date-reason">{ta("reasonLabel")}</Label>
            <Textarea id="date-reason" name="reason" required maxLength={4000} rows={3} />
          </div>
          <ErrorText error={error} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              {ta("cancel")}
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? <BrandLoader tone="current" className="size-4" /> : null}
              {busy ? ta("saving") : t("send")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
