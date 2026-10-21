"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, type FormEvent, type ReactNode } from "react";
import { toast } from "sonner";
import { BrandLoader } from "@/components/brand";
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
import { Textarea } from "@/components/ui/textarea";
import { ACCEPTED_EXTENSIONS } from "@/lib/upload-rules";
import type { ActionStatus } from "@/authz";

interface Props {
  actionId: string;
  status: ActionStatus;
  /** Moves the server allows this user right now (from canTransition). */
  moves: ActionStatus[];
  can: { addUpdate: boolean; submitEvidence: boolean };
}

type Result = { ok: true } | { ok: false; error: string };

/** Map an API error to a message key; the API never returns internals. */
async function send(url: string, init: RequestInit): Promise<Result> {
  const res = await fetch(url, init);
  if (res.ok) return { ok: true };
  const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
  if (res.status === 409) return { ok: false, error: "conflict" };
  if (res.status === 503) return { ok: false, error: "scanner" };
  const m = body.message ?? "";
  if (m.includes("too large")) return { ok: false, error: "too_large" };
  if (m.includes("rejected: empty")) return { ok: false, error: "empty" };
  if (m.includes("rejected: infected")) return { ok: false, error: "infected" };
  if (m.includes("rejected")) return { ok: false, error: "type" };
  if (m.includes("submit evidence")) return { ok: false, error: "needEvidence" };
  return { ok: false, error: "generic" };
}

const json = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

export function ActionPanel({ actionId, status, moves, can }: Props) {
  const t = useTranslations("action");
  const router = useRouter();
  const transition = (to: ActionStatus, reason?: string) =>
    send(`/api/actions/${actionId}/transition`, json(reason ? { to, reason } : { to }));
  const done = () => router.refresh();

  const buttons: ReactNode[] = [];
  for (const to of moves) {
    if (to === "awaiting_review") {
      buttons.push(<EvidenceDialog key={to} actionId={actionId} submit onDone={done} trigger={<Button>{t("move.awaiting_review")}</Button>} />);
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
          title={t("move.verified_complete")}
          hint={t("acceptHint")}
          run={() => transition(to)}
          onDone={done}
          trigger={<Button>{t("move.verified_complete")}</Button>}
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
        {can.addUpdate ? <UpdateForm actionId={actionId} onDone={done} /> : null}
      </CardContent>
    </Card>
  );
}

function useRun(onDone: () => void) {
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

function ErrorText({ error }: { error: string | null }) {
  const t = useTranslations("action.errors");
  return error ? (
    <p role="alert" className="text-sm text-destructive">
      {t(error)}
    </p>
  ) : null;
}

function RunButton({ label, run, onDone }: { label: string; run: () => Promise<Result>; onDone: () => void }) {
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

function ReasonDialog(props: {
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

function EvidenceDialog(props: { actionId: string; submit: boolean; trigger: ReactNode; onDone: () => void }) {
  const t = useTranslations("action");
  const [open, setOpen] = useState(false);
  const { busy, error, go } = useRun(props.onDone);
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) {
      form.delete("file");
      // Sending for review without a new file works only if evidence was attached earlier.
      if (props.submit) {
        go(() => send(`/api/actions/${props.actionId}/transition`, json({ to: "awaiting_review" })), () => setOpen(false));
      }
      return;
    }
    form.set("submitForReview", String(props.submit));
    go(() => send(`/api/actions/${props.actionId}/evidence`, { method: "POST", body: form }), () => setOpen(false));
  }
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{props.trigger}</DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{props.submit ? t("move.awaiting_review") : t("evidenceTitle")}</DialogTitle>
            <DialogDescription>{t("evidenceHint")}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="file">{t("file")}</Label>
            <Input id="file" name="file" type="file" accept={ACCEPTED_EXTENSIONS} required={!props.submit} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="note">{t("note")}</Label>
            <Textarea id="note" name="note" maxLength={4000} rows={3} />
          </div>
          <ErrorText error={error} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              {t("cancel")}
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? <BrandLoader tone="current" className="size-4" /> : null}
              {busy ? t("saving") : props.submit ? t("sendForReview") : t("upload")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

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
