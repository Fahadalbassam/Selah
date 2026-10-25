import { ArrowLeft, Gauge, Trash2 } from "lucide-react";
import { Pencil } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { Plus } from "@/components/animate-ui/icons/plus";
import { ApiButton } from "@/components/form-dialog";
import { IndicatorDialog, LinkDialog, ValueDialog } from "@/components/indicators/indicator-dialogs";
import { indicatorName, MovementBadge } from "@/components/indicators/indicators-card";
import { IndicatorTrend } from "@/components/indicators/indicator-trend";
import { PageHeader } from "@/components/page-header";
import { ToneBadge } from "@/components/tone-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { isUuid } from "@/lib/ids";
import { formatChange, formatValue, periodLabel } from "@/lib/indicators";
import { localName } from "@/lib/names";
import { withPrincipal } from "@/server/page";
import { getIndicator } from "@/services/indicators";

// One business indicator (KPI layer B): its trend, every period's value and
// who gave it, the corrections, and the recommendations meant to move it.
// The client's figures, and the page says so.
export default async function IndicatorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const data = await withPrincipal(async (tx, principal) => ({
    firm: principal.orgKind === "firm",
    detail: await getIndicator(tx, principal, id).catch(() => null),
  }));
  if (!data.detail) notFound();
  const { detail, firm } = data;
  const { indicator: k, series, history, links } = detail;
  const [t, format, locale] = await Promise.all([getTranslations("indicators"), getFormatter(), getLocale()]);
  const ar = locale === "ar";
  const lang = ar ? "ar" : "en";
  const s = k.summary;
  const name = indicatorName(k, ar);
  const other = ar ? k.nameEn : k.nameEn ? k.nameAr : null;
  const scope = k.department ? (ar ? k.department.nameAr : (k.department.nameEn ?? k.department.nameAr)) : t("company");
  const back = firm ? `/clients/${detail.client.id}` : k.department ? `/departments/${k.department.id}` : "/";
  const when = (d: Date) => format.dateTime(d, { dateStyle: "medium", timeStyle: "short" });
  const reported = series.filter((p) => p.status === "reported").reverse();
  const previousOf = (period: string) => {
    const i = reported.findIndex((p) => p.period === period);
    return reported[i + 1]?.value ?? k.baseline;
  };
  const byValue = new Map(history.map((h) => [h.id, h]));
  const replaced = history.filter((h) => !h.current);
  const locked = history.length > 0;

  return (
    <>
      <Link href={back} className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4 rtl:-scale-x-100" />
        {firm ? localName(detail.client, ar) : k.department ? scope : t("backClient")}
      </Link>
      <PageHeader
        title={name}
        description={[other, firm ? localName(detail.client, ar) : null].filter(Boolean).join(" · ") || undefined}
        meta={
          <>
            <Badge variant="outline">{scope}</Badge>
            <Badge variant="outline">{t(`frequencies.${k.frequency}`)}</Badge>
            {!k.active ? <ToneBadge tone="neutral">{t("inactive")}</ToneBadge> : null}
          </>
        }
      >
        {detail.canReport && detail.openPeriods.length ? (
          <ValueDialog
            indicatorId={k.id}
            unit={k.unit}
            frequency={k.frequency}
            periods={detail.openPeriods}
            onBehalf={firm}
            trigger={
              <Button size="sm">
                <Plus />
                {t("enter")}
              </Button>
            }
          />
        ) : null}
        {detail.canManage ? (
          <>
            <IndicatorDialog
              clientOrgId={detail.client.id}
              indicator={k}
              locked={locked}
              departments={detail.departments}
              trigger={
                <Button size="sm" variant="outline">
                  <Pencil />
                  {t("edit")}
                </Button>
              }
            />
            <ApiButton
              endpoint={`/api/indicators/${k.id}`}
              method="PATCH"
              body={{ active: !k.active }}
              label={k.active ? t("switchOff") : t("switchOn")}
              confirm={k.active ? t("switchOffConfirm") : undefined}
            />
            {detail.canDelete ? (
              <ApiButton
                endpoint={`/api/indicators/${k.id}`}
                method="DELETE"
                label={t("delete")}
                icon={<Trash2 className="size-4" />}
                confirm={t("deleteConfirm")}
                redirectTo={back}
              />
            ) : null}
          </>
        ) : null}
      </PageHeader>
      <p className="-mt-3 flex max-w-3xl items-start gap-2 rounded-lg bg-muted px-4 py-2 text-sm text-muted-foreground">
        <Gauge className="mt-0.5 size-4 shrink-0" />
        {t("claimNote")}
      </p>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-6">
          <Card className="gap-4 py-5 shadow-xs">
            <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-4 px-5">
              <div className="space-y-1.5">
                <CardTitle className="text-base">{t("trend")}</CardTitle>
                <CardDescription>{t(`directionHint.${k.direction}`)}</CardDescription>
              </div>
              <MovementBadge summary={s} />
            </CardHeader>
            <CardContent className="space-y-4 px-5">
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
                <div className="space-y-1 rounded-xl border bg-surface px-4 py-3 text-surface-foreground">
                  <p className="text-xs text-muted-foreground">{t("latest")}</p>
                  <p className="text-2xl font-semibold tabular-nums" dir="auto">
                    {s.latest ? formatValue(s.latest.value, lang) : "—"} <span className="text-sm font-normal text-muted-foreground">{k.unit}</span>
                  </p>
                  <p className="text-xs text-muted-foreground">{s.latest ? periodLabel(s.latest.period, k.frequency, lang) : t("noValue")}</p>
                </div>
                <div className="space-y-1 rounded-xl border bg-surface px-4 py-3 text-surface-foreground">
                  <p className="text-xs text-muted-foreground">{t("sinceBaseline")}</p>
                  <p className="text-2xl font-semibold tabular-nums">{s.change === null ? "—" : formatChange(s.change, lang)}</p>
                  <p className="text-xs text-muted-foreground">{t("baselineShort", { value: formatValue(k.baseline, lang), unit: k.unit })}</p>
                </div>
                <div className="space-y-1 rounded-xl border bg-surface px-4 py-3 text-surface-foreground">
                  <p className="text-xs text-muted-foreground">{t("towardTarget")}</p>
                  <p className="text-2xl font-semibold tabular-nums">{s.towardTarget === null ? "—" : `${formatValue(s.towardTarget, lang)}%`}</p>
                  <p className="text-xs text-muted-foreground">
                    {k.target === null ? t("noTarget") : t("targetBy", { value: formatValue(k.target, lang), unit: k.unit, date: format.dateTime(new Date(k.targetDate!), { dateStyle: "medium" }) })}
                  </p>
                </div>
              </div>
              <IndicatorTrend
                baseline={k.baseline}
                baselinePeriod={k.baselinePeriod}
                target={k.target}
                unit={k.unit}
                frequency={k.frequency}
                points={series.map((p) => ({ period: p.period, value: p.value }))}
              />
            </CardContent>
          </Card>

          <Card className="gap-4 py-5 shadow-xs">
            <CardHeader className="px-5">
              <CardTitle className="text-base">{t("values")}</CardTitle>
              <CardDescription>{t("valuesHint")}</CardDescription>
            </CardHeader>
            <CardContent className="px-5">
              {series.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("noPeriods")}</p>
              ) : (
                <div className="overflow-hidden rounded-xl border">
                  <Table>
                    <TableHeader className="bg-muted/50">
                      <TableRow>
                        <TableHead>{t("fields.period")}</TableHead>
                        <TableHead>{t("valueCol")}</TableHead>
                        <TableHead className="whitespace-normal">{t("changeCol")}</TableHead>
                        <TableHead>{t("byCol")}</TableHead>
                        <TableHead className="w-0" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {[...series].reverse().map((p) => {
                        const v = p.valueId ? byValue.get(p.valueId) : undefined;
                        return (
                          <TableRow key={p.period} className="align-top">
                            <TableCell className="whitespace-nowrap">{periodLabel(p.period, k.frequency, lang)}</TableCell>
                            <TableCell className="tabular-nums">
                              {p.value === null ? (
                                <ToneBadge tone={p.status === "missing" ? "waiting" : "neutral"}>{t(`status.${p.status}`)}</ToneBadge>
                              ) : (
                                <span dir="auto">
                                  {formatValue(p.value, lang)} <span className="text-xs text-muted-foreground">{k.unit}</span>
                                </span>
                              )}
                              {v?.note ? (
                                <p className="mt-1 max-w-64 text-xs whitespace-pre-wrap text-muted-foreground" dir="auto">
                                  {v.note}
                                </p>
                              ) : null}
                            </TableCell>
                            <TableCell className="tabular-nums text-muted-foreground">
                              {p.value === null ? "—" : formatChange(p.value - previousOf(p.period), lang)}
                            </TableCell>
                            <TableCell className="text-xs">
                              {v ? (
                                <div className="space-y-1">
                                  <p>{v.enteredBy ?? "—"}</p>
                                  <p className="text-muted-foreground tabular-nums">{when(v.enteredAt)}</p>
                                  <div className="flex flex-wrap gap-1">
                                    {v.onBehalf ? <Badge variant="outline">{t("onBehalf")}</Badge> : null}
                                    {p.corrected ? <Badge variant="outline">{t("correctedBadge")}</Badge> : null}
                                    {v.checkedAt ? (
                                      <ToneBadge tone="neutral" className="whitespace-normal">
                                        {t("checkedBy", { name: v.checkedBy ?? "—" })}
                                      </ToneBadge>
                                    ) : null}
                                  </div>
                                </div>
                              ) : (
                                "—"
                              )}
                            </TableCell>
                            <TableCell>
                              <div className="flex flex-col items-end gap-1">
                                {v && detail.canReport ? (
                                  <ValueDialog
                                    indicatorId={k.id}
                                    unit={k.unit}
                                    frequency={k.frequency}
                                    periods={[]}
                                    correct={{ period: p.period, valueId: v.id, value: v.value }}
                                    onBehalf={firm}
                                    trigger={
                                      <Button size="sm" variant="ghost">
                                        {t("correct")}
                                      </Button>
                                    }
                                  />
                                ) : null}
                                {v && detail.canCheck && !v.checkedAt && v.enteredById !== detail.viewerId ? (
                                  <ApiButton endpoint={`/api/indicator-values/${v.id}/check`} label={t("check")} variant="ghost" title={t("checkHint")} />
                                ) : null}
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
              {replaced.length ? (
                <details className="mt-4 text-sm">
                  <summary className="cursor-pointer text-muted-foreground">{t("replaced", { n: replaced.length })}</summary>
                  <ul className="mt-2 space-y-2">
                    {replaced.map((h) => (
                      <li key={h.id} className="rounded-lg border px-3 py-2 text-xs">
                        <span className="font-medium">{periodLabel(h.period, k.frequency, lang)}</span>
                        {" · "}
                        <span className="tabular-nums line-through">
                          {formatValue(h.value, lang)} {k.unit}
                        </span>
                        {" · "}
                        <span className="text-muted-foreground">
                          {h.enteredBy ?? "—"}, {when(h.enteredAt)}
                        </span>
                        {h.note ? (
                          <p className="mt-1 text-muted-foreground" dir="auto">
                            {h.note}
                          </p>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card className="h-fit gap-0 py-0 shadow-xs">
            <dl className="divide-y text-sm">
              {[
                ...(k.definition ? [[t("fields.definition"), <span key="d" dir="auto" className="whitespace-pre-wrap">{k.definition}</span>] as const] : []),
                [t("fields.unit"), <span key="u" dir="auto">{k.unit}</span>],
                [t("fields.direction"), t(`directions.${k.direction}`)],
                [
                  t("fields.baseline"),
                  <span key="b" className="tabular-nums">
                    {formatValue(k.baseline, lang)} {k.unit} · {periodLabel(k.baselinePeriod, "monthly", lang)}
                  </span>,
                ],
                [
                  t("fields.target"),
                  k.target === null ? (
                    t("noTarget")
                  ) : (
                    <span key="t" className="tabular-nums">
                      {formatValue(k.target, lang)} {k.unit} · {format.dateTime(new Date(k.targetDate!), { dateStyle: "medium" })}
                    </span>
                  ),
                ],
                ...(k.source ? [[t("fields.source"), <span key="s" dir="auto">{k.source}</span>] as const] : []),
              ].map(([label, value], i) => (
                <div key={i} className="space-y-1 px-5 py-3">
                  <dt className="text-xs text-muted-foreground">{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
          </Card>

          <Card className="gap-3 py-5 shadow-xs">
            <CardHeader className="flex flex-row items-start justify-between gap-3 px-5">
              <div className="space-y-1.5">
                <CardTitle className="text-base">{t("linksTitle")}</CardTitle>
                <CardDescription>{t("linksHint")}</CardDescription>
              </div>
              {detail.canManage && detail.linkable.length ? (
                <LinkDialog
                  options={detail.linkable.map((r) => ({ value: `${k.id}:${r.id}`, label: r.title, group: r.projectTitle }))}
                  trigger={
                    <Button size="sm" variant="outline">
                      <Plus />
                      {t("link")}
                    </Button>
                  }
                />
              ) : null}
            </CardHeader>
            <CardContent className="px-5">
              {links.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("noLinks")}</p>
              ) : (
                <ul className="divide-y">
                  {links.map((l) => (
                    <li key={l.id} className="space-y-1 py-2.5 text-sm">
                      <div className="flex items-start gap-2">
                        <Link href={`/recommendations/${l.id}`} className="min-w-0 flex-1 font-medium hover:underline" dir="auto">
                          {l.title}
                        </Link>
                        {detail.canManage ? (
                          <ApiButton endpoint={`/api/indicators/${k.id}/links/${l.id}`} method="DELETE" label={t("unlink")} variant="ghost" confirm={t("unlinkConfirm")} />
                        ) : null}
                      </div>
                      <p className="text-xs text-muted-foreground" dir="auto">
                        {l.projectTitle} · {l.withdrawn ? t("withdrawn") : t("verifiedOf", { verified: l.verified, applies: l.applies })}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
