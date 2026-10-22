"use client";

import { CalendarClock } from "lucide-react";
import { FileText } from "@/components/animate-ui/icons/file-text";
import { Plus } from "@/components/animate-ui/icons/plus";
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { BrandLoader } from "@/components/brand";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import { DownloadButton } from "./download-button";
import { ErrorText, EvidenceDialog, json, ReasonDialog, RunButton, send, useRun } from "./action-panel";

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
  requestedBy: string | null;
  createdAt: string | Date;
}

const patch = (body: unknown): RequestInit => ({ ...json(body), method: "PATCH" });

/** A YYYY-MM-DD day as local midnight, for the calendar's disabled range. */
function localDate(day: string) {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y!, m! - 1, d!);
}

/**
 * The evidence the firm asked for on this action, item by item. The owner
 * answers an open or rejected item with a file; firm staff add items and
 * accept, reject or waive what was sent.
 */
export function EvidenceList(props: {
  actionId: string;
  items: EvidenceItem[];
  canManage: boolean;
  /** The viewer is firm staff: picks the hint, which shouldn't follow canManage (off once verified). */
  firmView: boolean;
  /** The user may attach evidence now (the action is open for it). */
  canSubmit: boolean;
}) {
  const t = useTranslations("action.items");
  const ta = useTranslations("action");
  const format = useFormatter();
  const router = useRouter();
  const done = () => router.refresh();
  if (!props.items.length && !props.canManage) return null;

  return (
    <Card className="gap-4 py-5 shadow-xs">
      <CardHeader className="flex flex-row items-start justify-between gap-4 px-5">
        <div className="space-y-1.5">
          <CardTitle className="text-base">{t("title")}</CardTitle>
          <CardDescription>{props.firmView ? t("hintFirm") : t("hintClient")}</CardDescription>
        </div>
        {props.canManage ? <AddItem actionId={props.actionId} onDone={done} /> : null}
      </CardHeader>
      <CardContent className="px-5">
        {props.items.length === 0 ? <p className="text-sm text-muted-foreground">{t("none")}</p> : null}
        <ul className="divide-y">
          {props.items.map((i) => (
            <li key={i.id} className="grid gap-2 py-3 first:pt-0 last:pb-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{i.title}</span>
                <Badge variant={i.status === "accepted" ? "secondary" : "outline"}>{t(`status.${i.status}`)}</Badge>
                {i.dueDate ? (
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {t("due", { date: format.dateTime(new Date(i.dueDate), { dateStyle: "medium" }) })}
                  </span>
                ) : null}
              </div>
              {i.description ? <p className="text-sm whitespace-pre-wrap text-muted-foreground">{i.description}</p> : null}
              {i.decisionNote && (i.status === "rejected" || i.status === "waived") ? (
                <p className="text-sm">
                  {t(i.status === "rejected" ? "rejectedBecause" : "waivedBecause", { note: i.decisionNote })}
                </p>
              ) : null}
              {i.files.length ? (
                <ul className="flex flex-wrap gap-2">
                  {i.files.map((f) => (
                    <li key={f.documentId} className="flex items-center gap-2 rounded-md border bg-muted/30 px-2 py-1 text-sm">
                      <FileText className="size-3.5 text-muted-foreground" />
                      <span className="max-w-60 truncate">{f.title}</span>
                      <DownloadButton documentId={f.documentId} label={ta("download")} unavailable={ta("errors.unavailable")} />
                    </li>
                  ))}
                </ul>
              ) : null}
              <div className="flex flex-wrap gap-2">
                {props.canSubmit && (i.status === "open" || i.status === "rejected") ? (
                  <EvidenceDialog
                    actionId={props.actionId}
                    submit={false}
                    evidenceRequestId={i.id}
                    title={t("answerTitle", { item: i.title })}
                    onDone={done}
                    trigger={<Button size="sm">{t("answer")}</Button>}
                  />
                ) : null}
                {props.canManage && i.status === "submitted" ? (
                  <>
                    <RunButton
                      label={t("accept")}
                      run={() => send(`/api/evidence-requests/${i.id}`, patch({ status: "accepted" }))}
                      onDone={done}
                    />
                    <ReasonDialog
                      title={t("reject")}
                      hint={t("rejectHint")}
                      run={(note) => send(`/api/evidence-requests/${i.id}`, patch({ status: "rejected", note }))}
                      onDone={done}
                      trigger={<Button variant="outline">{t("reject")}</Button>}
                    />
                  </>
                ) : null}
                {props.canManage && (i.status === "open" || i.status === "submitted" || i.status === "rejected") ? (
                  <ReasonDialog
                    title={t("waive")}
                    hint={t("waiveHint")}
                    run={(note) => send(`/api/evidence-requests/${i.id}`, patch({ status: "waived", note }))}
                    onDone={done}
                    trigger={<Button variant="outline">{t("waive")}</Button>}
                  />
                ) : null}
                {props.canManage && i.status === "rejected" ? (
                  <RunButton
                    label={t("reopen")}
                    run={() => send(`/api/evidence-requests/${i.id}`, patch({ status: "open" }))}
                    onDone={done}
                  />
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function AddItem({ actionId, onDone }: { actionId: string; onDone: () => void }) {
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
            <DialogDescription>{t("addHint")}</DialogDescription>
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
  canRequest: boolean;
  canDecide: boolean;
}) {
  const t = useTranslations("action.deadline");
  const format = useFormatter();
  const router = useRouter();
  const done = () => router.refresh();
  if (!props.requests.length && !props.canRequest) return null;
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
        {props.requests.length === 0 ? <p className="text-muted-foreground">{t("none")}</p> : null}
        {props.canRequest ? <AskForDate actionId={props.actionId} dueDate={props.dueDate} onDone={done} /> : null}
        {props.requests.map((r) => (
          <div key={r.id} className="grid gap-1.5 border-t pt-3 first:border-t-0 first:pt-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium tabular-nums">{t("to", { date: day(r.proposedDueDate) })}</span>
              <Badge variant={r.status === "pending" ? "outline" : "secondary"}>{t(`status.${r.status}`)}</Badge>
              <span className="text-xs text-muted-foreground">
                {t("by", { who: r.requestedBy ?? "—", date: format.dateTime(new Date(r.createdAt), { dateStyle: "medium" }) })}
              </span>
            </div>
            <p className="whitespace-pre-wrap text-muted-foreground">{r.reason}</p>
            {props.canDecide && r.status === "pending" ? (
              <div className="flex flex-wrap gap-2">
                <RunButton
                  label={t("approve")}
                  run={() => send(`/api/deadline-requests/${r.id}`, patch({ approve: true }))}
                  onDone={done}
                />
                <RunButton
                  label={t("reject")}
                  run={() => send(`/api/deadline-requests/${r.id}`, patch({ approve: false }))}
                  onDone={done}
                />
              </div>
            ) : null}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function AskForDate({ actionId, dueDate, onDone }: { actionId: string; dueDate: string | null; onDone: () => void }) {
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
        <Button variant="outline" size="sm">
          {t("ask")}
        </Button>
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
