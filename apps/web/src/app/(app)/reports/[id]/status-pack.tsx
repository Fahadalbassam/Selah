"use client";

import Link from "next/link";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { Sparkline } from "@/components/indicators/sparkline";
import { formatChange, formatValue, periodLabel } from "@/lib/indicators";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { StatusPack } from "@/services/status-pack";

const MOVED_ORDER = ["in_progress", "blocked", "awaiting_review", "revision_requested", "verified_complete", "closed"];

/**
 * The lists of a monthly status pack (F19): what needs a decision, what is
 * overdue and with whom, what moved twice or more, what risk was accepted
 * and by whom, and what was verified in the period.
 */
export function StatusPackLists({ pack, links }: { pack: StatusPack; links: boolean }) {
  const t = useTranslations("statusPack");
  const tStatus = useTranslations("status");
  const format = useFormatter();
  const day = (d: string) => format.dateTime(new Date(`${d.slice(0, 10)}T00:00:00`), { dateStyle: "medium" });
  const title = (kind: "action" | "recommendation", id: string, text: string) =>
    links ? (
      <Link href={`/${kind === "action" ? "actions" : "recommendations"}/${id}`} className="font-medium hover:underline" dir="auto">
        {text}
      </Link>
    ) : (
      <span className="font-medium" dir="auto">
        {text}
      </span>
    );
  const moved = MOVED_ORDER.filter((s) => pack.moved[s]);
  const tK = useTranslations("indicators");
  const locale = useLocale() as "ar" | "en";
  const ar = locale === "ar";
  const indicators = pack.indicators ?? [];

  const section = (key: string, count: number, head: string[], rows: React.ReactNode) => (
    <Card className="gap-3 py-5 shadow-xs">
      <CardHeader className="px-5">
        <CardTitle className="text-base">
          {t(`${key}.title`)} <span className="text-muted-foreground tabular-nums">{count}</span>
        </CardTitle>
        <CardDescription>{t(`${key}.hint`)}</CardDescription>
      </CardHeader>
      {count ? (
        <CardContent className="px-5">
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader className="bg-muted/50">
                <TableRow>
                  {head.map((h, i) => (
                    <TableHead key={h} className={i > 1 ? "text-end" : undefined}>
                      {h}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>{rows}</TableBody>
            </Table>
          </div>
        </CardContent>
      ) : null}
    </Card>
  );

  return (
    <div className="space-y-4">
      {section(
        "decisions",
        pack.decisions.length,
        [t("item"), t("decisions.what"), t("since")],
        pack.decisions.map((d) => (
          <TableRow key={`${d.kind}-${d.id}`}>
            <TableCell className="max-w-96">{title(d.kind === "response" ? "recommendation" : "action", d.id, d.title)}</TableCell>
            <TableCell>{d.kind === "response" ? t("decisions.response") : t("decisions.deadline", { date: day(d.proposedDueDate!) })}</TableCell>
            <TableCell className="text-end tabular-nums">{day(d.since)}</TableCell>
          </TableRow>
        )),
      )}
      {section(
        "overdue",
        pack.overdue.length,
        [t("item"), t("owner"), t("due"), t("late")],
        pack.overdue.map((o) => (
          <TableRow key={o.id}>
            <TableCell className="max-w-96">{title("action", o.id, o.title)}</TableCell>
            <TableCell className="text-muted-foreground">{o.owner ?? "—"}</TableCell>
            <TableCell className="text-end tabular-nums">{day(o.dueDate)}</TableCell>
            <TableCell className="text-end tabular-nums text-destructive">{t("days", { n: o.days })}</TableCell>
          </TableRow>
        )),
      )}
      {section(
        "slipped",
        pack.slipped.length,
        [t("item"), t("owner"), t("original"), t("moves")],
        pack.slipped.map((o) => (
          <TableRow key={o.id}>
            <TableCell className="max-w-96">{title("action", o.id, o.title)}</TableCell>
            <TableCell className="text-muted-foreground">{o.owner ?? "—"}</TableCell>
            <TableCell className="text-end tabular-nums">{o.baselineDueDate ? day(o.baselineDueDate) : "—"}</TableCell>
            <TableCell className="text-end tabular-nums">{o.moves}</TableCell>
          </TableRow>
        )),
      )}
      {section(
        "riskAccepted",
        pack.riskAccepted.length,
        [t("item"), t("acceptedBy"), t("on")],
        pack.riskAccepted.map((r) => (
          <TableRow key={r.id}>
            <TableCell className="max-w-96">{title("action", r.id, r.title)}</TableCell>
            <TableCell className="text-muted-foreground">{r.acceptedBy ?? "—"}</TableCell>
            <TableCell className="text-end tabular-nums">{day(r.on)}</TableCell>
          </TableRow>
        )),
      )}
      {section(
        "verified",
        pack.verified.length,
        [t("item"), t("owner"), t("on")],
        pack.verified.map((v) => (
          <TableRow key={v.id}>
            <TableCell className="max-w-96">{title("action", v.id, v.title)}</TableCell>
            <TableCell className="text-muted-foreground">{v.owner ?? "—"}</TableCell>
            <TableCell className="text-end tabular-nums">{day(v.on)}</TableCell>
          </TableRow>
        )),
      )}
      <Card className="gap-3 py-5 shadow-xs">
        <CardHeader className="px-5">
          <CardTitle className="text-base">{t("moved.title")}</CardTitle>
          <CardDescription>{moved.length ? t("moved.hint") : t("moved.none")}</CardDescription>
        </CardHeader>
        {moved.length ? (
          <CardContent className="flex flex-wrap gap-x-6 gap-y-2 px-5 text-sm">
            {moved.map((s) => (
              <span key={s}>
                {tStatus(s as never)} <span className="font-semibold tabular-nums">{pack.moved[s]}</span>
              </span>
            ))}
          </CardContent>
        ) : null}
      </Card>
      {indicators.length ? (
        <Card className="gap-3 py-5 shadow-xs">
          <CardHeader className="px-5">
            <CardTitle className="text-base">{tK("report.title")}</CardTitle>
            <CardDescription>{tK("report.hint")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 px-5">
            <div className="overflow-hidden rounded-xl border">
              <Table>
                <TableHeader className="bg-muted/50">
                  <TableRow>
                    <TableHead>{tK("report.indicator")}</TableHead>
                    <TableHead>{tK("report.latest")}</TableHead>
                    <TableHead>{tK("report.change")}</TableHead>
                    <TableHead className="w-0" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {indicators.map((k) => {
                    const name = (ar ? (k.nameAr ?? k.nameEn) : (k.nameEn ?? k.nameAr)) ?? "";
                    const scope = k.departmentId ? ((ar ? k.departmentAr : (k.departmentEn ?? k.departmentAr)) ?? "") : tK("report.company");
                    return (
                      <TableRow key={k.id} className="align-top">
                        <TableCell className="max-w-80 whitespace-normal">
                          {links ? (
                            <Link href={`/indicators/${k.id}`} className="font-medium hover:underline" dir="auto">
                              {name}
                            </Link>
                          ) : (
                            <span className="font-medium" dir="auto">
                              {name}
                            </span>
                          )}
                          <p className="text-xs text-muted-foreground" dir="auto">
                            {[scope, ...k.recommendations].join(" · ")}
                          </p>
                        </TableCell>
                        <TableCell className="tabular-nums">
                          {k.latest ? (
                            <>
                              {formatValue(k.latest.value, locale)} <span className="text-xs text-muted-foreground">{k.unit}</span>
                              <p className="text-xs text-muted-foreground">{periodLabel(k.latest.period, k.frequency, locale)}</p>
                            </>
                          ) : (
                            <span className="text-muted-foreground">{tK("report.noValue")}</span>
                          )}
                        </TableCell>
                        <TableCell className="tabular-nums text-muted-foreground">
                          {k.latest ? `${formatChange(k.latest.value - k.baseline, locale)} · ${tK(`report.movement.${k.movement ?? "same"}`)}` : "—"}
                        </TableCell>
                        <TableCell>
                          <Sparkline points={k.points} target={k.target} label={tK("trendLabel", { name })} />
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">{tK("claimNote")}</p>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
