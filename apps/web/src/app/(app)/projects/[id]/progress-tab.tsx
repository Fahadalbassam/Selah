import { FilePlus2 } from "lucide-react";
import { FileText } from "@/components/animate-ui/icons/file-text";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { FormDialog } from "@/components/form-dialog";
import { LateAgainstOriginal } from "@/components/late-against-original";
import { MetricHistory, type HistoryPoint } from "@/components/metric-history";
import { Meter, StatTile } from "@/components/stat-tile";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { firmToday } from "@/lib/dates";
import type { Progress } from "@/services/follow-through";

type Row = Record<string, string | number | null | undefined>;

export interface ProgressData {
  live: Row;
  history: { metric: string; value: string | null; asOf: string }[];
  progress: Progress;
}

export interface ReportList {
  reports: {
    id: string;
    title: string;
    periodStart: string | null;
    periodEnd: string | null;
    visibility: string;
    sharedAt: Date | null;
    createdAt: Date;
    author: string | null;
    kind: string;
    issued: boolean;
  }[];
  can: { write: boolean };
}

const num = (v: Row[string]) => (v === null || v === undefined ? null : Number(v));

/** Monthly snapshots as one point per date: verified out of released actions. */
function historyPoints(history: ProgressData["history"]): HistoryPoint[] {
  const byDate = new Map<string, HistoryPoint>();
  for (const h of history) {
    if (h.metric !== "verified" && h.metric !== "actions_total") continue;
    const p = byDate.get(h.asOf) ?? { asOf: h.asOf, verified: 0, total: 0 };
    if (h.metric === "verified") p.verified = Number(h.value ?? 0);
    else p.total = Number(h.value ?? 0);
    byDate.set(h.asOf, p);
  }
  return [...byDate.values()].filter((p) => p.total > 0);
}

