"use client";

import { markJustVerified } from "@/components/verified-burst";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, type FormEvent, type ReactNode } from "react";
import { toast } from "@/components/ui/toast";
import { BrandLoader } from "@/components/brand";
import { FileBrowser } from "@/components/file-explorer";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { ACCEPTED_EXTENSIONS } from "@/lib/upload-rules";
import { cn } from "@/lib/utils";
import type { ActionStatus } from "@/authz";
import type { FileEntry } from "@/services/files";

interface Props {
  actionId: string;
  status: ActionStatus;
  /** Moves the server allows this user right now (from canTransition). */
  moves: ActionStatus[];
  can: { addUpdate: boolean; submitEvidence: boolean };
  /** For closing: whether the client has signed a risk acceptance, and the actions that could replace this one. */
  close?: { signed: boolean; replacements: { id: string; title: string }[] };
  /** The evidence list's open items: a file sent for review answers one of them. */
  openItems?: { id: string; title: string }[];
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
  if (m.includes("needs the lead")) return { ok: false, error: "needsLead" };
  if (res.status === 409) return { ok: false, error: "conflict" };
  if (res.status === 503) return { ok: false, error: "scanner" };
  if (m.includes("too large")) return { ok: false, error: "too_large" };
  if (m.includes("rejected: empty")) return { ok: false, error: "empty" };
  if (m.includes("rejected: infected")) return { ok: false, error: "infected" };
  if (m.includes("rejected")) return { ok: false, error: "type" };
  if (m.includes("submit evidence")) return { ok: false, error: "needEvidence" };
  if (m.includes("shared with the firm")) return { ok: false, error: "notShared" };
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

export function ActionPanel({ actionId, status, moves, can, close, openItems = [] }: Props) {
  const t = useTranslations("action");
  const router = useRouter();
  const transition = (to: ActionStatus, reason?: string) =>
    send(`/api/actions/${actionId}/transition`, json(reason ? { to, reason } : { to }));
  const done = () => router.refresh();

  const buttons: ReactNode[] = [];
  for (const to of moves) {
    if (to === "awaiting_review") {
      buttons.push(
        <EvidenceDialog key={to} actionId={actionId} submit items={openItems} onDone={done} trigger={<Button>{t("move.awaiting_review")}</Button>} />,
      );
    } else if (to === "blocked" || to === "revision_requested") {
      buttons.push(
        <ReasonDialog
          key={to}
          title={t(`move.${to}`)}
          hint={to === "blocked" ? t("blockHint") : t("reviseHint")}
          run={(reason) => transition(to, reason)}
          onDone={done}
          trigger={<Button variant={to === "blocked" ? "outline" : "destructive"}>{t(`move.${to}`)}</Button>}
        />,
      );
    } else if (to === "verified_complete") {
      buttons.push(
        <ConfirmDialog
          key={to}
          title={t(`move.${to}`)}
          hint={t("acceptHint")}
          run={() => transition(to)}
          onDone={() => {
            markJustVerified(actionId);
            done();
          }}
          trigger={<Button>{t(`move.${to}`)}</Button>}
        />,
      );
    } else if (to === "closed") {
      buttons.push(
        <CloseDialog
          key={to}
          actionId={actionId}
          signed={close?.signed ?? false}
          replacements={close?.replacements ?? []}
          onDone={done}
          trigger={<Button variant="outline">{t("move.closed")}</Button>}
        />,
      );
    } else if (to === "in_progress" && (status === "closed" || status === "verified_complete")) {
      buttons.push(
        <ReasonDialog
          key={to}
          title={t("reopen")}
          hint={t("reopenHint")}
          run={(reason) => transition(to, reason)}
          onDone={done}
          trigger={<Button variant="outline">{t("reopen")}</Button>}
        />,
      );
    } else {
      const label = to === "in_progress" && status !== "assigned" ? t("resume") : t(`move.${to}`);
      buttons.push(<RunButton key={to} label={label} run={() => transition(to)} onDone={done} />);
    }
  }
  if (can.submitEvidence) {
    buttons.push(
      <EvidenceDialog key="evidence" actionId={actionId} submit={false} onDone={done} trigger={<Button variant="outline">{t("uploadOnly")}</Button>} />,
    );
  }

  const note = status === "awaiting_review" && buttons.length === 0 ? t("awaitingNote") : status === "verified_complete" ? t("verifiedNote") : t("noMoves");

  return (
    <Card className="gap-4 py-5 shadow-xs">
      <CardHeader className="px-5">
        <CardTitle className="text-base">{t("nextStep")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5 px-5">
        {buttons.length ? <div className="flex flex-wrap gap-2">{buttons}</div> : <p className="text-sm text-muted-foreground">{note}</p>}
        {status === "revision_requested" && moves.includes("in_progress") ? (
          <p className="text-sm text-muted-foreground">{t("revisionNote")}</p>
        ) : null}
        {can.addUpdate ? <UpdateForm actionId={actionId} onDone={done} /> : null}
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

export function RunButton({ label, run, onDone }: { label: string; run: () => Promise<Result>; onDone: () => void }) {
  const { busy, error, go } = useRun(onDone);
  return (
    <div className="space-y-1">
      <Button onClick={() => go(run)} disabled={busy}>
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

/** End the action without verification: how it ended, and a note everyone on the project sees. */
function CloseDialog(props: {
  actionId: string;
  signed: boolean;
  replacements: { id: string; title: string }[];
  trigger: ReactNode;
  onDone: () => void;
}) {
  const t = useTranslations("action");
  const [open, setOpen] = useState(false);
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
      <DialogTrigger asChild>{props.trigger}</DialogTrigger>
      <DialogContent>
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

export function ReasonDialog(props: {
  title: string;
  hint: string;
  trigger: ReactNode;
  run: (reason: string) => Promise<Result>;
  onDone: () => void;
}) {
  const t = useTranslations("action");
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const { busy, error, go } = useRun(props.onDone);
  function submit(e: FormEvent) {
    e.preventDefault();
    if (reason.trim()) go(() => props.run(reason.trim()), () => setOpen(false));
  }
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{props.trigger}</DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{props.title}</DialogTitle>
            <DialogDescription>{props.hint}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="reason">{t("reasonLabel")}</Label>
            <Textarea id="reason" required maxLength={4000} rows={4} value={reason} onChange={(e) => setReason(e.target.value)} />
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
 * Attach a file to the action; with evidenceRequestId, it answers that item of
 * the evidence list. The file is either uploaded now or picked from the files
 * the person can already open in Selah (a copy is attached; see services/files).
 * Sent for review, a file answers the only open item on its own (the server
 * picks it); with several open items (`items`), the person says which.
 */
export function EvidenceDialog(props: {
  actionId: string;
  submit: boolean;
  trigger: ReactNode;
  onDone: () => void;
  evidenceRequestId?: string;
  items?: { id: string; title: string }[];
  title?: string;
}) {
  const t = useTranslations("action");
  const [open, setOpen] = useState(false);
  const choose = props.submit && !props.evidenceRequestId && (props.items?.length ?? 0) > 1;
  const [item, setItem] = useState("");
  const itemId = props.evidenceRequestId ?? (choose && item !== NO_ITEM ? item || undefined : undefined);
  const [mode, setMode] = useState<"upload" | "pick">("upload");
  const [note, setNote] = useState("");
  const { busy, error, go } = useRun(props.onDone);
  function close(next: boolean) {
    setOpen(next);
    if (!next) {
      setMode("upload");
      setNote("");
      setItem("");
    }
  }
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    // Picking sends on "Use this file"; Enter in the search box sends nothing.
    if (mode === "pick") return;
    const form = new FormData(e.currentTarget);
    form.delete("item");
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) {
      form.delete("file");
      // Sending for review without a new file works only if evidence was attached earlier.
      if (props.submit) {
        go(() => send(`/api/actions/${props.actionId}/transition`, json({ to: "awaiting_review" })), () => close(false));
      }
      return;
    }
    form.set("submitForReview", String(props.submit));
    if (itemId) form.set("evidenceRequestId", itemId);
    go(() => send(`/api/actions/${props.actionId}/evidence`, { method: "POST", body: form }), () => close(false));
  }
  function pick(file: FileEntry) {
    go(
      () =>
        send(
          `/api/actions/${props.actionId}/evidence/existing`,
          json({
            documentId: file.id,
            note: note.trim() || undefined,
            submitForReview: props.submit,
            evidenceRequestId: itemId,
          }),
        ),
      () => close(false),
    );
  }
  const itemField = choose ? (
    <div className="grid gap-2">
      <Label htmlFor="item">{t("answersItem")}</Label>
      <Select name="item" value={item} onValueChange={setItem} required>
        <SelectTrigger id="item" className="w-full">
          <SelectValue placeholder={t("answersItemPick")} />
        </SelectTrigger>
        <SelectContent>
          {props.items!.map((i) => (
            <SelectItem key={i.id} value={i.id}>
              {i.title}
            </SelectItem>
          ))}
          <SelectItem value={NO_ITEM}>{t("answersNone")}</SelectItem>
        </SelectContent>
      </Select>
    </div>
  ) : null;
  // Picking a file sends it at once, so the item must be chosen first.
  const needItem = choose && !item;
  const noteField = (
    <div className="grid gap-2">
      <Label htmlFor="note">{t("note")}</Label>
      <Textarea id="note" name="note" maxLength={4000} rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
    </div>
  );
  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogTrigger asChild>{props.trigger}</DialogTrigger>
      <DialogContent className={cn(mode === "pick" && "max-h-[85vh] overflow-y-auto sm:max-w-2xl")}>
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{props.title ?? (props.submit ? t("move.awaiting_review") : t("evidenceTitle"))}</DialogTitle>
            <DialogDescription>{t("evidenceHint")}</DialogDescription>
          </DialogHeader>
          <Tabs value={mode} onValueChange={(v) => setMode(v as "upload" | "pick")}>
            <TabsList className="w-full">
              <TabsTrigger value="upload">{t("uploadNew")}</TabsTrigger>
              <TabsTrigger value="pick">{t("pickExisting")}</TabsTrigger>
            </TabsList>
          </Tabs>
          {itemField}
          {mode === "upload" ? (
            <>
              <div className="grid gap-2">
                <Label htmlFor="file">{t("file")}</Label>
                <Input id="file" name="file" type="file" accept={ACCEPTED_EXTENSIONS} required={!props.submit} />
              </div>
              {noteField}
            </>
          ) : (
            <>
              {noteField}
              <FileBrowser className="max-h-[50vh]" pick={{ actionId: props.actionId, onPick: pick, busy: busy || needItem }} />
            </>
          )}
          <ErrorText error={error} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => close(false)}>
              {t("cancel")}
            </Button>
            {mode === "upload" ? (
              <Button type="submit" disabled={busy || needItem}>
                {busy ? <BrandLoader tone="current" className="size-4" /> : null}
                {busy ? t("saving") : props.submit ? t("sendForReview") : t("upload")}
              </Button>
            ) : null}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const NO_ITEM = "none";

function UpdateForm({ actionId, onDone }: { actionId: string; onDone: () => void }) {
  const t = useTranslations("action");
  const [body, setBody] = useState("");
  const { busy, error, go } = useRun(onDone);
  function submit(e: FormEvent) {
    e.preventDefault();
    if (body.trim()) go(() => send(`/api/actions/${actionId}/updates`, json({ body: body.trim() })), () => setBody(""));
  }
  return (
    <form onSubmit={submit} className="grid gap-2 border-t pt-4">
      <Label htmlFor="update">{t("addUpdate")}</Label>
      <Textarea id="update" rows={3} maxLength={4000} placeholder={t("updatePlaceholder")} value={body} onChange={(e) => setBody(e.target.value)} />
      <ErrorText error={error} />
      <div>
        <Button type="submit" variant="secondary" size="sm" disabled={busy || !body.trim()}>
          {busy ? <BrandLoader tone="current" className="size-4" /> : null}
          {busy ? t("saving") : t("post")}
        </Button>
      </div>
    </form>
  );
}
