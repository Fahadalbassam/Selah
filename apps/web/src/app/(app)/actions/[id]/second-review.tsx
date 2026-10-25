"use client";

import { markJustVerified } from "@/components/verified-burst";
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { useState, type FormEvent, type ReactNode } from "react";
import { toast } from "@/components/ui/toast";
import { BrandLoader } from "@/components/brand";
import { ToneBadge } from "@/components/tone-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { callApi } from "@/components/form-dialog";
import { SIGN_OFF_NOTE_MAX, type SecondReviewReason, type SecondReviewRule } from "@/lib/second-review";
import { ErrorText, json, send, useRun } from "./action-panel";

/** What the action page knows about second sign-offs (services/second-review.ts, actionSecondReview). */
export interface SecondReviewView {
  required: boolean;
  reason: SecondReviewReason | null;
  rule: SecondReviewRule | null;
  flagged: boolean;
  revisions: number;
  signoff: { name: string | null; at: Date } | null;
  candidates: { id: string; name: string; fallback: boolean }[];
  can: { signOff: boolean; verify: boolean; flag: boolean };
}

/** The first of two sign-offs, with an optional note for the second reviewer. */
export function SignOffDialog({ actionId, trigger }: { actionId: string; trigger: ReactNode }) {
  const t = useTranslations("action.secondReview");
  const ta = useTranslations("action");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const { busy, error, go, setError } = useRun(() => router.refresh());
  function submit(e: FormEvent) {
    e.preventDefault();
    const body = note.trim() ? { note: note.trim() } : {};
    go(() => send(`/api/actions/${actionId}/sign-off`, json(body)), () => setOpen(false));
  }
  return (
    <Dialog open={open} onOpenChange={(o) => (setOpen(o), setError(null))}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{t("signOff")}</DialogTitle>
            <DialogDescription>{t("signOffHint")}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="sign-off-note">{t("note")}</Label>
            <Textarea
              id="sign-off-note"
              maxLength={SIGN_OFF_NOTE_MAX}
              rows={3}
              value={note}
              placeholder={t("notePlaceholder")}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
          <ErrorText error={error} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              {ta("cancel")}
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? <BrandLoader tone="current" className="size-4" /> : null}
              {busy ? ta("saving") : t("signOff")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** The second sign-off: an accept that verifies the action. */
export function SecondSignOffDialog({ actionId, trigger }: { actionId: string; trigger: ReactNode }) {
  const t = useTranslations("action.secondReview");
  const ta = useTranslations("action");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const { busy, error, go } = useRun(() => router.refresh());
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("verify")}</DialogTitle>
          <DialogDescription>{t("verifyHint")}</DialogDescription>
        </DialogHeader>
        <ErrorText error={error} />
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            {ta("cancel")}
          </Button>
          <Button
            onClick={() =>
              go(
                () => send(`/api/actions/${actionId}/transition`, json({ to: "verified_complete" })),
                () => (setOpen(false), markJustVerified(actionId)),
              )
            }
            disabled={busy}
          >
            {busy ? <BrandLoader tone="current" className="size-4" /> : null}
            {busy ? ta("saving") : t("verify")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Where the round stands, under the next-step buttons while the action awaits review. */
export function SecondReviewStatus({ view, firmView }: { view: SecondReviewView; firmView: boolean }) {
  const t = useTranslations("action.secondReview");
  const format = useFormatter();
  if (!view.required) return null;
  const team = view.candidates.filter((c) => !c.fallback);
  const admins = view.candidates.filter((c) => c.fallback);
  const names = (list: { name: string }[]) => format.list(list.map((c) => c.name), { type: "conjunction" });
  return (
    <div className="space-y-1.5 rounded-lg border bg-muted/40 px-4 py-3 text-sm">
      <p className="font-medium">{view.signoff ? t("halfDone") : t("needsTwo")}</p>
      {view.signoff ? (
        <p className="text-muted-foreground">
          {firmView && view.signoff.name
            ? t("signedBy", { name: view.signoff.name, date: format.dateTime(view.signoff.at, { dateStyle: "medium", timeStyle: "short" }) })
            : t("signedClient")}
        </p>
      ) : (
        <p className="text-muted-foreground">{firmView ? t(`why.${view.reason ?? "flag"}`) : t("clientHint")}</p>
      )}
      {!firmView ? null : view.signoff ? (
        team.length ? (
          <p className="text-muted-foreground">{t("candidates", { names: names(team) })}</p>
        ) : admins.length ? (
          <p className="text-muted-foreground">{t("onlyAdmins", { names: names(admins) })}</p>
        ) : (
          <p className="text-destructive">{t("nobody")}</p>
        )
      ) : team.length === 1 ? (
        // Before the first sign-off the list holds whoever can review; with one, the second falls to the admins.
        <p className="text-muted-foreground">{t("onlyOne", { name: team[0]!.name })}</p>
      ) : null}
    </div>
  );
}

/** The side card: whether this action needs two sign-offs, and the lead's switch. Firm staff only. */
export function SecondReviewCard({ actionId, view }: { actionId: string; view: SecondReviewView }) {
  const t = useTranslations("action.secondReview");
  const tc = useTranslations("common");
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function flip(on: boolean) {
    setBusy(true);
    const r = await callApi(`/api/actions/${actionId}/second-review`, "PUT", { on });
    setBusy(false);
    if (!r.ok) return toast.error(tc(`errors.${r.error}`));
    toast.success(tc("saved"));
    router.refresh();
  }
  const fromRule = view.required && view.reason !== "flag";
  return (
    <Card className="h-fit gap-4 py-5 shadow-xs">
      <CardHeader className="px-5">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base">{t("title")}</CardTitle>
          <ToneBadge tone={view.required ? "waiting" : "neutral"}>{view.required ? t("required") : t("notRequired")}</ToneBadge>
        </div>
        <CardDescription>{t("hint")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 px-5 text-sm">
        {view.rule ? <p className="text-muted-foreground">{t("clientRule", { rule: t(`rules.${view.rule}.label`) })}</p> : null}
        {view.revisions > 0 ? <p className="text-muted-foreground">{t("revisions", { n: view.revisions })}</p> : null}
        {view.can.flag ? (
          <div className="flex items-start justify-between gap-3 border-t pt-4">
            <Label htmlFor="second-review-flag" className="flex-col items-start gap-1 font-normal">
              <span className="font-medium">{t("flag")}</span>
              <span className="text-xs text-muted-foreground">{fromRule ? t("flagByRule") : t("flagHint")}</span>
            </Label>
            <Switch id="second-review-flag" checked={view.flagged} disabled={busy} onCheckedChange={flip} />
          </div>
        ) : view.flagged ? (
          <p className="text-muted-foreground">{t("flaggedByLead")}</p>
        ) : null}
      </CardContent>
    </Card>
  );
}
