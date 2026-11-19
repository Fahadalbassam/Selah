"use client";

import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { BrandLoader } from "@/components/brand";
import { useConfirm } from "@/components/confirm-dialog";
import { callApi } from "@/components/form-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { HeadSuggestion } from "@/services/org-chart";
import { useOrgChartError } from "./holders-panel";

/**
 * The department-head suggestion (org chart, part 5), for the people who
 * manage departments (the client's admin, the firm admin): where the one
 * person in a linked unit's head position is not that department's head in
 * Selah. Nothing changes on its own; "Make department head" asks first,
 * then changes the department as the Departments page would. A refusal (the
 * person left, the structure changed) is said in plain words. The structure
 * itself never grants or limits anyone's access.
 */
export function HeadSuggestions({ clientId, items }: { clientId: string; items: HeadSuggestion[] }) {
  const t = useTranslations("orgChart.headSuggestion");
  const ar = useLocale() === "ar";
  const local = (a: string | null, e: string | null) => (ar ? (a ?? e) : (e ?? a)) ?? "—";
  if (!items.length) return null;
  return (
    <Card className="gap-4 py-5 shadow-xs">
      <CardHeader className="px-5">
        <CardTitle className="text-base">{t("title")}</CardTitle>
        <CardDescription>{t("hint")}</CardDescription>
      </CardHeader>
      <CardContent className="grid divide-y px-5">
        {items.map((s) => {
          const department = local(s.departmentNameAr, s.departmentNameEn);
          const names = s.heads.map((h) => h.name).join(ar ? "، " : ", ");
          const values = { name: s.holder.name, position: local(s.positionTitleAr, s.positionTitleEn), department };
          return (
            <div key={`${s.departmentId}-${s.holder.userId}`} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm first:pt-0 last:pb-0">
              <div className="grid gap-1">
                <p>{t("line", values)}</p>
                <p className="text-muted-foreground">{s.heads.length ? t("now", { names }) : t("nobody")}</p>
              </div>
              <ConfirmHead
                clientId={clientId}
                departmentId={s.departmentId}
                userId={s.holder.userId}
                label={t("confirm")}
                question={t(s.heads.length ? "confirmReplace" : "confirmAsk", { ...values, names })}
              />
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

function ConfirmHead(props: { clientId: string; departmentId: string; userId: string; label: string; question: string }) {
  const router = useRouter();
  const say = useOrgChartError();
  const [confirm, confirmDialog] = useConfirm();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run() {
    if (!(await confirm(props.question))) return;
    setBusy(true);
    setError(null);
    const r = await callApi(`/api/clients/${props.clientId}/structure/head-suggestions`, "POST", { departmentId: props.departmentId, userId: props.userId });
    setBusy(false);
    if (!r.ok) return setError(say(r));
    router.refresh();
  }
  return (
    <span className="inline-flex max-w-sm flex-col items-end gap-1">
      <Button type="button" variant="outline" size="sm" onClick={() => void run()} disabled={busy}>
        {busy ? <BrandLoader tone="current" className="size-4" /> : null}
        {props.label}
      </Button>
      {error ? (
        <span role="alert" className="text-xs text-destructive">
          {error}
        </span>
      ) : null}
      {confirmDialog}
    </span>
  );
}
