import { ArrowLeft, Send, Share2 } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { ExportButton } from "@/components/export-button";
import { ApiButton, FormDialog } from "@/components/form-dialog";
import { LateAgainstOriginal } from "@/components/late-against-original";
import { PageHeader } from "@/components/page-header";
import { Meter, StatTile } from "@/components/stat-tile";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { env } from "@/env";
import { isUuid } from "@/lib/ids";
import { withPrincipal } from "@/server/page";
import { getReport } from "@/services/follow-through";
import { getProject } from "@/services/queries";
import { reportPack } from "@/services/status-pack";
import { StatusPackLists } from "./status-pack";

export default async function ReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const { report, can, projectTitle, firm, pack } = await withPrincipal(async (tx, principal) => {
    const r = await getReport(tx, principal, id);
    const { project } = await getProject(tx, principal, r.report.projectId);
    const pack = r.report.kind === "status_pack" ? await reportPack(tx, principal, id) : null;
    return { ...r, projectTitle: project.title, firm: principal.orgKind === "firm", pack };
  });
  const [t, tPack, tExport, format] = await Promise.all([
    getTranslations("metrics"),
    getTranslations("statusPack"),
    getTranslations("exports"),
    getFormatter(),
  ]);
  const day = (d: string | Date) => format.dateTime(new Date(d), { dateStyle: "medium" });
  // A draft pack shows the numbers as they stand; issuing freezes them.
  const m = report.metrics ?? pack?.live ?? null;
  const title =
    pack && report.periodStart
      ? tPack("title", { month: format.dateTime(new Date(`${report.periodStart}T00:00:00`), { month: "long", year: "numeric" }) })
      : report.title;

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
        title={title}
        description={
          report.periodStart && report.periodEnd
            ? t("period", { start: day(report.periodStart), end: day(report.periodEnd) })
            : undefined
        }
        meta={
          pack?.draft ? (
            <Badge variant="outline">{tPack("draft")}</Badge>
          ) : firm ? (
            <Badge variant={report.visibility === "shared" ? "secondary" : "outline"}>
              {report.visibility === "shared" && report.sharedAt ? t("sharedOn", { date: day(report.sharedAt) }) : t("firmOnly")}
            </Badge>
          ) : null
        }
      >
        {env().PDF_SERVICE_URL ? (
          <ExportButton endpoint={`/api/reports/${report.id}/pdf`} label={tExport("pdf")} title={tExport("downloadPdf")} />
        ) : null}
        {can.issue ? (
          <FormDialog
            trigger={
              <Button size="sm">
                <Send />
                {tPack("issue")}
              </Button>
            }
            title={tPack("issueTitle")}
            description={tPack("issueHint")}
            endpoint={`/api/reports/${report.id}/issue`}
            fields={[{ name: "bodyMd", label: tPack("note"), type: "textarea", maxLength: 8000, placeholder: tPack("notePlaceholder") }]}
            submitLabel={tPack("issue")}
          />
        ) : null}
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
      {pack?.draft ? (
        <Card className="gap-1 border-dashed py-4 shadow-none">
          <CardHeader className="px-5">
            <CardTitle className="text-sm">{tPack("draftTitle")}</CardTitle>
            <CardDescription>{tPack("draftHint")}</CardDescription>
          </CardHeader>
        </Card>
      ) : null}

      {m ? (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
          <Card className="gap-3 py-5 shadow-xs">
            <CardHeader className="px-5">
              <p className="text-sm text-muted-foreground">
                {pack?.draft ? t("implemented") : report.periodEnd ? t("frozen", { date: day(report.periodEnd) }) : t("implemented")}
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
            {m.extended !== undefined ? (
              <>
                <StatTile label={t("extended")} value={m.extended} hint={t("extendedHint", { twice: m.extendedTwice ?? 0 })} />
                <StatTile label={t("slipDays")} value={m.slipDays ?? 0} hint={t("slipDaysHint")} />
              </>
            ) : null}
          </div>
        </div>
      ) : null}
      {m?.late ? <LateAgainstOriginal late={m.late} /> : null}

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
      {pack ? <StatusPackLists pack={pack.pack} links /> : null}
    </>
  );
}
