import { ArrowLeft } from "lucide-react";
import { Lock } from "@/components/animate-ui/icons/lock";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { AskAbout } from "@/components/ask-about";
import { PageHeader } from "@/components/page-header";
import { StanceBadge } from "@/components/stance-badge";
import { StatusBadge } from "@/components/status-badge";
import { Translatable } from "@/components/translatable";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { isUuid } from "@/lib/ids";
import { cn } from "@/lib/utils";
import { withPrincipal } from "@/server/page";
import { getRecommendation } from "@/services/responses";
import { AnswerDialog, ConfirmResponse, RespondDialog } from "./response-panel";

export default async function RecommendationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const data = await withPrincipal((tx, principal) => getRecommendation(tx, principal, id));
  const [t, tr, tPlan, tPrio, tVis, format] = await Promise.all([
    getTranslations("recommendationPage"),
    getTranslations("response"),
    getTranslations("plan"),
    getTranslations("priority"),
    getTranslations("visibility"),
    getFormatter(),
  ]);
  const ar = (await getLocale()) === "ar";
  const { recommendation: r, context, stance, responses } = data;
  const day = (d: string | Date) => format.dateTime(new Date(d), { dateStyle: "medium" });
  const when = (d: Date) => format.dateTime(d, { dateStyle: "medium", timeStyle: "short" });
  const client = context.projectKind === "client";
  // Why there is no Respond button, when there isn't one.
  const why =
    !client || data.can.respond
      ? null
      : r.withdrawnAt
        ? tr("withdrawn")
        : r.visibility !== "shared"
          ? tr("notShared")
          : context.projectState === "closed"
            ? tr("closed")
            : context.mode === "consultant_managed"
              ? data.firmStaff
                ? null
                : tr("noAccounts")
              : tr("whoResponds");

  return (
    <>
      <Link href={`/projects/${r.projectId}?tab=recs`} className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4 rtl:-scale-x-100" />
        {t("back")}
      </Link>
      <PageHeader
        title={r.title}
        meta={
          <>
            {r.withdrawnAt ? <Badge variant="outline">{tPlan("changes.withdrawnBadge")}</Badge> : null}
            {stance ? <StanceBadge stance={stance.stance} /> : null}
            {r.visibility === "firm_private" ? (
              <Badge variant="outline" className="gap-1">
                <Lock className="size-3" />
                {tVis("firm_private")}
              </Badge>
            ) : null}
          </>
        }
      >
        {data.askAssistant && !r.withdrawnAt ? <AskAbout projectId={r.projectId} type="recommendation" id={r.id} /> : null}
      </PageHeader>
      {r.withdrawnAt ? (
        <p className="-mt-3 max-w-3xl text-sm text-muted-foreground">
          {tPlan("changes.withdrawnOn", { date: day(r.withdrawnAt) })} <span dir="auto">{r.withdrawnReason}</span>
        </p>
      ) : null}

      {r.rationale ? (
        <Translatable entityType="recommendation" entityId={r.id} field="rationale" text={r.rationale} canReview={data.firmStaff} className="-mt-3 max-w-3xl text-sm text-muted-foreground" />
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="space-y-6">
          {client ? (
            <Card className="gap-4 py-5 shadow-xs">
              <CardHeader className="flex flex-row items-start justify-between gap-4 px-5">
                <div className="space-y-1.5">
                  <CardTitle className="text-base">{tr("title")}</CardTitle>
                  <CardDescription>
                    {data.firmStaff ? (context.mode === "consultant_managed" ? tr("hintOnBehalf") : tr("hintFirm")) : tr("hintClient")}
                  </CardDescription>
                </div>
                {data.can.respond ? (
                  <RespondDialog
                    recommendationId={r.id}
                    onBehalf={data.can.onBehalf}
                    trigger={
                      <Button size="sm" variant={responses.length ? "outline" : "default"}>
                        {data.can.onBehalf ? tr("record") : responses.length ? tr("respondAgain") : tr("respond")}
                      </Button>
                    }
                  />
                ) : null}
              </CardHeader>
              <CardContent className="space-y-4 px-5">
                {why ? <p className="text-sm text-muted-foreground">{why}</p> : null}
                {responses.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{tr("none")}</p>
                ) : (
                  <ol className="space-y-4">
                    {responses.map((x) => {
                      const current = x.id === stance?.responseId;
                      return (
                        <li key={x.id} className={cn("space-y-2 rounded-lg border px-4 py-3 text-sm", current && "border-foreground/30")}>
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-medium">{tr(`choices.${x.stance}`)}</span>
                            {current ? <Badge variant="outline">{tr("current")}</Badge> : null}
                            <span className="text-xs text-muted-foreground tabular-nums">
                              {tr("recordedBy", { name: x.recordedByName ?? "—", date: when(x.createdAt) })}
                            </span>
                          </div>
                          {x.plannedAction ? (
                            <p className="whitespace-pre-wrap" dir="auto">
                              {tr("planLine", { plan: x.plannedAction })}
                            </p>
                          ) : null}
                          {x.targetDate || x.actionOwner ? (
                            <p className="flex flex-wrap gap-x-4 text-muted-foreground">
                              {x.targetDate ? <span className="tabular-nums">{tr("byLine", { date: day(x.targetDate) })}</span> : null}
                              {x.actionOwner ? <span dir="auto">{tr("ownerLine", { owner: x.actionOwner })}</span> : null}
                            </p>
                          ) : null}
                          {x.reason ? (
                            <p className="whitespace-pre-wrap" dir="auto">
                              {x.reason}
                            </p>
                          ) : null}
                          {x.source === "consultant_recorded" ? (
                            <div className="flex flex-wrap items-center gap-3 rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                              <span>{tr("onBehalf", { via: tr(`vias.${x.receivedVia ?? "meeting"}`), date: x.receivedOn ? day(x.receivedOn) : "—" })}</span>
                              {x.confirmedAt ? (
                                <span>{tr("confirmedBy", { name: x.confirmedByName ?? "—" })}</span>
                              ) : (
                                <span className="text-foreground">{tr("unconfirmed")}</span>
                              )}
                              {x.can.confirm ? <ConfirmResponse responseId={x.id} /> : null}
                            </div>
                          ) : null}
                          {x.firmReply ? (
                            <div className="space-y-1 border-s-2 ps-3">
                              <p className="text-xs text-muted-foreground">
                                {tr("firmAnswer", { name: x.repliedByName ?? "—", date: x.repliedAt ? when(x.repliedAt) : "—" })}
                              </p>
                              <p className="whitespace-pre-wrap" dir="auto">
                                {x.firmReply}
                              </p>
                            </div>
                          ) : x.can.reply ? (
                            <AnswerDialog responseId={x.id} />
                          ) : null}
                        </li>
                      );
                    })}
                  </ol>
                )}
                {responses.length > 1 ? <p className="text-xs text-muted-foreground">{tr("historyHint")}</p> : null}
              </CardContent>
            </Card>
          ) : null}

          <Card className="gap-4 py-5 shadow-xs">
            <CardHeader className="px-5">
              <CardTitle className="text-base">{t("actions")}</CardTitle>
              <CardDescription>{t("actionsHint")}</CardDescription>
            </CardHeader>
            <CardContent className="px-5">
              {data.actions.length === 0 ? <p className="text-sm text-muted-foreground">{t("noActions")}</p> : null}
              <ul className="divide-y">
                {data.actions.map((a) => (
                  <li key={a.id} className="flex flex-wrap items-center gap-3 py-2.5 text-sm">
                    <Link href={`/actions/${a.id}`} className="min-w-0 flex-1 truncate font-medium hover:underline" dir="auto">
                      {a.title}
                    </Link>
                    <StatusBadge status={a.status} />
                    <span className="w-28 text-xs text-muted-foreground tabular-nums">{a.dueDate ? day(a.dueDate) : "—"}</span>
                    <span className="w-36 truncate text-xs text-muted-foreground">{a.ownerName ?? "—"}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </div>

        <Card className="h-fit gap-0 py-0 shadow-xs">
          <dl className="divide-y text-sm">
            {[
              [t("project"), <Link key="p" href={`/projects/${r.projectId}`} className="text-primary hover:underline">{context.projectTitle}</Link>],
              ...(client ? [[t("client"), (ar ? context.orgNameAr : null) ?? context.orgName] as const] : []),
              ...(data.finding ? [[t("answers"), <span key="f" dir="auto">{data.finding.title}</span>] as const] : []),
              [t("priority"), tPrio(r.priority)],
              [t("due"), <span key="d" className="tabular-nums">{r.dueDate ? day(r.dueDate) : "—"}</span>],
              [t("source"), tPlan(`rec.sources.${r.source}`)],
              ...(r.targetOutcome ? [[t("targetOutcome"), <span key="o" dir="auto" className="whitespace-pre-wrap">{r.targetOutcome}</span>] as const] : []),
              ...(r.requiredEvidence ? [[t("requiredEvidence"), <span key="e" dir="auto" className="whitespace-pre-wrap">{r.requiredEvidence}</span>] as const] : []),
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
