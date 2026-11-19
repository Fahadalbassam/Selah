"use client";

import { markJustVerified } from "@/components/verified-burst";
import { FileText } from "@/components/animate-ui/icons/file-text";
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { useState, type FormEvent, type ReactNode } from "react";
import { toast } from "@/components/ui/toast";
import { BrandLoader } from "@/components/brand";
import { Hint } from "@/components/hint";
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
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { DatePicker } from "@/components/ui/date-picker";
import { useDialogControl, type DialogControl } from "@/hooks/use-dialog-control";
import type { NextPlan } from "@/lib/action-next";
import { firmToday } from "@/lib/dates";
import { RECEIVED_VIA, receivedPayload, type ReceivedVia } from "@/lib/engagement";
import { ASK_EVENT } from "@/lib/help";
import { cn } from "@/lib/utils";
import type { ActionStatus } from "@/authz";
import { DownloadButton } from "./download-button";
import { AskForDate } from "./follow-through-panels";
import { SecondSignOffDialog, SignOffDialog } from "./second-review";
import { ActionSendFile } from "./send-file";

// The action page's next-step card (page audit 4.5, block 3; batch 4): one
// solid button, what waits and on whom, three quiet links under it. What it
// offers comes from nextStep() (lib/action-next.ts), built from the server's
// own permissions. The rare things are in the page's menu (ActionPageMenu).

interface Props {
  actionId: string;
  status: ActionStatus;
  plan: NextPlan;
  /** Evidence items still waiting for a file (open or not accepted), for the one file dialog. */
  waitingItems: { id: string; title: string }[];
  /** Files sent in the round under review, shown to the reviewer in the same card. */
  judged: { documentId: string; title: string; canDownload: boolean }[];
  /** Number of items whose files the verify step also accepts (October review, item 12). */
  toAccept: number;
  firmView: boolean;
  /** Firm staff recording for a client the firm runs: each note and file says how and when the client sent it. */
  recordFor: boolean;
  /** A draft whose named owner is no longer an active member of the project team: release would be refused. */
  ownerGone: boolean;
  blockedReason: string | null;
  awaitingSince: string | Date | null;
  /** The firm's reviewers for this round, by name (N25), or null for a client reader. */
  reviewers: string[] | null;
  /** A proposed date this reader may decide. */
  date: { id: string; proposedDueDate: string; reason: string; requestedBy: string | null; needsLead: boolean } | null;
  dueDate: string | null;
  /** Under the buttons: a client reader's two plain lines (what is expected next and by when, what happened last). */
  after?: ReactNode;
}

export type Result = { ok: true } | { ok: false; error: string };

/** Map an API error to a message key; the API never returns internals. */
export async function send(url: string, init: RequestInit): Promise<Result> {
  const res = await fetch(url, init);
  if (res.ok) return { ok: true };
  const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
  const m = body.message ?? "";
  // A data rule's refusal is a 409 too; say which rule before falling back to "someone changed it".
  if (m.includes("every evidence request")) return { ok: false, error: "openEvidence" };
  if (m.includes("two sign-offs")) return { ok: false, error: "needsSignOff" };
  if (m.includes("already has its first sign-off")) return { ok: false, error: "alreadySigned" };
  if (m.includes("second sign-off by another")) return { ok: false, error: "secondReviewer" };
  if (m.includes("needs the lead")) return { ok: false, error: "needsLead" };
  // Recording for a client the firm runs: how and when the client sent it.
  if (m.includes("received_on cannot be in the future")) return { ok: false, error: "receivedFuture" };
  if (m.includes("say how and when the client told you")) return { ok: false, error: "received" };
  if (m.includes("owner must be an active member")) return { ok: false, error: "ownerGone" };
  if (m.includes("owner must be on the project")) return { ok: false, error: "ownerGone" };
  if (m.includes("already owns") || m.includes("already the action's owner")) return { ok: false, error: "sameOwner" };
  if (m.includes("job title")) return { ok: false, error: "minimalOwner" };
  if (m.includes("replacement is still a draft")) return { ok: false, error: "replacementDraft" };
  if (res.status === 409) return { ok: false, error: "conflict" };
  if (res.status === 503) return { ok: false, error: "scanner" };
  if (m.includes("too large")) return { ok: false, error: "too_large" };
  if (m.includes("rejected: empty")) return { ok: false, error: "empty" };
  if (m.includes("rejected: infected")) return { ok: false, error: "infected" };
  if (m.includes("rejected")) return { ok: false, error: "type" };
  if (m.includes("submit evidence")) return { ok: false, error: "needEvidence" };
  if (m.includes("shared with the firm")) return { ok: false, error: "notShared" };
  if (m.includes("limited audience")) return { ok: false, error: "narrowed" };
  // The database's own refusal of the same bytes: neutral, since whoever uploads may be left out of the file.
  if (m.includes("can't be used as evidence")) return { ok: false, error: "notEvidence" };
  if (m.includes("in the past")) return { ok: false, error: "pastDate" };
  if (m.includes("already the due date")) return { ok: false, error: "sameDate" };
  if (m.includes("not signed a risk acceptance")) return { ok: false, error: "notSigned" };
  return { ok: false, error: "generic" };
}

