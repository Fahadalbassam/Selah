"use client";

import { MessageSquare } from "@/components/animate-ui/icons/message-square";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, type FormEvent, type ReactNode } from "react";
import { toast } from "sonner";
import { BrandLoader } from "@/components/brand";
import { useConfirm } from "@/components/confirm-dialog";
import { callApi } from "@/components/form-dialog";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { RECEIVED_VIA, type ReceivedVia } from "@/lib/engagement";
import { STANCE_NEEDS, STANCES, type Stance } from "@/lib/responses";

/** Maps a data rule's words (or the route's) to a message key under response.errors. */
function responseError(message: string | undefined, error: string) {
  const m = message ?? "";
  if (m.includes("planned action")) return "plan";
  if (m.includes("needs the reason")) return "reason";
  if (m.includes("receivedVia") || m.includes("received")) return m.includes("future") ? "future" : "received";
  if (m.includes("other than the one")) return "colleague";
  if (m.includes("already")) return "already";
  if (m.includes("can't take a response")) return "cannot";
  return error === "conflict" ? "already" : "cannot";
}

function useSend() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function send(url: string, body: unknown, done: string, close?: () => void) {
    setBusy(true);
    setError(null);
    const r = await callApi(url, "POST", body);
    setBusy(false);
    if (!r.ok) return void setError(responseError(r.message, r.error));
    close?.();
    toast.success(done);
    router.refresh();
  }
  return { busy, error, setError, send };
}

function Footer({ busy, error, label, onCancel }: { busy: boolean; error: string | null; label: string; onCancel: () => void }) {
  const t = useTranslations("response");
  const tc = useTranslations("common");
  return (
    <>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {t(`errors.${error}`)}
        </p>
      ) : null}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          {tc("cancel")}
        </Button>
        <Button type="submit" disabled={busy}>
          {busy ? <BrandLoader tone="current" className="size-4" /> : null}
          {busy ? tc("saving") : label}
        </Button>
      </DialogFooter>
    </>
  );
}

/**
 * The client's response to a recommendation: agree, partly agree or
 * disagree. Agreeing gives what will be done and by when; partly agreeing or
 * disagreeing gives the reason. For a consultant-managed client the firm
 * records it and says how and when the client gave it.
 */
