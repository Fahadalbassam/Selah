import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { Plus } from "@/components/animate-ui/icons/plus";
import { ApiButton } from "@/components/form-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatChange, formatValue, periodLabel } from "@/lib/indicators";
import type { RecommendationIndicators } from "@/services/indicators";
import { LinkDialog } from "./indicator-dialogs";
import { indicatorName, MovementBadge } from "./indicators-card";
import { Sparkline } from "./sparkline";

/**
 * On a recommendation: the client's indicators it is meant to move. The
 * figures are the client's own, so the card says so, and claims no impact.
 */
export async function LinkedIndicatorsCard({ recommendationId, data }: { recommendationId: string; data: RecommendationIndicators }) {
  const [t, locale] = await Promise.all([getTranslations("indicators"), getLocale()]);
  const ar = locale === "ar";
  const lang = ar ? "ar" : "en";
  if (!data.linked.length && !data.canManage) return null;
  return (
    <Card className="gap-4 py-5 shadow-xs">
      <CardHeader className="flex flex-row items-start justify-between gap-4 px-5">
        <div className="space-y-1.5">
          <CardTitle className="text-base">{t("linkedTitle")}</CardTitle>
          <CardDescription>{t("linkedHint")}</CardDescription>
        </div>
        {data.canManage && data.others.length ? (
          <LinkDialog
            options={data.others.map((k) => ({ value: `${k.id}:${recommendationId}`, label: indicatorName(k, ar) }))}
            trigger={
              <Button size="sm" variant="outline">
                <Plus />
                {t("link")}
              </Button>
            }
          />
        ) : null}
      </CardHeader>
      <CardContent className="space-y-3 px-5">
        {data.linked.length === 0 ? (
          <p className="text-sm text-muted-foreground">{data.others.length ? t("noLinkedManage") : t("noIndicatorsYet")}</p>
        ) : (
          <ul className="divide-y">
            {data.linked.map((k) => (
              <li key={k.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-2.5 text-sm">
                <div className="min-w-0 flex-1 space-y-0.5">
                  <Link href={`/indicators/${k.id}`} className="block truncate font-medium hover:underline" dir="auto">
                    {indicatorName(k, ar)}
                  </Link>
                  <p className="text-xs text-muted-foreground tabular-nums" dir="auto">
                    {k.summary.latest
                      ? `${formatValue(k.summary.latest.value, lang)} ${k.unit} · ${periodLabel(k.summary.latest.period, k.frequency, lang)}${
                          k.summary.change !== null ? ` · ${formatChange(k.summary.change, lang)}` : ""
                        }`
                      : t("noValue")}
                  </p>
                </div>
                <Sparkline points={k.summary.points} target={k.target} label={t("trendLabel", { name: indicatorName(k, ar) })} />
                <MovementBadge summary={k.summary} />
                {data.canManage ? (
                  <ApiButton endpoint={`/api/indicators/${k.id}/links/${recommendationId}`} method="DELETE" label={t("unlink")} variant="ghost" confirm={t("unlinkConfirm")} />
                ) : null}
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs leading-relaxed text-muted-foreground">{t("claimNote")}</p>
      </CardContent>
    </Card>
  );
}
