import { ArrowLeft, CheckCircle2, FileText, MessageSquare, RotateCcw, XCircle } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { withPrincipal } from "@/server/page";
import { getActionDetail } from "@/services/queries";
import { ActionPanel } from "./action-panel";
import { DownloadButton } from "./download-button";

function fileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function ActionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const data = await withPrincipal((tx, principal) => getActionDetail(tx, principal, id));
  const [t, tTable, format] = await Promise.all([getTranslations("action"), getTranslations("table"), getFormatter()]);
  const ar = (await getLocale()) === "ar";
  const { action, context } = data;
  const when = (d: Date) => format.dateTime(d, { dateStyle: "medium", timeStyle: "short" });

  return (
    <>
      <Link href="/actions" className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4 rtl:-scale-x-100" />
        {t("back")}
      </Link>
      <PageHeader title={action.title} description={action.description ?? undefined}>
        <StatusBadge status={action.status} />
      </PageHeader>

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-6">
          {action.status === "blocked" && action.blockedReason ? (
            <p className="rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive">{t("blocked", { reason: action.blockedReason })}</p>
          ) : null}

          <ActionPanel actionId={action.id} status={action.status} moves={data.moves} can={data.can} />

          <Card className="gap-4 py-5 shadow-xs">
            <CardHeader className="px-5">
              <CardTitle className="text-base">{t("history")}</CardTitle>
            </CardHeader>
            <CardContent className="px-5">
              {data.timeline.length === 0 ? <p className="text-sm text-muted-foreground">{t("noHistory")}</p> : null}
              <ol className="space-y-5">
                {data.timeline.map((e, i) => {
                  const Icon =
                    e.kind === "update" ? MessageSquare : e.kind === "evidence" ? FileText : e.outcome === "accept" ? CheckCircle2 : e.outcome === "revise" ? RotateCcw : XCircle;
                  const tone =
                    e.kind === "review" ? (e.outcome === "accept" ? "text-success" : "text-destructive") : "text-muted-foreground";
                  return (
                    <li key={i} className="flex gap-3">
                      <Icon className={cn("mt-0.5 size-4 shrink-0", tone)} />
                      <div className="min-w-0 flex-1 space-y-1">
                        <p className="text-sm">
                          <span className="font-medium">{e.who ?? (e.kind === "review" ? t("firmReviewer") : t("someone"))}</span>{" "}
                          <span className="text-muted-foreground">{t(`entry.${e.kind === "review" ? e.outcome : e.kind}`)}</span>
                          <span className="ms-2 text-xs text-muted-foreground tabular-nums">{when(e.at)}</span>
                        </p>
                        {e.kind === "update" ? <p className="text-sm whitespace-pre-wrap">{e.body}</p> : null}
                        {e.kind === "review" && e.reason ? <p className="text-sm whitespace-pre-wrap">{e.reason}</p> : null}
                        {e.kind === "evidence" ? (
                          <div className="flex flex-wrap items-center gap-3 rounded-md border bg-muted/30 px-3 py-2">
                            <FileText className="size-4 text-muted-foreground" />
                            <span className="truncate text-sm">{e.evidence.documentTitle}</span>
                            <span className="text-xs text-muted-foreground tabular-nums">
                              {fileSize(e.evidence.sizeBytes)}
                            </span>
                            {e.evidence.canDownload ? <DownloadButton documentId={e.evidence.documentId} label={t("download")} unavailable={t("errors.unavailable")} /> : null}
                            {e.evidence.note ? <p className="w-full text-sm text-muted-foreground">{e.evidence.note}</p> : null}
                          </div>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ol>
            </CardContent>
          </Card>
        </div>

        <Card className="h-fit gap-0 py-0 shadow-xs">
          <dl className="divide-y text-sm">
            {[
              [tTable("project"), <Link key="p" href={`/projects/${action.projectId}`} className="text-primary hover:underline">{context.projectTitle}</Link>],
              [t("recommendation"), context.recommendationTitle],
              [t("owner"), action.ownerName ?? tTable("unassigned")],
              [
                t("due"),
                <span key="d" className={cn("tabular-nums", action.overdue && "font-medium text-destructive")}>
                  {action.dueDate ? format.dateTime(new Date(action.dueDate), { dateStyle: "medium" }) : "—"}
                  {action.overdue ? ` (${tTable("overdue")})` : ""}
                </span>,
              ],
              ...(context.requiredEvidence ? [[t("requiredEvidence"), context.requiredEvidence] as const] : []),
              ...(context.projectKind === "client" ? [[tTable("client"), (ar ? context.orgNameAr : null) ?? context.orgName] as const] : []),
            ].map(([k, v], i) => (
              <div key={i} className="space-y-1 px-5 py-3">
                <dt className="text-xs text-muted-foreground">{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
        </Card>
      </div>
    </>
  );
}