export function RespondDialog({ recommendationId, onBehalf, trigger }: { recommendationId: string; onBehalf: boolean; trigger: ReactNode }) {
  const t = useTranslations("response");
  const [open, setOpen] = useState(false);
  const [stance, setStance] = useState<Stance | null>(null);
  const [via, setVia] = useState<ReceivedVia | "">("");
  const { busy, error, setError, send } = useSend();
  const needs = stance ? STANCE_NEEDS[stance] : null;

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!stance) return;
    const form = new FormData(e.currentTarget);
    const text = (k: string) => String(form.get(k) ?? "").trim() || null;
    void send(
      `/api/recommendations/${recommendationId}/responses`,
      {
        stance,
        reason: text("reason"),
        plannedAction: needs?.plan ? text("plannedAction") : null,
        actionOwner: needs?.plan ? text("actionOwner") : null,
        targetDate: needs?.plan ? text("targetDate") : null,
        ...(onBehalf ? { receivedVia: via || undefined, receivedOn: text("receivedOn") ?? undefined } : {}),
      },
      t("recorded"),
      () => setOpen(false),
    );
  }

  return (
    <Dialog open={open} onOpenChange={(o) => (setOpen(o), setError(null))}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{onBehalf ? t("dialogTitleOnBehalf") : t("dialogTitle")}</DialogTitle>
            <DialogDescription>{onBehalf ? t("hintOnBehalf") : t("hintClient")}</DialogDescription>
          </DialogHeader>
          <RadioGroup value={stance ?? ""} onValueChange={(v) => setStance(v as Stance)} aria-label={t("stance")} required>
            {STANCES.map((s) => (
              <label key={s} className="flex items-start gap-3 text-sm">
                <RadioGroupItem value={s} className="mt-0.5" />
                <span className="space-y-0.5">
                  <span className="block font-medium">{t(`choices.${s}`)}</span>
                  <span className="block text-muted-foreground">{t(`choiceHints.${s}`)}</span>
                </span>
              </label>
            ))}
          </RadioGroup>
          {needs?.plan ? (
            <>
              <div className="grid gap-2">
                <Label htmlFor="r-plan">{t("plannedAction")}</Label>
                <Textarea id="r-plan" name="plannedAction" required rows={3} maxLength={4000} dir="auto" placeholder={t("plannedActionPlaceholder")} />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="grid gap-2">
                  <Label htmlFor="r-owner">{t("actionOwner")}</Label>
                  <Input id="r-owner" name="actionOwner" maxLength={200} dir="auto" placeholder={t("actionOwnerPlaceholder")} />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="r-date">{t("targetDate")}</Label>
                  <DatePicker id="r-date" name="targetDate" required placeholder={t("targetDate")} />
                </div>
              </div>
            </>
          ) : null}
          {needs ? (
            <div className="grid gap-2">
              <Label htmlFor="r-reason">{needs.reason ? t("reason") : t("reasonOptional")}</Label>
              <Textarea id="r-reason" name="reason" required={needs.reason} rows={3} maxLength={4000} dir="auto" placeholder={t("reasonPlaceholder")} />
            </div>
          ) : null}
          {onBehalf ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="r-via">{t("via")}</Label>
                <Select value={via} onValueChange={(v) => setVia(v as ReceivedVia)} required>
                  <SelectTrigger id="r-via" className="w-full">
                    <SelectValue placeholder={t("via")} />
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
                <Label htmlFor="r-on">{t("receivedOn")}</Label>
                <DatePicker id="r-on" name="receivedOn" required placeholder={t("receivedOn")} disabled={{ after: new Date() }} />
              </div>
            </div>
          ) : null}
          <Footer busy={busy} error={error} label={t("submit")} onCancel={() => setOpen(false)} />
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** The firm's answer to one response, given once. */
export function AnswerDialog({ responseId }: { responseId: string }) {
  const t = useTranslations("response");
  const [open, setOpen] = useState(false);
  const { busy, error, setError, send } = useSend();

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const reply = String(new FormData(e.currentTarget).get("reply") ?? "").trim();
    void send(`/api/recommendation-responses/${responseId}/reply`, { reply }, t("answered"), () => setOpen(false));
  }

  return (
    <Dialog open={open} onOpenChange={(o) => (setOpen(o), setError(null))}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          <MessageSquare className="size-4" />
          {t("answer")}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{t("answerTitle")}</DialogTitle>
            <DialogDescription>{t("answerHint")}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor={`a-${responseId}`}>{t("answerLabel")}</Label>
            <Textarea id={`a-${responseId}`} name="reply" required rows={4} maxLength={4000} dir="auto" placeholder={t("answerPlaceholder")} />
          </div>
          <Footer busy={busy} error={error} label={t("answer")} onCancel={() => setOpen(false)} />
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** A colleague confirms a response the firm recorded; until then it doesn't count. */
export function ConfirmResponse({ responseId }: { responseId: string }) {
  const t = useTranslations("response");
  const [confirm, dialog] = useConfirm();
  const { busy, error, send } = useSend();
  return (
    <span className="inline-flex flex-col gap-1">
      <Button
        type="button"
        size="sm"
        disabled={busy}
        onClick={async () => {
          if (await confirm(t("confirmQuestion"))) void send(`/api/recommendation-responses/${responseId}/confirm`, undefined, t("confirmedToast"));
        }}
      >
        {busy ? <BrandLoader tone="current" className="size-4" /> : null}
        {t("confirm")}
      </Button>
      {error ? (
        <span role="alert" className="text-xs text-destructive">
          {t(`errors.${error}`)}
        </span>
      ) : null}
      {dialog}
    </span>
  );
}