export const json = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

const patch = (body: unknown): RequestInit => ({ ...json(body), method: "PATCH" });

export function ActionPanel(p: Props) {
  const t = useTranslations("action");
  const tn = useTranslations("action.next");
  const tTip = useTranslations("tips");
  const format = useFormatter();
  const router = useRouter();
  const transition = (to: ActionStatus, extra?: Record<string, unknown>) => send(`/api/actions/${p.actionId}/transition`, json({ to, ...extra }));
  const done = () => router.refresh();
  const { plan, status, ownerGone } = p;
  if (!plan.card) return null;
  const names = (list: string[]) => format.list(list, { type: "conjunction" });

  let main: ReactNode = null;
  switch (plan.main) {
    case "start":
      main = <RunButton label={t("move.in_progress")} run={() => transition("in_progress")} onDone={done} />;
      break;
    case "resume":
      main = <RunButton label={t("resume")} run={() => transition("in_progress")} onDone={done} />;
      break;
    case "release":
      main = <RunButton label={t("move.assigned")} run={() => transition("assigned")} onDone={done} />;
      break;
    case "send":
    case "resend":
      main = (
        <ActionSendFile
          actionId={p.actionId}
          items={p.waitingItems}
          canReview
          defaultAfter="review"
          recordFor={p.recordFor}
          firm={p.firmView}
          title={plan.main === "resend" ? tn("resend") : t("move.awaiting_review")}
          trigger={<Button>{plan.main === "resend" ? tn("resend") : t("move.awaiting_review")}</Button>}
        />
      );
      break;
    case "verify":
      main = (
        <ConfirmDialog
          title={t("move.verified_complete")}
          hint={p.toAccept && plan.acceptsItems ? `${t("acceptHint")} ${tn("alsoAccepts", { n: p.toAccept })}` : t("acceptHint")}
          run={() => transition("verified_complete", plan.acceptsItems ? { acceptItems: true } : undefined)}
          onDone={() => (markJustVerified(p.actionId), done())}
          trigger={<Button>{t("move.verified_complete")}</Button>}
        />
      );
      break;
    case "signOff":
      main = (
        <SignOffDialog
          actionId={p.actionId}
          trigger={
            <Hint asChild tip={tTip("secondReview.signOff")}>
              <Button>{t("secondReview.signOff")}</Button>
            </Hint>
          }
        />
      );
      break;
    case "secondSignOff":
      main = (
        <SecondSignOffDialog
          actionId={p.actionId}
          trigger={
            <Hint asChild tip={tTip("secondReview.verify")}>
              <Button>{t("secondReview.verify")}</Button>
            </Hint>
          }
        />
      );
      break;
    case "approveDate":
      main = p.date && !p.date.needsLead ? (
        <RunButton label={t("deadline.approve")} run={() => send(`/api/deadline-requests/${p.date!.id}`, patch({ approve: true }))} onDone={done} />
      ) : null;
      break;
  }
  const outline = plan.outline.map((o) =>
    o === "sendBack" ? (
      <ReasonDialog
        key={o}
        title={t("move.revision_requested")}
        hint={t("reviseHint")}
        run={(reason) => transition("revision_requested", { reason })}
        onDone={done}
        trigger={<Button variant="outline">{t("move.revision_requested")}</Button>}
      />
    ) : o === "resume" ? (
      <RunButton key={o} variant="outline" label={t("resume")} run={() => transition("in_progress")} onDone={done} />
    ) : o === "approveDate" && p.date && !p.date.needsLead ? (
      <RunButton key={o} variant="outline" label={t("deadline.approve")} run={() => send(`/api/deadline-requests/${p.date!.id}`, patch({ approve: true }))} onDone={done} />
    ) : o === "declineDate" && p.date ? (
      <RunButton key={o} variant="outline" label={t("deadline.reject")} run={() => send(`/api/deadline-requests/${p.date!.id}`, patch({ approve: false }))} onDone={done} />
    ) : null,
  );

  const since = p.awaitingSince ? format.dateTime(new Date(p.awaitingSince), { dateStyle: "medium" }) : null;
  const waiting =
    plan.waiting === "withConsultant"
      ? since
        ? tn("withConsultantSince", { date: since })
        : tn("withConsultant")
      : plan.waiting === "otherReviewer"
        ? p.reviewers?.length
          ? tn("otherReviewer", { names: names(p.reviewers) })
          : tn("noReviewer")
        : plan.waiting
          ? tn(plan.waiting)
          : null;
  const day = (d: string) => format.dateTime(new Date(`${d}T12:00:00Z`), { dateStyle: "medium", timeZone: "UTC" });

  return (
    <Card className="gap-4 py-5 shadow-xs">
      <CardHeader className="px-5">
        <CardTitle className="text-base">{t("nextStep")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 px-5">
        {/* Said before the click, in the words the refusal would use. */}
        {status === "draft" && ownerGone ? <p className="text-sm text-destructive">{t("errors.ownerGone")}</p> : null}
        {p.status === "blocked" && p.blockedReason ? <p className="rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive">{t("blocked", { reason: p.blockedReason })}</p> : null}
        {plan.main === "approveDate" || plan.outline.includes("declineDate") ? (
          p.date ? (
            <div className="space-y-1 rounded-lg border bg-muted/40 px-4 py-3 text-sm">
              <p className="font-medium">{tn("dateAsked", { date: day(p.date.proposedDueDate), who: p.date.requestedBy ?? t("someone") })}</p>
              <p className="whitespace-pre-wrap text-muted-foreground" dir="auto">
                {p.date.reason}
              </p>
              {p.date.needsLead ? <p className="text-xs text-muted-foreground">{t("deadline.needsLead")}</p> : null}
            </div>
          ) : null
        ) : null}
        {/* The reviewer judges the files in the same card. */}
        {p.status === "awaiting_review" && p.firmView && p.judged.length ? (
          <ul className="flex flex-wrap gap-2">
            {p.judged.map((f) => (
              <li key={f.documentId} className="flex items-center gap-2 rounded-md border bg-muted/30 px-2 py-1 text-sm">
                <FileText className="size-3.5 text-muted-foreground" />
                <span className="max-w-60 truncate">{f.title}</span>
                {f.canDownload ? <DownloadButton documentId={f.documentId} label={t("download")} unavailable={t("errors.unavailable")} /> : null}
              </li>
            ))}
          </ul>
        ) : null}
        {main || outline.some(Boolean) ? (
          <div className="flex flex-wrap items-start gap-2">
            {main}
            {outline}
          </div>
        ) : waiting ? (
          <p className="text-sm text-muted-foreground">{waiting}</p>
        ) : (
          <p className="text-sm text-muted-foreground">{t("noMoves")}</p>
        )}
        {plan.secondChecks && !p.firmView ? <p className="text-sm text-muted-foreground">{tn("secondChecks")}</p> : null}
        {/* Who reviews (N25): on a client the firm runs the consultant recording it reads that someone else checks it. */}
        {p.recordFor && (plan.main === "send" || plan.main === "resend") && p.reviewers ? (
          <p className="text-xs text-muted-foreground">{p.reviewers.length ? tn("reviewedBy", { names: names(p.reviewers) }) : tn("noReviewer")}</p>
        ) : null}
        {p.after}
        {plan.links.length ? (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t pt-3" data-slot="quiet-links">
            {plan.links.map((l) =>
              l === "stuck" ? (
                <ReasonDialog
                  key={l}
                  title={tn("stuck")}
                  hint={p.firmView ? t("blockHintFirm") : t("blockHint")}
                  run={(reason) => transition("blocked", { reason })}
                  onDone={done}
                  trigger={
                    <Button type="button" variant="link" size="sm" className="h-auto px-0">
                      {tn("stuck")}
                    </Button>
                  }
                />
              ) : l === "moreTime" ? (
                <AskForDate
                  key={l}
                  actionId={p.actionId}
                  dueDate={p.dueDate}
                  onDone={done}
                  trigger={
                    <Button type="button" variant="link" size="sm" className="h-auto px-0">
                      {tn("moreTime")}
                    </Button>
                  }
                />
              ) : (
                <Button key={l} type="button" variant="link" size="sm" className="h-auto px-0" onClick={() => window.dispatchEvent(new Event(ASK_EVENT))}>
                  {p.firmView ? tn("askClient") : tn("ask")}
                </Button>
              ),
            )}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function useRun(onDone: () => void) {
  const tc = useTranslations("common");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function go(run: () => Promise<Result>, after?: () => void) {
    setBusy(true);
    setError(null);
    try {
      const r = await run();
      if (r.ok) {
        toast.success(tc("saved"));
        after?.();
        onDone();
      } else setError(r.error);
    } catch {
      setError("generic");
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, go, setError };
}

export function ErrorText({ error }: { error: string | null }) {
  const t = useTranslations("action.errors");
  return error ? (
    <p role="alert" className="text-sm text-destructive">
      {t(error)}
    </p>
  ) : null;
}

export function RunButton({
  label,
  run,
  onDone,
  variant = "default",
  size,
}: {
  label: string;
  run: () => Promise<Result>;
  onDone: () => void;
  variant?: "default" | "outline";
  size?: "sm";
}) {
  const { busy, error, go } = useRun(onDone);
  return (
    <div className="space-y-1">
      <Button variant={variant} size={size} onClick={() => go(run)} disabled={busy}>
        {busy ? <BrandLoader tone="current" className="size-4" /> : null}
        {label}
      </Button>
      <ErrorText error={error} />
    </div>
  );
}

function ConfirmDialog(props: { title: string; hint: string; trigger: ReactNode; run: () => Promise<Result>; onDone: () => void }) {
  const t = useTranslations("action");
  const [open, setOpen] = useState(false);
  const { busy, error, go } = useRun(props.onDone);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{props.trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{props.title}</DialogTitle>
          <DialogDescription>{props.hint}</DialogDescription>
        </DialogHeader>
        <ErrorText error={error} />
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            {t("cancel")}
          </Button>
          <Button onClick={() => go(props.run, () => setOpen(false))} disabled={busy}>
            {busy ? <BrandLoader tone="current" className="size-4" /> : null}
            {busy ? t("saving") : t("confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const OUTCOMES = ["partially_implemented", "risk_accepted", "not_applicable", "superseded"] as const;
type Outcome = (typeof OUTCOMES)[number];

/** End the action without verification: how it ended, and a note everyone on the project sees. Opened from the page menu. */
export function CloseDialog(props: {
  actionId: string;
  signed: boolean;
  replacements: { id: string; title: string }[];
  control: DialogControl;
  onDone: () => void;
}) {
  const t = useTranslations("action");
  const { open, setOpen, contentProps } = useDialogControl(props.control);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [note, setNote] = useState("");
  const [successor, setSuccessor] = useState("");
  const { busy, error, go, setError } = useRun(props.onDone);
  const ready = outcome && note.trim() && (outcome !== "superseded" || successor) && (outcome !== "risk_accepted" || props.signed);
  function submit(e: FormEvent) {
    e.preventDefault();
    if (!ready) return;
    const closure = { outcome, note: note.trim(), ...(outcome === "superseded" ? { supersededBy: successor } : {}) };
    go(() => send(`/api/actions/${props.actionId}/transition`, json({ to: "closed", closure })), () => setOpen(false));
  }
  return (
    <Dialog open={open} onOpenChange={(o) => (setOpen(o), setError(null))}>
      <DialogContent {...contentProps}>
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{t("move.closed")}</DialogTitle>
            <DialogDescription>{t("closeHint")}</DialogDescription>
          </DialogHeader>
          <RadioGroup value={outcome ?? ""} onValueChange={(v) => setOutcome(v as Outcome)} className="gap-3" aria-label={t("closure.outcome")}>
            {OUTCOMES.map((o) => {
              const locked = o === "risk_accepted" && !props.signed;
              const none = o === "superseded" && props.replacements.length === 0;
              return (
                <label key={o} className={cn("flex items-start gap-3 text-sm", (locked || none) && "opacity-60")}>
                  <RadioGroupItem value={o} disabled={locked || none} className="mt-0.5" />
                  <span className="space-y-0.5">
                    <span className="block font-medium">{t(`closure.outcomes.${o}`)}</span>
                    <span className="block text-muted-foreground">
                      {locked ? t("closure.needsSignature") : none ? t("closure.noReplacement") : t(`closure.hints.${o}`)}
                    </span>
                  </span>
                </label>
              );
            })}
          </RadioGroup>
          {outcome === "superseded" ? (
            <div className="grid gap-2">
              <Label htmlFor="close-successor">{t("closure.replacedBy")}</Label>
              <Select value={successor} onValueChange={setSuccessor}>
                <SelectTrigger id="close-successor" className="w-full">
                  <SelectValue placeholder={t("closure.chooseAction")} />
                </SelectTrigger>
                <SelectContent>
                  {props.replacements.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}
          <div className="grid gap-2">
            <Label htmlFor="close-note">{t("closure.note")}</Label>
            <Textarea id="close-note" required maxLength={4000} rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          <ErrorText error={error} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              {t("cancel")}
            </Button>
            <Button type="submit" disabled={busy || !ready}>
              {busy ? <BrandLoader tone="current" className="size-4" /> : null}
              {busy ? t("saving") : t("move.closed")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** A step that needs a reason: blocking, sending back, reopening, an item not accepted. Its own trigger, or `control` from a menu. */
export function ReasonDialog(props: {
  title: string;
  hint: string;
  trigger?: ReactNode;
  control?: DialogControl;
  run: (reason: string) => Promise<Result>;
  onDone: () => void;
}) {
  const t = useTranslations("action");
  const { open, setOpen, contentProps } = useDialogControl(props.control);
  const [reason, setReason] = useState("");
  const { busy, error, go } = useRun(props.onDone);
  function submit(e: FormEvent) {
    e.preventDefault();
    if (reason.trim()) go(() => props.run(reason.trim()), () => (setOpen(false), setReason("")));
  }
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {props.trigger ? <DialogTrigger asChild>{props.trigger}</DialogTrigger> : null}
      <DialogContent {...contentProps}>
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{props.title}</DialogTitle>
            <DialogDescription>{props.hint}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="reason">{t("reasonLabel")}</Label>
            <Textarea id="reason" required maxLength={4000} rows={4} value={reason} onChange={(e) => setReason(e.target.value)} dir="auto" />
          </div>
          <ErrorText error={error} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              {t("cancel")}
            </Button>
            <Button type="submit" disabled={busy || !reason.trim()}>
              {busy ? <BrandLoader tone="current" className="size-4" /> : null}
              {busy ? t("saving") : t("confirm")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * How and when the client sent what the firm records for it (a client the
 * firm runs): the choice and the day, today by default and never later.
 * `payload` is what the request carries; `ready` says both are there.
 */
export function useReceived(recordFor: boolean) {
  const [via, setVia] = useState<ReceivedVia | "">("");
  const [on, setOn] = useState<string | undefined>(() => firmToday());
  const payload = receivedPayload(recordFor, via, on);
  return {
    via,
    setVia,
    on,
    setOn,
    payload,
    ready: !recordFor || (!!payload.receivedVia && !!payload.receivedOn),
    reset: () => (setVia(""), setOn(firmToday())),
  };
}

/** The two fields of useReceived(), in a note or file dialog. */
export function ReceivedFields({
  idPrefix,
  via,
  setVia,
  on,
  setOn,
}: {
  idPrefix: string;
  via: ReceivedVia | "";
  setVia: (v: ReceivedVia) => void;
  on: string | undefined;
  setOn: (v: string | undefined) => void;
}) {
  const t = useTranslations("action.recordFor");
  const [y, m, d] = firmToday().split("-").map(Number);
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="grid gap-2">
        <Label htmlFor={`${idPrefix}-via`}>{t("via")}</Label>
        <Select value={via} onValueChange={(v) => setVia(v as ReceivedVia)}>
          <SelectTrigger id={`${idPrefix}-via`} className="w-full">
            <SelectValue placeholder={t("choose")} />
          </SelectTrigger>
          <SelectContent>
            {RECEIVED_VIA.map((v) => (
              <SelectItem key={v} value={v}>
                {t(`vias.${v}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="grid gap-2">
        <Label htmlFor={`${idPrefix}-on`}>{t("on")}</Label>
        <DatePicker id={`${idPrefix}-on`} name="receivedOn" value={on} onChange={setOn} placeholder={t("on")} disabled={{ after: new Date(y!, m! - 1, d!) }} />
      </div>
    </div>
  );
}
