"use client";

import { Gauge } from "lucide-react";
import { Bell } from "@/components/animate-ui/icons/bell";
import { CircleCheck } from "@/components/animate-ui/icons/circle-check";
import { FolderOpen } from "@/components/animate-ui/icons/folder-open";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "@/components/ui/toast";
import { BrandLoader } from "@/components/brand";
import { EmptyState } from "@/components/empty-state";
import { callApi } from "@/components/form-dialog";
import { StatTile } from "@/components/stat-tile";
import { ToneBadge, type Tone } from "@/components/tone-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { HEALTH_LATE_DAYS, REVIEW_WAIT_DAYS, type HealthSignal } from "@/lib/health";
import { cn } from "@/lib/utils";
import type { ExceptionRow, PortfolioRow } from "@/services/oversight";

const SIGNAL_TONE: Record<HealthSignal, Tone> = { off_track: "problem", watch: "waiting", on_track: "neutral", no_data: "open" };
const RULES = ["overdue", "review_waiting", "blocked", "orphaned", "disputed", "slipped", "churn", "stale", "kpi_off_target", "kpi_not_reported"] as const;

/** Maps the database's words to a message key under oversight.remind.errors. */
function remindError(message: string | undefined) {
  const m = message ?? "";
  if (m.includes("already reminded")) return "already";
  if (m.includes("no other active owner")) return "noOwner";
  if (m.includes("open action")) return "settled";
  return "cannot";
}

export function OversightSummary({ projects, exceptions }: { projects: PortfolioRow[]; exceptions: ExceptionRow[] }) {
  const t = useTranslations("oversight");
  const count = (s: HealthSignal) => projects.filter((p) => p.signal === s).length;
  const overdue = projects.reduce((n, p) => n + p.overdue, 0);
  const waiting = exceptions.filter((e) => e.rule === "review_waiting").length;
  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      <StatTile label={t("signals.off_track")} value={count("off_track")} hint={t("summary.projects", { n: projects.length })} className={count("off_track") ? "text-destructive" : undefined} />
      <StatTile label={t("signals.watch")} value={count("watch")} hint={t("summary.projects", { n: projects.length })} />
      <StatTile label={t("summary.overdue")} value={overdue} hint={t("summary.overdueHint")} />
      <StatTile label={t("summary.reviews")} value={waiting} hint={t("summary.reviewsHint", { days: REVIEW_WAIT_DAYS })} />
    </div>
  );
}

const WEEK_FILL: Record<HealthSignal, string> = {
  off_track: "bg-destructive/70",
  watch: "bg-warning/70",
  on_track: "bg-muted-foreground/35",
  no_data: "border border-border",
};

/** The signal of the last few weeks, oldest first: a mark per week, with its word for screen readers and on hover. */
function WeekStrip({ weeks }: { weeks: PortfolioRow["weeks"] }) {
  const t = useTranslations("oversight");
  const format = useFormatter();
  if (weeks.length < 2) return null;
  return (
    <span className="mt-1.5 flex items-center gap-1" aria-label={t("health.weeks", { n: weeks.length })}>
      {weeks.map((w) => {
        const label = t("health.week", { date: format.dateTime(new Date(`${w.weekStart}T00:00:00`), { dateStyle: "medium" }), signal: t(`signals.${w.signal}`) });
        return (
          <span key={w.weekStart} title={label} className={cn("size-2.5 rounded-sm", WEEK_FILL[w.signal])}>
            <span className="sr-only">{label}</span>
          </span>
        );
      })}
    </span>
  );
}

