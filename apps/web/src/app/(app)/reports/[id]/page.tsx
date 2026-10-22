import { ArrowLeft, Share2 } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { ApiButton } from "@/components/form-dialog";
import { PageHeader } from "@/components/page-header";
import { Meter, StatTile } from "@/components/stat-tile";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { withPrincipal } from "@/server/page";
import { getReport } from "@/services/follow-through";
import { getProject } from "@/services/queries";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function ReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const { report, can, projectTitle, firm } = await withPrincipal(async (tx, principal) => {
    const r = await getReport(tx, principal, id);
    const { project } = await getProject(tx, principal, r.report.projectId);
    return { ...r, projectTitle: project.title, firm: principal.orgKind === "firm" };
  });
  const [t, format] = await Promise.all([getTranslations("metrics"), getFormatter()]);
  const day = (d: string | Date) => format.dateTime(new Date(d), { dateStyle: "medium" });
  const m = report.metrics;

  return (
    <>
      <Link
        href={`/projects/${report.projectId}`}
        className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4 rtl:-scale-x-100" />
        {projectTitle}
      </Link>
      <PageHeader
        title={report.title}
        description={
          report.periodStart && report.periodEnd
            ? t("period", { start: day(report.periodStart), end: day(report.periodEnd) })
            : undefined
        }
        meta={
          firm ? (
            <Badge variant={report.visibility === "shared" ? "secondary" : "outline"}>
              {report.visibility === "shared" && report.sharedAt ? t("sharedOn", { date: day(report.sharedAt) }) : t("firmOnly")}
            </Badge>
          ) : null
        }
      >
        {can.share ? (
          <ApiButton
            endpoint={`/api/reports/${report.id}/share`}
            label={t("share")}
            confirm={t("shareConfirm")}
            icon={<Share2 />}
          />
        ) : null}
      </PageHeader>
      <p className="-mt-3 text-sm text-muted-foreground">{t("by", { who: report.author ?? "—", date: day(report.createdAt) })}</p>

      {m ? (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
          <Card className="gap-3 py-5 shadow-xs">
            <CardHeader className="px-5">
              <p className="text-sm text-muted-foreground">
                {report.periodEnd ? t("frozen", { date: day(report.periodEnd) }) : t("implemented")}
              </p>
              <CardTitle className="text-4xl font-semibold tabular-nums">
                {m.implementedPct === null ? "—" : `${Math.round(m.implementedPct)}%`}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 px-5">
              {m.implementedPct === null ? (
                <p className="text-sm text-muted-foreground">{t("noneYet")}</p>
              ) : (
                <>
                  <Meter value={m.implementedPct} label={t("implemented")} />
                  <p className="text-sm text-muted-foreground">
                    {t("implementedOf", { verified: m.verified, applies: m.total - m.notApplicable - m.superseded })}
                  </p>
                </>
              )}
            </CardContent>
          </Card>
          <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
            {(["verified", "partially", "riskAccepted", "notApplicable", "superseded", "open"] as const).map((k) => (
              <StatTile key={k} label={t(`outcome.${k}`)} value={m[k]} />
            ))}
            <StatTile label={t("overdue")} value={m.overdue} hint={t("overdueHint")} />
          </div>
        </div>
      ) : null}

      {report.bodyMd ? (
        <Card className="gap-3 py-5 shadow-xs">
          <CardHeader className="px-5">
            <CardTitle className="text-base">{t("notesTitle")}</CardTitle>
          </CardHeader>
          <CardContent className="px-5 text-sm whitespace-pre-wrap" dir="auto">
            {report.bodyMd}
          </CardContent>
        </Card>
      ) : null}
    </>
  );
}
