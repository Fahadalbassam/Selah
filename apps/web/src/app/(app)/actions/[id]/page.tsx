import { ArrowLeft, ArrowRightLeft, MailWarning } from "lucide-react";
import { CircleCheck } from "@/components/animate-ui/icons/circle-check";
import { FileText } from "@/components/animate-ui/icons/file-text";
import { MessageSquare } from "@/components/animate-ui/icons/message-square";
import { RotateCcw } from "@/components/animate-ui/icons/rotate-ccw";
import { CircleX } from "@/components/animate-ui/icons/circle-x";
import { Lock } from "@/components/animate-ui/icons/lock";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { AskAbout } from "@/components/ask-about";
import { MuteButton } from "@/components/mail-choices";
import { FormDialog } from "@/components/form-dialog";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { Translatable } from "@/components/translatable";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { isUuid } from "@/lib/ids";
import { localLabel } from "@/lib/names";
import { cn } from "@/lib/utils";
import { withPrincipal } from "@/server/page";
import { departmentChoices } from "@/services/engagement";
import { actionClosure, actionFollowThrough, actionLadder, listActionNotes, mailFailing } from "@/services/follow-through";
import { isActionMuted } from "@/services/notifications";
import { getActionDetail } from "@/services/queries";
import { ActionPanel } from "./action-panel";
import { RiskAcceptances } from "./closure-panels";
import { DownloadButton } from "./download-button";
import { DepartmentPicker } from "./department-picker";
import { DeadlineRequests, EvidenceList } from "./follow-through-panels";
import { ReminderLadder } from "./reminder-ladder";

function fileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default async function ActionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const { data, follow, closing, depts, firmView, notes, ladder, muted, failing } = await withPrincipal(async (tx, principal) => {
    const data = await getActionDetail(tx, principal, id);
    return {
      ladder: await actionLadder(tx, principal, id),
      muted: await isActionMuted(tx, principal, id),
      // Firm staff see when mail to the owner isn't getting through.
      failing: data.action.ownerUserId ? (await mailFailing(tx, principal, [data.action.ownerUserId])).get(data.action.ownerUserId) ?? null : null,
      data,
      firmView: principal.orgKind === "firm",
      follow: await actionFollowThrough(tx, principal, id),
      closing: await actionClosure(tx, principal, id),
      // Firm-only notes; anyone who may not read them (every client role) gets null.
      notes: await listActionNotes(tx, principal, id).catch(() => null),
      // Internal projects have no departments.
      depts: data.context.projectKind === "client" ? await departmentChoices(tx, principal, data.action.orgId) : null,
    };
  });
  const [t, tTable, tEng, tVis, format] = await Promise.all([
    getTranslations("action"),
    getTranslations("table"),
    getTranslations("engagement.departments"),
    getTranslations("visibility"),
    getFormatter(),
  ]);
  const dept = depts?.departments.find((d) => d.id === data.action.departmentId) ?? null;
  // Shown while the client uses departments, or while the action is still filed under one.
  const showDept = !!depts && (depts.enabled || !!dept);
  const ar = (await getLocale()) === "ar";
  const { action, context } = data;
  const when = (d: Date) => format.dateTime(d, { dateStyle: "medium", timeStyle: "short" });

  return (
    <>
      <Link href="/actions" className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4 rtl:-scale-x-100" />
        {t("back")}
      </Link>
      <PageHeader title={action.title} meta={<StatusBadge status={action.status} />}>
        <MuteButton actionId={action.id} muted={muted} />
        {data.firmStaff ? <AskAbout projectId={action.projectId} type="action" id={action.id} /> : null}
      </PageHeader>
      {action.description ? (
        <Translatable entityType="action" entityId={action.id} field="description" text={action.description} canReview={data.firmStaff} className="-mt-3 max-w-3xl text-sm text-muted-foreground" />
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="space-y-6">
          {closing.closure ? (
            <div className="space-y-1 rounded-lg border bg-muted/40 px-4 py-3 text-sm">
              <p className="font-medium">
                {t("closure.closedAs", { outcome: t(`closure.outcomes.${closing.closure.outcome ?? "not_applicable"}`) })}
              </p>
              {closing.closure.note ? <p className="whitespace-pre-wrap">{closing.closure.note}</p> : null}
              {closing.closure.supersededBy ? (
                <p>
                  {t("closure.replacedBy")}:{" "}
                  <Link href={`/actions/${closing.closure.supersededBy.id}`} className="text-primary hover:underline">
                    {closing.closure.supersededBy.title}
                  </Link>
                </p>
              ) : null}
              {closing.closure.at ? (
                <p className="text-xs text-muted-foreground">
                  {closing.closure.by ? t("closure.by", { name: closing.closure.by, date: when(closing.closure.at) }) : when(closing.closure.at)}
                </p>
              ) : null}
            </div>
          ) : null}
          {action.status === "blocked" && action.blockedReason ? (
            <p className="rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive">{t("blocked", { reason: action.blockedReason })}</p>
          ) : null}

          <ActionPanel
            actionId={action.id}
            status={action.status}
            moves={data.moves}
            can={data.can}
            close={closing.can.close ? { signed: closing.signed, replacements: closing.replacements } : undefined}
            openItems={follow.items.filter((i) => i.status === "open").map((i) => ({ id: i.id, title: i.title }))}
          />

          <EvidenceList actionId={action.id} items={follow.items} canManage={follow.can.manageItems} firmView={firmView} canSubmit={data.can.submitEvidence} />

          {notes ? (
            <Card className="gap-4 py-5 shadow-xs">
              <CardHeader className="flex flex-row items-start justify-between gap-4 px-5">
                <div className="space-y-1.5">
                  <CardTitle className="flex items-center gap-2 text-base">
                    {t("notes.title")}
                    <Badge variant="outline" className="gap-1">
                      <Lock className="size-3" />
                      {tVis("firm_private")}
                    </Badge>
                  </CardTitle>
                  <CardDescription>{t("notes.hint")}</CardDescription>
                </div>
                <FormDialog
                  trigger={
                    <Button variant="outline" size="sm">
                      {t("notes.add")}
                    </Button>
                  }
                  title={t("notes.add")}
                  description={t("notes.hint")}
                  endpoint={`/api/actions/${action.id}/notes`}
                  fields={[{ name: "body", label: t("notes.label"), type: "textarea", required: true, maxLength: 8000, placeholder: t("notes.placeholder") }]}
                  submitLabel={t("notes.add")}
                />
              </CardHeader>
              <CardContent className="px-5">
                {notes.length === 0 ? <p className="text-sm text-muted-foreground">{t("notes.none")}</p> : null}
                <ol className="space-y-4">
                  {notes.map((n) => (
                    <li key={n.id} className="space-y-1 text-sm">
                      <p>
                        <span className="font-medium">{n.author}</span>{" "}
                        <span className="ms-1 text-xs text-muted-foreground tabular-nums">{when(n.at)}</span>
                      </p>
                      <p className="whitespace-pre-wrap" dir="auto">
                        {n.body}
                      </p>
                    </li>
                  ))}
                </ol>
              </CardContent>
            </Card>
          ) : null}

          <Card className="gap-4 py-5 shadow-xs">
            <CardHeader className="px-5">
              <CardTitle className="text-base">{t("history")}</CardTitle>
            </CardHeader>
            <CardContent className="px-5">
              {data.timeline.length === 0 ? <p className="text-sm text-muted-foreground">{t("noHistory")}</p> : null}
              <ol className="space-y-5">
                {data.timeline.map((e, i) => {
                  const Icon =
                    e.kind === "update"
                      ? MessageSquare
                      : e.kind === "evidence"
                        ? FileText
                        : e.kind === "moved"
                          ? ArrowRightLeft
                          : e.outcome === "accept"
                            ? CircleCheck
                            : e.outcome === "revise"
                              ? RotateCcw
                              : CircleX;
                  const tone =
                    e.kind === "review" ? (e.outcome === "accept" ? "text-success" : "text-destructive") : "text-muted-foreground";
                  return (
                    <li key={i} className="flex gap-3">
                      <Icon className={cn("mt-0.5 size-4 shrink-0", tone)} />
                      <div className="min-w-0 flex-1 space-y-1">
                        <p className="text-sm">
                          <span className="font-medium">{e.who ?? (e.kind === "review" ? t("firmReviewer") : t("someone"))}</span>{" "}
                          <span className="text-muted-foreground">
                            {e.kind === "moved"
                              ? t("entry.moved", {
                                  from: e.from ? localLabel(e.from, ar) : "—",
                                  to: e.to ? localLabel(e.to, ar) : "—",
                                })
                              : t(`entry.${e.kind === "review" ? e.outcome : e.kind}`)}
                          </span>
                          <span className="ms-2 text-xs text-muted-foreground tabular-nums">{when(e.at)}</span>
                        </p>
                        {e.kind === "update" ? (
                          <Translatable entityType="progress_update" entityId={e.id} field="body" text={e.body} canReview={data.firmStaff} className="text-sm" />
                        ) : null}
                        {e.kind === "review" && e.reason ? <p className="text-sm whitespace-pre-wrap">{e.reason}</p> : null}
                        {e.kind === "evidence" ? (
                          <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-muted/30 px-3 py-2">
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

        <div className="space-y-6">
        <Card className="h-fit gap-0 py-0 shadow-xs">
          <dl className="divide-y text-sm">
            {[
              [tTable("project"), <Link key="p" href={`/projects/${action.projectId}`} className="text-primary hover:underline">{context.projectTitle}</Link>],
              [t("recommendation"), context.recommendationTitle],
              [
                t("owner"),
                <span key="o" className="space-y-1">
                  <span className="block">{action.ownerName ?? tTable("unassigned")}</span>
                  {failing ? (
                    <span className="flex items-center gap-1.5 text-xs text-destructive" title={t("mailFailingHint", { name: action.ownerName ?? "" })}>
                      <MailWarning className="size-3.5 shrink-0" />
                      {t("mailFailing")}
                    </span>
                  ) : null}
                </span>,
              ],
              [
                t("due"),
                <span key="d" className={cn("tabular-nums", action.overdue && "font-medium text-destructive")}>
                  {action.dueDate ? format.dateTime(new Date(action.dueDate), { dateStyle: "medium" }) : "—"}
                  {action.overdue ? ` (${tTable("overdue")})` : ""}
                </span>,
              ],
              ...(showDept
                ? [
                    [
                      tEng("department"),
                      data.can.fileDepartment && depts!.enabled ? (
                        <DepartmentPicker key="dp" actionId={action.id} value={action.departmentId} departments={depts!.departments} />
                      ) : dept ? (
                        localLabel(dept, ar)
                      ) : (
                        tEng("none")
                      ),
                    ] as const,
                  ]
                : []),
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
        <DeadlineRequests
          actionId={action.id}
          dueDate={action.dueDate}
          requests={follow.deadlines}
          canRequest={follow.can.requestDeadline}
          canDecide={follow.can.decideDeadline}
        />
        <ReminderLadder running={ladder.running} steps={ladder.steps} />
        <RiskAcceptances actionId={action.id} items={closing.acceptances} canSign={closing.can.sign} />
        </div>
      </div>
    </>
  );
}
