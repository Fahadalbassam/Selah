"use client";

import { Pencil } from "lucide-react";
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { toast } from "@/components/ui/toast";
import { BrandLoader } from "@/components/brand";
import { callApi } from "@/components/form-dialog";
import { ToneBadge } from "@/components/tone-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { SECOND_REVIEW_RULES, type SecondReviewRule } from "@/lib/second-review";

export interface SecondReviewRuleView {
  rule: SecondReviewRule;
  updatedAt: Date | null;
  updatedBy: string | null;
  canChange: boolean;
}

/** When this client's evidence needs a second consultant's sign-off (F22). The firm admin or the client's lead or deputy sets it. */
export function SecondReviewRuleCard({ clientId, view }: { clientId: string; view: SecondReviewRuleView }) {
  const t = useTranslations("action.secondReview");
  const tc = useTranslations("common");
  const format = useFormatter();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [rule, setRule] = useState<SecondReviewRule>(view.rule);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (rule === view.rule) return setOpen(false);
    setBusy(true);
    setError(null);
    const r = await callApi(`/api/orgs/${clientId}/second-review`, "PUT", { rule });
    setBusy(false);
    if (!r.ok) return setError(tc(`errors.${r.error}`));
    setOpen(false);
    toast.success(tc("saved"));
    router.refresh();
  }

  return (
    <Card className="h-fit gap-4 py-5 shadow-xs">
      <CardHeader className="flex flex-row items-start justify-between gap-4 px-5">
        <div className="space-y-1.5">
          <CardTitle className="text-base">{t("ruleTitle")}</CardTitle>
          <CardDescription>{t("ruleHint")}</CardDescription>
        </div>
        {view.canChange ? (
          <Button size="sm" variant="outline" onClick={() => (setRule(view.rule), setError(null), setOpen(true))}>
            <Pencil />
            {t("change")}
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-1 px-5 text-sm">
        <div className="flex items-center gap-2">
          <span className="font-medium">{t(`rules.${view.rule}.label`)}</span>
          <ToneBadge tone={view.rule === "off" ? "neutral" : "active"}>{view.rule === "off" ? t("off") : t("on")}</ToneBadge>
        </div>
        <p className="text-muted-foreground">{t(`rules.${view.rule}.hint`)}</p>
        {view.updatedAt && view.updatedBy ? (
          <p className="pt-1 text-xs text-muted-foreground">
            {t("changedBy", { name: view.updatedBy, date: format.dateTime(new Date(view.updatedAt), { dateStyle: "medium" }) })}
          </p>
        ) : null}
      </CardContent>
      {view.canChange ? (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent className="sm:max-w-lg">
            <form onSubmit={submit} className="grid gap-4">
              <DialogHeader>
                <DialogTitle>{t("ruleTitle")}</DialogTitle>
                <DialogDescription>{t("ruleChangeHint")}</DialogDescription>
              </DialogHeader>
              <RadioGroup value={rule} onValueChange={(v) => setRule(v as SecondReviewRule)} className="gap-3" aria-label={t("ruleTitle")}>
                {SECOND_REVIEW_RULES.map((r) => (
                  <label key={r} className="flex items-start gap-3 rounded-lg border p-3 text-sm">
                    <RadioGroupItem value={r} className="mt-0.5" />
                    <span className="space-y-0.5">
                      <span className="block font-medium">
                        {t(`rules.${r}.label`)}
                        {r === view.rule ? <span className="ms-2 text-xs font-normal text-muted-foreground">{t("current")}</span> : null}
                      </span>
                      <span className="block text-muted-foreground">{t(`rules.${r}.hint`)}</span>
                    </span>
                  </label>
                ))}
              </RadioGroup>
              <p className="text-xs text-muted-foreground">{t("ruleNow")}</p>
              {error ? (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              ) : null}
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                  {tc("cancel")}
                </Button>
                <Button type="submit" disabled={busy || rule === view.rule}>
                  {busy ? <BrandLoader tone="current" className="size-4" /> : null}
                  {tc("save")}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      ) : null}
    </Card>
  );
}
