"use client";

import { useLocale, useTranslations } from "next-intl";
import { ApiButton } from "@/components/form-dialog";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { HeadSuggestion } from "@/services/org-chart";

/**
 * The department-head suggestion (org chart, part 5), for the people who
 * manage departments (the client's admin, the firm admin): where the person
 * in a linked unit's head position is not that department's head in Selah.
 * Nothing changes on its own; "Make head" asks first, then changes the
 * department as the Departments page would. The structure itself never
 * grants or limits anyone's access.
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
          const values = { name: s.holder.name, position: local(s.positionTitleAr, s.positionTitleEn), department };
          return (
            <div key={`${s.departmentId}-${s.holder.userId}`} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm first:pt-0 last:pb-0">
              <div className="grid gap-1">
                <p>{t("line", values)}</p>
                <p className="text-muted-foreground">
                  {s.heads.length ? t("now", { names: s.heads.map((h) => h.name).join(ar ? "، " : ", ") }) : t("nobody")}
                </p>
              </div>
              <ApiButton
                endpoint={`/api/clients/${clientId}/structure/head-suggestions`}
                body={{ departmentId: s.departmentId, userId: s.holder.userId }}
                label={t("confirm")}
                confirm={t(s.heads.length ? "confirmReplace" : "confirmAsk", { ...values, names: s.heads.map((h) => h.name).join(ar ? "، " : ", ") })}
              />
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
