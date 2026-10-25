import { ArrowDownRight, ArrowRight, ArrowUpRight, Gauge } from "lucide-react";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { Plus } from "@/components/animate-ui/icons/plus";
import { ToneBadge } from "@/components/tone-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatChange, formatValue, periodLabel, type IndicatorSummary } from "@/lib/indicators";
import type { Indicator, IndicatorList } from "@/services/indicators";
import { IndicatorDialog } from "./indicator-dialogs";
import { Sparkline } from "./sparkline";

export function indicatorName(k: { nameAr: string | null; nameEn: string | null }, ar: boolean): string {
  return (ar ? (k.nameAr ?? k.nameEn) : (k.nameEn ?? k.nameAr)) ?? "";
}

/** Which way it moved since the baseline, in words: colour only for the way that needs attention. */
export async function MovementBadge({ summary }: { summary: IndicatorSummary }) {
  const t = await getTranslations("indicators");
  if (!summary.movement) return <ToneBadge tone="neutral">{t("movement.none")}</ToneBadge>;
  const Icon = summary.movement === "better" ? ArrowUpRight : summary.movement === "worse" ? ArrowDownRight : ArrowRight;
  return (
    <ToneBadge tone={summary.movement === "worse" ? "problem" : summary.movement === "better" ? "active" : "neutral"} className="gap-1">
      <Icon className="size-3 rtl:-scale-x-100" />
      {t(`movement.${summary.movement}`)}
    </ToneBadge>
  );
}

/** One indicator as a row: name, latest value, the move since the baseline, its trend. */
export async function IndicatorRow({ k, showDepartment = true }: { k: Indicator; showDepartment?: boolean }) {
  const [t, locale] = await Promise.all([getTranslations("indicators"), getLocale()]);
  const ar = locale === "ar";
  const lang = ar ? "ar" : "en";
  const s = k.summary;
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
      <div className="min-w-0 flex-1 space-y-1">
        <Link href={`/indicators/${k.id}`} className="block truncate text-sm font-medium hover:underline" dir="auto">
          {indicatorName(k, ar)}
        </Link>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          {showDepartment ? (
            <span>{k.department ? (ar ? k.department.nameAr : (k.department.nameEn ?? k.department.nameAr)) : t("company")}</span>
          ) : null}
          <span className="tabular-nums">
            {t("baselineShort", { value: formatValue(k.baseline, lang), unit: k.unit })}
            {k.target !== null ? ` · ${t("targetShort", { value: formatValue(k.target, lang), unit: k.unit })}` : ""}
          </span>
          {!k.active ? <Badge variant="outline">{t("inactive")}</Badge> : null}
          {s.missing > 0 && k.active ? <ToneBadge tone="waiting">{t("missingCount", { n: s.missing })}</ToneBadge> : null}
        </div>
      </div>
      <Sparkline points={s.points} target={k.target} label={t("trendLabel", { name: indicatorName(k, ar) })} />
      <div className="w-32 text-end">
        {s.latest ? (
          <>
            <p className="text-sm font-semibold tabular-nums" dir="auto">
              {formatValue(s.latest.value, lang)} <span className="text-xs font-normal text-muted-foreground">{k.unit}</span>
            </p>
            <p className="text-xs text-muted-foreground tabular-nums">
              {periodLabel(s.latest.period, k.frequency, lang)}
              {s.change !== null ? ` · ${formatChange(s.change, lang)}` : ""}
            </p>
          </>
        ) : (
          <p className="text-xs text-muted-foreground">{t("noValue")}</p>
        )}
      </div>
      <div className="w-36">
        <MovementBadge summary={s} />
      </div>
    </li>
  );
}

/**
 * The client's business indicators beside its implementation progress:
 * pooled counts (never an average of percentages), then each indicator with
 * its latest value and trend. Every view says whose numbers they are.
 */
export async function IndicatorsCard({
  data,
  scope = "client",
  departmentId = null,
}: {
  data: IndicatorList;
  /** A department's page shows only its own, and adds new ones to it. */
  scope?: "client" | "department";
  departmentId?: string | null;
}) {
  const t = await getTranslations("indicators");
  const { counts } = data;
  const active = data.indicators.filter((k) => k.active);
  const inactive = data.indicators.filter((k) => !k.active);
  return (
    <Card className="gap-4 py-5 shadow-xs">
      <CardHeader className="flex flex-row items-start justify-between gap-4 px-5">
        <div className="space-y-1.5">
          <CardTitle className="flex items-center gap-2 text-base">
            <Gauge className="size-4 text-muted-foreground" />
            {scope === "client" ? t("title") : t("departmentTitle")}
          </CardTitle>
          <CardDescription>{t("hint")}</CardDescription>
        </div>
        {data.canManage ? (
          <IndicatorDialog
            clientOrgId={data.client.id}
            departments={data.departments}
            defaultDepartmentId={departmentId}
            trigger={
              <Button size="sm" variant={active.length ? "outline" : "default"}>
                <Plus />
                {t("new")}
              </Button>
            }
          />
        ) : null}
      </CardHeader>
      <CardContent className="space-y-4 px-5">
        {active.length ? (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {(
              [
                ["total", counts.total],
                ["upToDate", counts.upToDate],
                ["better", counts.better],
                ["worse", counts.worse],
              ] as const
            ).map(([k, n]) => (
              <div key={k} className="space-y-1 rounded-xl border bg-surface px-4 py-3 text-surface-foreground">
                <p className="text-xs text-muted-foreground">{t(`counts.${k}`)}</p>
                <p className="text-2xl font-semibold tabular-nums">{n}</p>
              </div>
            ))}
          </div>
        ) : null}
        {active.length === 0 ? (
          <p className="text-sm text-muted-foreground">{data.canManage ? t("emptyManage") : t("empty")}</p>
        ) : (
          <ul className="divide-y">
            {active.map((k) => (
              <IndicatorRow key={k.id} k={k} showDepartment={scope === "client"} />
            ))}
          </ul>
        )}
        {inactive.length ? (
          <details className="text-sm">
            <summary className="cursor-pointer text-muted-foreground">{t("inactiveList", { n: inactive.length })}</summary>
            <ul className="divide-y">
              {inactive.map((k) => (
                <IndicatorRow key={k.id} k={k} showDepartment={scope === "client"} />
              ))}
            </ul>
          </details>
        ) : null}
        <p className="text-xs leading-relaxed text-muted-foreground">{t("claimNote")}</p>
      </CardContent>
    </Card>
  );
}