/** One row per open project, most at risk first, with why it has its signal. */
export function HealthTable({ rows }: { rows: PortfolioRow[] }) {
  const t = useTranslations("oversight");
  const ar = useLocale() === "ar";
  const format = useFormatter();
  const reasons = (r: PortfolioRow) =>
    [
      r.overdue ? t("reasons.overdue", { n: r.overdue, open: r.open }) : null,
      r.lateLong ? t("reasons.lateLong", { n: r.lateLong, days: HEALTH_LATE_DAYS }) : null,
      r.blocked ? t("reasons.blocked", { n: r.blocked }) : null,
      r.extendedTwice ? t("reasons.extendedTwice", { n: r.extendedTwice }) : null,
      r.reviewWaiting ? t("reasons.reviewWaiting", { n: r.reviewWaiting }) : null,
      r.orphaned ? t("reasons.orphaned", { n: r.orphaned }) : null,
      r.stale ? t("reasons.stale", { n: r.stale }) : null,
      r.disputed ? t("reasons.disputed", { n: r.disputed }) : null,
    ].filter(Boolean) as string[];
  const lastActive = (r: PortfolioRow) => {
    if (r.kind === "internal") return "—";
    if (r.mode === "consultant_managed") return t("health.recordedByFirm");
    return r.clientLastActive ? format.relativeTime(new Date(r.clientLastActive), new Date()) : t("health.never");
  };
  return (
    <Card className="gap-4 py-5 shadow-xs">
      <CardHeader className="px-5">
        <CardTitle className="text-base">{t("health.title")}</CardTitle>
        <CardDescription>{t("health.hint", { days: HEALTH_LATE_DAYS })}</CardDescription>
      </CardHeader>
      <CardContent className="px-5">
        {rows.length === 0 ? (
          <EmptyState icon={<FolderOpen animateOnView />} description={t("health.none")} />
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader className="bg-muted/50">
                <TableRow>
                  <TableHead>{t("health.project")}</TableHead>
                  <TableHead>{t("health.signal")}</TableHead>
                  <TableHead className="text-end">{t("health.open")}</TableHead>
                  <TableHead className="text-end">{t("health.overdue")}</TableHead>
                  <TableHead className="text-end">{t("health.blocked")}</TableHead>
                  <TableHead className="text-end">{t("health.oldestReview")}</TableHead>
                  <TableHead>{t("health.lead")}</TableHead>
                  <TableHead>{t("health.clientActive")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => {
                  const why = reasons(r);
                  return (
                    <TableRow key={r.projectId}>
                      <TableCell className="max-w-72">
                        <Link href={`/projects/${r.projectId}?tab=attention`} className="block truncate font-medium hover:underline" dir="auto">
                          {r.title}
                        </Link>
                        <span className="block truncate text-xs text-muted-foreground" dir="auto">
                          {r.kind === "internal" ? t("health.internal") : ((ar ? r.clientNameAr : null) ?? r.clientName)}
                        </span>
                      </TableCell>
                      <TableCell className="max-w-64">
                        <ToneBadge tone={SIGNAL_TONE[r.signal]}>{t(`signals.${r.signal}`)}</ToneBadge>
                        {why.length ? <span className="mt-1 block text-xs text-muted-foreground">{why.join(" · ")}</span> : null}
                        <WeekStrip weeks={r.weeks} />
                      </TableCell>
                      <TableCell className="text-end tabular-nums">{r.open}</TableCell>
                      <TableCell className={cn("text-end tabular-nums", r.overdue && "text-destructive")}>{r.overdue}</TableCell>
                      <TableCell className="text-end tabular-nums">{r.blocked}</TableCell>
                      <TableCell className="text-end tabular-nums">
                        {r.oldestReviewDays === null ? "—" : r.oldestReviewDays === 0 ? t("health.today") : t("health.days", { n: r.oldestReviewDays })}
                      </TableCell>
                      <TableCell className="text-muted-foreground">{r.lead ?? "—"}</TableCell>
                      <TableCell className="text-muted-foreground">{lastActive(r)}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** What breaks a rule across every open project, with a one-click reminder to the owner. */
export function ExceptionsTable({ rows }: { rows: ExceptionRow[] }) {
  const t = useTranslations("oversight");
  const td = useTranslations("insight.deviations");
  const ar = useLocale() === "ar";
  const format = useFormatter();
  const router = useRouter();
  const [rule, setRule] = useState<string>("all");
  const [busy, setBusy] = useState<string | null>(null);
  const counts = rows.reduce<Record<string, number>>((m, r) => ((m[r.rule] = (m[r.rule] ?? 0) + 1), m), {});
  const shown = rule === "all" ? rows : rows.filter((r) => r.rule === rule);
  const name = (r: string) => (r === "blocked" || r === "review_waiting" ? t(`rules.${r}.name`) : td(`rules.${r}.name`));
  const hint = (r: string) => (r === "blocked" || r === "review_waiting" ? t(`rules.${r}.hint`, { days: REVIEW_WAIT_DAYS }) : td(`rules.${r}.hint`));
  const detail = (r: ExceptionRow) => {
    const d = r.detail;
    if (r.rule === "blocked") return t("rules.blocked.detail");
    if (r.rule === "review_waiting") return t("rules.review_waiting.detail", { n: Number(d.days ?? 0) });
    if (r.rule === "overdue" || r.rule === "stale") return td(`detail.${r.rule}`, { n: Number(d.days ?? 0) });
    if (r.rule === "slipped" || r.rule === "churn") return td(`detail.${r.rule}`, { n: Number(d.count ?? 0) });
    if (r.rule === "kpi_not_reported" || r.rule === "kpi_off_target") {
      return td(`detail.${r.rule}`, { period: d.period_start ? format.dateTime(new Date(String(d.period_start)), { dateStyle: "medium" }) : "—" });
    }
    if (r.rule === "disputed") return td("detail.disputed", { date: d.since ? format.dateTime(new Date(String(d.since)), { dateStyle: "medium" }) : "—" });
    return td(`detail.${r.rule}`);
  };

  async function remind(r: ExceptionRow) {
    setBusy(r.entityId);
    const res = await callApi(`/api/actions/${r.entityId}/remind`, "POST");
    setBusy(null);
    if (!res.ok) return void toast.error(t(`remind.errors.${remindError(res.message)}`));
    toast.success(t("remind.sent", { name: r.owner ?? "" }));
    router.refresh();
  }

  return (
    <Card className="gap-4 py-5 shadow-xs">
      <CardHeader className="px-5">
        <CardTitle className="text-base">{t("exceptions.title")}</CardTitle>
        <CardDescription>{t("exceptions.hint")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 px-5">
        {rows.length === 0 ? (
          <EmptyState icon={<CircleCheck animateOnView />} description={t("exceptions.none")} />
        ) : (
          <>
            <ToggleGroup type="single" variant="outline" size="sm" value={rule} onValueChange={(v) => setRule(v || "all")} className="flex-wrap justify-start">
              <ToggleGroupItem value="all" className="gap-1.5">
                {t("exceptions.all")}
                <span className="tabular-nums text-muted-foreground">{rows.length}</span>
              </ToggleGroupItem>
              {RULES.filter((r) => counts[r]).map((r) => (
                <ToggleGroupItem key={r} value={r} className="gap-1.5" title={hint(r)}>
                  {name(r)}
                  <span className="tabular-nums text-muted-foreground">{counts[r]}</span>
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader className="bg-muted/50">
                  <TableRow>
                    <TableHead>{td("item")}</TableHead>
                    <TableHead>{td("rule")}</TableHead>
                    <TableHead>{td("detailHead")}</TableHead>
                    <TableHead>{td("owner")}</TableHead>
                    <TableHead className="text-end">
                      <span className="sr-only">{t("remind.button")}</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {shown.map((r) => (
                    <TableRow key={`${r.entityId}-${r.rule}`}>
                      <TableCell className="max-w-80">
                        {r.entityType !== "kpi" ? (
                          <Link
                            href={`/${r.entityType === "action" ? "actions" : "recommendations"}/${r.entityId}`}
                            className="block truncate font-medium hover:underline"
                            dir="auto"
                          >
                            {r.title}
                          </Link>
                        ) : (
                          <span className="flex items-center gap-2 truncate font-medium">
                            <Gauge className="size-4 shrink-0 text-muted-foreground" />
                            {(ar ? r.titleAr : null) ?? r.title}
                          </span>
                        )}
                        <Link href={`/projects/${r.projectId}`} className="block truncate text-xs text-muted-foreground hover:underline" dir="auto">
                          {r.projectTitle}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <span title={hint(r.rule)}>{name(r.rule)}</span>
                      </TableCell>
                      <TableCell className={cn("tabular-nums", (r.rule === "overdue" || r.rule === "orphaned" || r.rule === "disputed") && "text-destructive")}>
                        {detail(r)}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {r.owner ?? "—"}
                        {r.lastReminded ? (
                          <span className="block text-xs">
                            {r.remindedToday ? t("remind.today") : t("remind.last", { date: format.dateTime(new Date(r.lastReminded), { dateStyle: "medium" }) })}
                          </span>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-end">
                        {r.can.remind ? (
                          <Button size="sm" variant="ghost" disabled={busy === r.entityId} onClick={() => void remind(r)}>
                            {busy === r.entityId ? <BrandLoader /> : <Bell animateOnHover />}
                            {t("remind.button")}
                          </Button>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
