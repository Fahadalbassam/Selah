"use client";

import { useFormatter, useTranslations } from "next-intl";
import { FormDialog } from "@/components/form-dialog";
import { RowMenu, useRowCall } from "@/components/row-menu";
import { ToneBadge } from "@/components/tone-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ORG_CHART_LIMITS, orgChartError } from "@/lib/org-chart";

export interface StructureRequest {
  id: string;
  what: string;
  where: string | null;
  why: string | null;
  status: "open" | "done" | "declined";
  createdAt: string;
  byName: string | null;
  closedAt: string | null;
  closedByName: string | null;
}

/**
 * Suggested changes to the structure (org chart, part 5), on the Structure
 * tab. The client's admin suggests one ("Suggest a change": what, where,
 * why) and reads what became of each; the firm reads them, and its editors
 * mark each one done (made in the draft) or declined, once, from the row's
 * menu. The person who suggested it is told. Nothing here changes the
 * structure: the firm makes the change in the draft and publishes it.
 */
export function StructureRequests(props: { clientId: string; side: "firm" | "client"; items: StructureRequest[]; canClose: boolean; canSuggest: boolean }) {
  const t = useTranslations("orgChart.requests");
  const tErr = useTranslations("orgChart.errors");
  const format = useFormatter();
  const run = useRowCall();
  const L = ORG_CHART_LIMITS.request;
  const day = (iso: string) => format.dateTime(new Date(iso), { dateStyle: "medium" });
  if (!props.items.length && !props.canSuggest) return null;
  const explain = (m: string | undefined) => {
    const key = orgChartError(m);
    return key ? tErr(key as "name") : null;
  };
  return (
    <Card id="suggestions" className="scroll-mt-20 gap-4 py-5 shadow-xs">
      <CardHeader className="flex flex-wrap items-start justify-between gap-3 px-5">
        <div className="grid gap-1.5">
          <CardTitle className="text-base">{props.side === "client" ? t("titleClient") : t("title")}</CardTitle>
          <CardDescription>{props.side === "client" ? t("hintClient") : t("hint")}</CardDescription>
        </div>
        {props.canSuggest ? (
          <FormDialog
            trigger={
              <Button type="button" variant="outline" size="sm">
                {t("suggest")}
              </Button>
            }
            title={t("suggestTitle")}
            description={t("suggestHint")}
            endpoint={`/api/clients/${props.clientId}/structure/requests`}
            fields={[
              { name: "what", label: t("what"), type: "textarea", required: true, maxLength: L.what.max, placeholder: t("whatPlaceholder") },
              { name: "where", label: t("where"), maxLength: L.where, placeholder: t("wherePlaceholder") },
              { name: "why", label: t("why"), type: "textarea", maxLength: L.why },
            ]}
            submitLabel={t("send")}
            explain={explain}
          />
        ) : null}
      </CardHeader>
      <CardContent className="px-5">
        {props.items.length ? (
          <ul className="grid divide-y">
            {props.items.map((r) => (
              <li key={r.id} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
                <div className="grid min-w-0 flex-1 gap-1 text-sm">
                  <p className="font-medium whitespace-pre-line" dir="auto">
                    {r.what}
                  </p>
                  {r.where ? (
                    <p className="text-muted-foreground">
                      {t("whereLine")} <bdi>{r.where}</bdi>
                    </p>
                  ) : null}
                  {r.why ? (
                    <p className="whitespace-pre-line text-muted-foreground" dir="auto">
                      {r.why}
                    </p>
                  ) : null}
                  <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <ToneBadge tone={r.status === "open" ? "waiting" : "neutral"}>{t(`status.${r.status}`)}</ToneBadge>
                    <span>{t("by", { name: r.byName ?? "—", date: day(r.createdAt) })}</span>
                    {r.closedAt ? <span>{t("answered", { name: r.closedByName ?? "—", date: day(r.closedAt) })}</span> : null}
                  </p>
                </div>
                {r.status === "open" ? (
                  <RowMenu
                    label={t("menu")}
                    items={[
                      {
                        key: "done",
                        label: t("markDone"),
                        allowed: props.canClose,
                        confirm: t("markDoneConfirm"),
                        onSelect: () => void run({ endpoint: `/api/org-chart/requests/${r.id}`, body: { status: "done" }, done: t("marked") }),
                      },
                      {
                        key: "declined",
                        label: t("decline"),
                        allowed: props.canClose,
                        destructive: true,
                        confirm: t("declineConfirm"),
                        onSelect: () => void run({ endpoint: `/api/org-chart/requests/${r.id}`, body: { status: "declined" }, done: t("marked") }),
                      },
                    ]}
                  />
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">{t("none")}</p>
        )}
      </CardContent>
    </Card>
  );
}
