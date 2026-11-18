"use client";

import { ShieldCheck } from "@/components/animate-ui/icons/shield-check";
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { BrandLoader } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { ErrorText, json, send, useRun } from "./action-panel";

interface Acceptance {
  id: string;
  statement: string;
  by: string;
  at: string | Date;
  /** Signed since the last reopen, so it still counts. */
  current: boolean;
}

/**
 * The client's signed acceptances of the risk of not finishing this action,
 * as a record: drawn only once one is signed. A client admin or manager signs
 * one from the page menu (SignDialog); the firm can then close the action as
 * "risk accepted".
 */
export function RiskAcceptances({ items, firmView }: { items: Acceptance[]; firmView: boolean }) {
  const t = useTranslations("action.risk");
  const format = useFormatter();
  if (!items.length) return null;
  return (
    <Card className="gap-4 py-5 shadow-xs">
      <CardHeader className="px-5">
        <CardTitle className="text-base">{t("title")}</CardTitle>
        <CardDescription>{firmView ? t("hint") : t("hintRead")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 px-5">
        <ul className="space-y-3">
          {items.map((a) => (
            <li key={a.id} className={cn("space-y-1 rounded-lg border px-3 py-2.5", !a.current && "opacity-60")}>
              <p className="flex items-center gap-2 text-sm font-medium">
                <ShieldCheck className="size-4 text-muted-foreground" />
                {a.by}
              </p>
              <p className="text-sm whitespace-pre-wrap">{a.statement}</p>
              <p className="text-xs text-muted-foreground tabular-nums">
                {format.dateTime(new Date(a.at), { dateStyle: "medium", timeStyle: "short" })}
                {a.current ? "" : ` · ${t("beforeReopen")}`}
              </p>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

/** Sign a risk acceptance, opened from the action page's menu (a client admin or manager). */
export function SignDialog({ actionId, open, onOpenChange }: { actionId: string; open: boolean; onOpenChange: (open: boolean) => void }) {
  const t = useTranslations("action.risk");
  const ta = useTranslations("action");
  const router = useRouter();
  const [statement, setStatement] = useState("");
  const [agreed, setAgreed] = useState(false);
  const { busy, error, go, setError } = useRun(() => router.refresh());
  const ready = statement.trim().length >= 10 && agreed;
  // Opened from the menu, so the fields are cleared on the way out.
  function setOpen(next: boolean) {
    onOpenChange(next);
    setError(null);
    if (!next) {
      setStatement("");
      setAgreed(false);
    }
  }
  function submit(e: FormEvent) {
    e.preventDefault();
    if (ready)
      go(
        () => send(`/api/actions/${actionId}/risk-acceptances`, json({ statement: statement.trim() })),
        () => setOpen(false),
      );
  }
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent>
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{t("sign")}</DialogTitle>
            <DialogDescription>{t("hintClient")}</DialogDescription>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">{t("signHint")}</p>
          <div className="grid gap-2">
            <Label htmlFor="risk-statement">{t("statement")}</Label>
            <Textarea
              id="risk-statement"
              required
              minLength={10}
              maxLength={4000}
              rows={4}
              placeholder={t("statementPlaceholder")}
              value={statement}
              onChange={(e) => setStatement(e.target.value)}
            />
          </div>
          <label className="flex items-start gap-3 text-sm">
            <Checkbox checked={agreed} onCheckedChange={(v) => setAgreed(v === true)} className="mt-0.5" />
            <span>{t("agree")}</span>
          </label>
          <ErrorText error={error} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              {ta("cancel")}
            </Button>
            <Button type="submit" disabled={busy || !ready}>
              {busy ? <BrandLoader tone="current" className="size-4" /> : null}
              {busy ? ta("saving") : t("signButton")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