/** The project's implementation numbers. Firm staff also get the reports list here. */
export async function ProgressTab({
  projectId,
  data,
  reports,
  firm,
}: {
  projectId: string;
  data: ProgressData;
  reports: ReportList | null;
  firm: boolean;
}) {
  const [t, tPack, format] = await Promise.all([getTranslations("metrics"), getTranslations("statusPack"), getFormatter()]);
  const month = (d: string) => format.dateTime(new Date(`${d}T00:00:00`), { month: "long", year: "numeric" });
  const { live, progress } = data;
  const day = (d: string | Date) => format.dateTime(new Date(d), { dateStyle: "medium" });
  const percent = (v: number | null) => (v === null ? "—" : `${Math.round(v)}%`);
  const applies = progress.total - progress.notApplicable - progress.superseded;
  const points = historyPoints(data.history);
  const basis = [
    [t("basisClient"), num(live.verified_client_evidence)],
    [t("basisConsultant"), num(live.verified_consultant_recorded)],
    [t("basisMixed"), num(live.verified_mixed)],
  ] as const;
  const outcomes = (["verified", "partially", "riskAccepted", "notApplicable", "superseded", "open"] as const).map(
    (k) => [t(`outcome.${k}`), progress[k]] as const,
  );
  const median = num(live.median_days_awaiting_review);

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">{t("hint")}</p>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <Card className="gap-3 py-5 shadow-xs">
          <CardHeader className="px-5">
            <CardDescription>{t("implemented")}</CardDescription>
            <CardTitle className="text-4xl font-semibold tabular-nums">{percent(progress.implementedPct)}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 px-5">
            {progress.implementedPct === null ? (
              <p className="text-sm text-muted-foreground">{t("noneYet")}</p>
            ) : (
              <>
                <Meter value={progress.implementedPct} label={t("implemented")} />
                <p className="text-sm text-muted-foreground">{t("implementedOf", { verified: progress.verified, applies })}</p>
              </>
            )}
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 border-t pt-3 text-sm">
              {outcomes.map(([k, v]) => (
                <div key={k} className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">{k}</dt>
                  <dd className="tabular-nums">{v}</dd>
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>

        <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
          <StatTile
            label={t("awaiting")}
            value={num(live.awaiting_review) ?? 0}
            hint={median === null ? undefined : t("awaitingDays", { days: median })}
          />
          <StatTile label={t("overdue")} value={num(live.overdue) ?? 0} hint={t("overdueHint")} />
          <StatTile label={t("blocked")} value={num(live.blocked) ?? 0} />
          <StatTile label={t("stale")} value={num(live.stale_actions) ?? 0} />
          <StatTile label={t("onTime")} value={percent(num(live.on_time_rate))} hint={t("onTimeHint")} />
          <StatTile label={t("slips")} value={num(live.deadline_slips) ?? 0} hint={t("slipsHint")} />
          <StatTile label={t("revisions")} value={percent(num(live.revision_rate))} />
          <div className="space-y-1 rounded-xl border bg-card px-4 py-3">
            <p className="text-xs text-muted-foreground">{t("basis")}</p>
            <dl className="space-y-0.5 text-sm">
              {basis.map(([k, v]) => (
                <div key={k} className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">{k}</dt>
                  <dd className="tabular-nums">{v ?? 0}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </div>

      {progress.late ? <LateAgainstOriginal late={progress.late} /> : null}

      <Card className="gap-3 py-5 shadow-xs">
        <CardHeader className="px-5">
          <CardTitle className="text-base">{t("history")}</CardTitle>
          <CardDescription>{t("historyHint")}</CardDescription>
        </CardHeader>
        <CardContent className="px-5">
          {points.length < 2 ? (
            <p className="text-sm text-muted-foreground">{t("historyEmpty")}</p>
          ) : (
            <MetricHistory points={points} />
          )}
        </CardContent>
      </Card>

      {reports ? (
        <Card className="gap-3 py-5 shadow-xs">
          <CardHeader className="flex flex-row items-start justify-between gap-4 px-5">
            <div className="space-y-1.5">
              <CardTitle className="text-base">{t("reports")}</CardTitle>
              <CardDescription>{firm ? t("reportsHint") : t("reportsHintClient")}</CardDescription>
            </div>
            {reports.can.write ? (
              <FormDialog
                trigger={
                  <Button variant="outline" size="sm">
                    <FilePlus2 />
                    {t("newReport")}
                  </Button>
                }
                title={t("newReport")}
                description={t("newReportHint")}
                endpoint={`/api/projects/${projectId}/reports`}
                fields={[
                  { name: "title", label: t("reportTitle"), required: true, maxLength: 300 },
                  { name: "periodStart", label: t("periodStart"), type: "date", required: true },
                  { name: "periodEnd", label: t("periodEnd"), type: "date", required: true, defaultValue: firmToday() },
                  { name: "bodyMd", label: t("notes"), type: "textarea", maxLength: 100_000 },
                ]}
                submitLabel={t("create")}
                redirectTo="/reports/:id"
              />
            ) : null}
          </CardHeader>
          <CardContent className="px-5">
            {reports.reports.length === 0 ? <p className="text-sm text-muted-foreground">{t("noReports")}</p> : null}
            <ul className="divide-y">
              {reports.reports.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-3 first:pt-0 last:pb-0">
                  <FileText className="size-4 text-muted-foreground" />
                  <Link href={`/reports/${r.id}`} className="font-medium hover:underline">
                    {r.kind === "status_pack" && r.periodStart ? tPack("title", { month: month(r.periodStart) }) : r.title}
                  </Link>
                  {r.periodStart && r.periodEnd ? (
                    <span className="text-sm text-muted-foreground tabular-nums">
                      {t("period", { start: day(r.periodStart), end: day(r.periodEnd) })}
                    </span>
                  ) : null}
                  {r.kind === "status_pack" && !r.issued ? (
                    <Badge variant="outline">{tPack("listDraft")}</Badge>
                  ) : firm ? (
                    <Badge variant={r.visibility === "shared" ? "secondary" : "outline"}>
                      {r.visibility === "shared" ? t("shared") : t("firmOnly")}
                    </Badge>
                  ) : null}
                  <span className="ms-auto text-xs text-muted-foreground">
                    {t("by", { who: r.author ?? "—", date: day(r.createdAt) })}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
