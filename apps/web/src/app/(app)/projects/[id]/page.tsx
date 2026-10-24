import { CalendarDays, CalendarPlus, ClipboardList, FilePenLine, Pencil, SearchCheck, UserCheck, UserPlus } from "lucide-react";
import { Bot } from "@/components/animate-ui/icons/bot";
import { Crown } from "@/components/animate-ui/icons/crown";
import { Eye } from "@/components/animate-ui/icons/eye";
import { EyeOff } from "@/components/animate-ui/icons/eye-off";
import { FileText } from "@/components/animate-ui/icons/file-text";
import { Lock } from "@/components/animate-ui/icons/lock";
import { Plus } from "@/components/animate-ui/icons/plus";
import { Upload } from "@/components/animate-ui/icons/upload";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { ActionsTable } from "@/components/actions-table";
import { ApiButton, FormDialog } from "@/components/form-dialog";
import { MeetingForm } from "@/components/meeting-form";
import { AskAbout } from "@/components/ask-about";
import { EmptyState } from "@/components/empty-state";
import { ExportButton } from "@/components/export-button";
import { FileActions } from "@/components/file-actions";
import { PageHeader } from "@/components/page-header";
import { SectionHeader } from "@/components/section-header";
import { StanceBadge } from "@/components/stance-badge";
import { Translatable } from "@/components/translatable";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { isUuid } from "@/lib/ids";
import { localLabel, localName } from "@/lib/names";
import { cn } from "@/lib/utils";
import { withPrincipal } from "@/server/page";
import { listAssessments, listTemplates } from "@/services/assessments";
import { listReports, projectMetrics, projectProgress } from "@/services/follow-through";
import { listClientRoles } from "@/services/client-roles";
import { getClosure } from "@/services/closure";
import { getPulse } from "@/services/pulse";
import { getHandover } from "@/services/handover";
import { projectDeviations, projectTrace, sinceLastVisit } from "@/services/insight";
import { listMeetings, meetingInvitees } from "@/services/meetings";
import { planOptions } from "@/services/plan";
import { getProject, isOverdue } from "@/services/queries";
import { listInfoRequests } from "@/services/info-requests";
import { getProjectPeople, getProjectTeam } from "@/services/staffing";
import { NO_PREVIOUS } from "@/lib/phases";
import { ProjectPeople } from "./project-people";
import { StartAssessment } from "../../assessments/[id]/assessment-panels";
import { DocumentSummary, TextStatusBadge } from "./document-summary";
import { ClientRolesCard } from "./client-roles-card";
import { ClosureTab } from "./closure-tab";
import { PulseSection } from "./pulse-section";
import { HandoverCard } from "./handover-card";
import { InfoRequestsTab } from "./info-requests-tab";
import { Deviations, SinceLastVisit, Trace } from "./insight";
import { ActionDialog, RecommendationDialog } from "./plan-dialogs";
import { RecordActions } from "./record-actions";
import { ProgressTab } from "./progress-tab";

const TABS = ["recs", "progress", "attention", "trace", "meetings", "assessments", "requests", "docs", "activity", "team", "closing"];

export default async function ProjectPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { id } = await params;
  // A link may open a tab (a notification about a request opens the list).
  const { tab } = await searchParams;
  if (!isUuid(id)) notFound();
  const { data, plan, team, people, roles, firmStaff, meetings, invitees, me, observing, assessments, templates, metrics, reports, visit, deviations, trace, handover, requests, closure, pulse } = await withPrincipal(async (tx, principal) => {
    const data = await getProject(tx, principal, id);
    const client = data.project.kind === "client";
    return {
      // Client projects only; roles that can't read assessments get no tab.
      assessments: client ? await listAssessments(tx, principal, id).catch(() => null) : null,
      // Published templates to start from, for firm staff.
      templates:
        client && principal.orgKind === "firm"
          ? (await listTemplates(tx, principal)).templates.filter((x) => x.published && !x.archivedAt)
          : null,
      data,
      // What this user may add to the plan, with the choices for a new action; null for clients.
      plan: await planOptions(tx, principal, id),
      team: await getProjectTeam(tx, principal, id),
      // The client's own people on the project: the firm, and the client's admin.
      people: await getProjectPeople(tx, principal, id),
      // Sponsor, coordinator, steering committee, acceptors, observers (client projects).
      roles: client ? await listClientRoles(tx, principal, id) : null,
      firmStaff: principal.orgKind === "firm",
      // Roles that can't read meetings simply get no tab.
      meetings: await listMeetings(tx, principal, id).catch(() => null),
      // Who may book: the list of people to invite, or null.
      invitees: await meetingInvitees(tx, principal, id).catch(() => null),
      me: principal.userId,
      // Reads and comments only here (N6).
      observing: principal.observedProjectIds?.has(id) ?? false,
      // Action owners don't read metrics or reports; they get no tab.
      metrics: await projectMetrics(tx, principal, id)
        .then(async (m) => ({ ...m, progress: await projectProgress(tx, principal, id) }))
        .catch(() => null),
      reports: await listReports(tx, principal, id).catch(() => null),
      // What moved since this person's last visit; the page moves the mark once shown.
      visit: await sinceLastVisit(tx, principal, id).catch(() => null),
      // The deviation rules, for the firm.
      deviations: await projectDeviations(tx, principal, id).catch(() => null),
      trace: await projectTrace(tx, principal, id).catch(() => null),
      handover: await getHandover(tx, principal, id),
      // What the firm asked the client for (client projects only).
      requests: client ? await listInfoRequests(tx, principal, id).catch(() => null) : null,
      // Closing (baseline: Closing). The firm sees it on every signed project; the
      // client once it is closing or closed, or when they may ask the firm to close.
      closure:
        data.project.state === "draft"
          ? null
          : await getClosure(tx, principal, id).then((c) =>
              c.firm || c.state === "closing" || c.state === "closed" || c.can.request || c.request ? c : null,
            ),
      // The closing pulse (F36): the client people asked answer it; the firm admin and the lead read it.
      pulse: client && data.project.state !== "draft" ? await getPulse(tx, principal, id) : null,
    };
  });
  const [t, tPlan, ts, tVis, tKind, tPrio, tStatus, tMeeting, tRun, tMetrics, tInsight, tExport, tImport, tPh, tE, tClose, format] = await Promise.all([
    getTranslations("project"),
    getTranslations("plan"),
    getTranslations("staffing"),
    getTranslations("visibility"),
    getTranslations("kind"),
    getTranslations("priority"),
    getTranslations("status"),
    getTranslations("meeting"),
    getTranslations("assessment.run"),
    getTranslations("metrics"),
    getTranslations("insight"),
    getTranslations("exports"),
    getTranslations("planImport"),
    getTranslations("phases"),
    getTranslations("engagements"),
    getTranslations("closure"),
    getFormatter(),
  ]);
  const ar = (await getLocale()) === "ar";
  const { project } = data;
  // A new recommendation's department and accountable person (F31).
  const recScope = { departments: plan?.departments ?? [], accountables: plan?.accountables ?? [] };
  // A new or corrected recommendation answers a live finding only.
  const liveFindings = data.findings.filter((f) => !f.withdrawnAt).map((x) => ({ id: x.id, title: x.title }));

  return (
    <>
      <PageHeader
        title={project.title}
        description={project.description ?? undefined}
        meta={
          <>
            {/* The client's own people know whose project it is. */}
            {firmStaff ? (
              <Badge variant={project.kind === "internal" ? "secondary" : "outline"}>
                {tKind(project.kind)}
                {project.kind === "client" ? ` · ${(ar ? project.orgNameAr : null) ?? project.orgName}` : ""}
              </Badge>
            ) : null}
            {observing ? (
              <Badge variant="outline" className="gap-1" title={ts("observingHint")}>
                <Eye className="size-3" />
                {ts("observerBadge")}
              </Badge>
            ) : null}
          </>
        }
      >
        {team?.can.edit ? (
          <FormDialog
            trigger={
              <Button size="sm" variant="outline">
                <Pencil />
                {tPh("edit")}
              </Button>
            }
            title={tPh("edit")}
            endpoint={`/api/projects/${project.id}`}
            method="PATCH"
            sendEmptyAsNull
            fields={[
              { name: "title", label: tPh("title"), required: true, maxLength: 200, defaultValue: project.title },
              { name: "description", label: tPh("description"), type: "textarea", maxLength: 2000, defaultValue: project.description ?? undefined },
              ...(project.kind === "client"
                ? [
                    { name: "sequence", label: tPh("sequence"), maxLength: 2, dir: "ltr" as const, defaultValue: project.sequence?.toString() },
                    { name: "plannedWorkingDays", label: tPh("plannedDays"), maxLength: 4, dir: "ltr" as const, defaultValue: project.plannedWorkingDays?.toString() },
                  ]
                : []),
              { name: "startDate", label: tPh("start"), type: "date" as const, defaultValue: project.startDate ?? undefined },
              { name: "endDate", label: tPh("end"), type: "date" as const, defaultValue: project.endDate ?? undefined },
              ...(project.kind === "client" && team.siblings.length
                ? [
                    {
                      name: "followsProjectId",
                      label: tPh("followsField"),
                      type: "select" as const,
                      defaultValue: project.followsProjectId ?? NO_PREVIOUS,
                      options: [{ value: NO_PREVIOUS, label: tPh("followsNone") }, ...team.siblings.map((p) => ({ value: p.id, label: p.title }))],
                    },
                  ]
                : []),
            ]}
            submitLabel={tPh("save")}
          />
        ) : null}
        {team?.can.watch ? (
          <ApiButton
            endpoint={`/api/projects/${project.id}/watch`}
            method="PUT"
            body={{ on: !team.watching }}
            label={team.watching ? ts("unwatch") : ts("watch")}
            icon={team.watching ? <EyeOff /> : <Eye />}
            title={ts("watchHint")}
          />
        ) : null}
      </PageHeader>
      {project.kind === "internal" ? (
        <p className="flex items-center gap-2 rounded-lg bg-muted px-4 py-2 text-sm text-muted-foreground">
          <Lock className="size-4" />
          {t("internalBanner")}
        </p>
      ) : null}
      {project.state === "draft" ? (
        <p className="flex items-center gap-2 rounded-lg bg-muted px-4 py-2 text-sm text-muted-foreground">
          <FilePenLine className="size-4" />
          {tE("draftBanner")}
        </p>
      ) : project.engagementId ? (
        <p className="text-sm text-muted-foreground">
          {tE("underEngagement")}{" "}
          <Link href={`/engagements/${project.engagementId}`} className="font-medium text-foreground hover:underline" dir="auto">
            {project.engagementTitle}
          </Link>
        </p>
      ) : null}

      {project.state === "closing" || project.state === "closed" ? (
        <p className="flex items-center gap-2 rounded-lg bg-muted px-4 py-2 text-sm text-muted-foreground">
          <Lock className="size-4" />
          {project.state === "closed" ? tClose("bannerClosed") : tClose("bannerClosing")}
        </p>
      ) : null}

      {visit ? <SinceLastVisit projectId={project.id} {...visit} /> : null}

      <Tabs defaultValue={tab && TABS.includes(tab) ? tab : "recs"} className="gap-4">
        {/* Up to ten tabs: scroll inside the bar at tablet width rather than widen the page. */}
        <TabsList className="max-w-full justify-start overflow-x-auto">
          <TabsTrigger value="recs">{t("recommendations")}</TabsTrigger>
          {metrics ? <TabsTrigger value="progress">{tMetrics("tab")}</TabsTrigger> : null}
          {deviations ? (
            <TabsTrigger value="attention">
              {tInsight("deviations.tab")}
              {deviations.length ? <span className="text-xs text-muted-foreground tabular-nums">{new Set(deviations.map((d) => d.entityId)).size}</span> : null}
            </TabsTrigger>
          ) : null}
          {trace ? <TabsTrigger value="trace">{tInsight("trace.tab")}</TabsTrigger> : null}
          {meetings ? <TabsTrigger value="meetings">{t("meetings")}</TabsTrigger> : null}
          {assessments ? <TabsTrigger value="assessments">{t("assessments")}</TabsTrigger> : null}
          {requests ? <TabsTrigger value="requests">{t("requests")}</TabsTrigger> : null}
          <TabsTrigger value="docs">{t("documents")}</TabsTrigger>
          <TabsTrigger value="activity">{t("activity")}</TabsTrigger>
          {team || people || roles ? <TabsTrigger value="team">{ts("projectTeam")}</TabsTrigger> : null}
          {closure ? <TabsTrigger value="closing">{tClose("tab")}</TabsTrigger> : null}
        </TabsList>

        <TabsContent value="recs" className="space-y-6">
          {data.findings.length || plan?.can.finding ? (
            <section className="space-y-3">
              <SectionHeader title={tPlan("findings.title")} description={tPlan("findings.hint")}>
                {plan?.can.finding ? (
                  <FormDialog
                    trigger={
                      <Button size="sm" variant="outline">
                        <Plus />
                        {tPlan("findings.add")}
                      </Button>
                    }
                    title={tPlan("findings.add")}
                    description={tPlan("findings.addHint")}
                    endpoint={`/api/projects/${project.id}/findings`}
                    fields={[
                      { name: "title", label: tPlan("findings.field"), required: true, maxLength: 300 },
                      { name: "description", label: tPlan("findings.description"), type: "textarea", maxLength: 8000 },
                      ...(project.kind === "client"
                        ? [
                            {
                              name: "visibility",
                              label: tPlan("findings.visibility"),
                              type: "select" as const,
                              required: true,
                              options: [
                                { value: "shared", label: tVis("shared") },
                                { value: "firm_private", label: tVis("firm_private") },
                              ],
                            },
                          ]
                        : []),
                    ]}
                    submitLabel={tPlan("findings.add")}
                  />
                ) : null}
              </SectionHeader>
              {data.findings.length === 0 ? (
                <EmptyState icon={<SearchCheck />} description={tPlan("findings.none")} className="py-6 md:py-6" />
              ) : (
                <ul className="divide-y rounded-xl border bg-card shadow-xs">
                  {data.findings.map((f) => {
                    const answeredBy = data.recommendations.filter((r) => r.findingId === f.id && !r.withdrawnAt).length;
                    return (
                      <li key={f.id} className={cn("flex flex-wrap items-start gap-3 px-4 py-3 text-sm", f.withdrawnAt && "bg-muted/40")}>
                        <div className="min-w-0 flex-1 space-y-1">
                          <p className={cn("font-medium", f.withdrawnAt && "text-muted-foreground line-through")} dir="auto">
                            {f.title}
                          </p>
                          {f.description ? (
                            <p className="whitespace-pre-wrap text-muted-foreground" dir="auto">
                              {f.description}
                            </p>
                          ) : null}
                          {f.withdrawnAt ? (
                            <p className="text-xs text-muted-foreground">
                              {tPlan("changes.withdrawnOn", { date: format.dateTime(f.withdrawnAt, { dateStyle: "medium" }) })}{" "}
                              <span dir="auto">{f.withdrawnReason}</span>
                            </p>
                          ) : (
                            <p className="text-xs text-muted-foreground">
                              {tPlan("findings.answeredBy", { n: answeredBy })}
                              {f.fromAssessment ? ` · ${tPlan("findings.fromAssessment")}` : ""}
                            </p>
                          )}
                        </div>
                        {f.withdrawnAt ? <Badge variant="outline">{tPlan("changes.withdrawnBadge")}</Badge> : null}
                        {f.visibility === "firm_private" ? (
                          <Badge variant="outline" className="gap-1">
                            <Lock className="size-3" />
                            {tVis("firm_private")}
                          </Badge>
                        ) : null}
                        <RecordActions kind="finding" id={f.id} title={f.title} can={f.can} values={{ title: f.title, description: f.description }} />
                        {plan?.can.recommendation && !f.withdrawnAt ? (
                          <RecommendationDialog
                            projectId={project.id}
                            client={project.kind === "client"}
                            scope={recScope}
                            findings={liveFindings}
                            defaultFindingId={f.id}
                            trigger={
                              <Button size="sm" variant="ghost">
                                <Plus />
                                {tPlan("rec.add")}
                              </Button>
                            }
                          />
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          ) : null}

          <section className="space-y-3">
            <SectionHeader title={t("recommendations")}>
              <div className="flex flex-wrap items-center gap-2">
                {data.recommendations.length || data.findings.length ? (
                  <ExportButton endpoint={`/api/projects/${project.id}/export`} label={tExport("excel")} title={tExport("downloadExcel")} />
                ) : null}
                {plan?.can.finding && plan.can.recommendation && plan.can.action ? (
                  <Button size="sm" variant="outline" asChild>
                    <Link href={`/projects/${project.id}/import`}>
                      <Upload />
                      {tImport("button")}
                    </Link>
                  </Button>
                ) : null}
                {plan?.can.recommendation && data.recommendations.length ? (
                  <RecommendationDialog
                    projectId={project.id}
                    client={project.kind === "client"}
                    scope={recScope}
                    findings={liveFindings}
                    trigger={
                      <Button size="sm">
                        <Plus />
                        {tPlan("rec.add")}
                      </Button>
                    }
                  />
                ) : null}
              </div>
            </SectionHeader>
            {data.recommendations.length === 0 ? (
              <EmptyState
                icon={<ClipboardList />}
                description={t("noRecs")}
                action={
                  plan?.can.recommendation ? (
                    <RecommendationDialog
                      projectId={project.id}
                      client={project.kind === "client"}
                      scope={recScope}
                      findings={liveFindings}
                      trigger={
                        <Button size="sm">
                          <Plus />
                          {tPlan("rec.add")}
                        </Button>
                      }
                    />
                  ) : undefined
                }
              />
            ) : null}
            {data.recommendations.map((r) => {
              const finding = r.findingId ? data.findings.find((f) => f.id === r.findingId) : null;
              const openActions = r.actions.filter((a) => a.status !== "draft" && a.status !== "verified_complete" && a.status !== "closed").length;
              return (
                <Card key={r.id} className={cn("gap-4 py-5 shadow-xs", r.withdrawnAt && "bg-muted/40")}>
                  <CardHeader className="px-5">
                    <div className="flex flex-wrap items-center gap-2">
                      <CardTitle className={cn("text-base", r.withdrawnAt && "text-muted-foreground line-through")}>
                        <Link href={`/recommendations/${r.id}`} className="hover:underline" dir="auto">
                          {r.title}
                        </Link>
                      </CardTitle>
                      {r.withdrawnAt ? <Badge variant="outline">{tPlan("changes.withdrawnBadge")}</Badge> : null}
                      {r.stance ? <StanceBadge stance={r.stance} /> : null}
                      <Badge variant="outline">
                        {t("priority")}: {tPrio(r.priority)}
                      </Badge>
                      {r.source !== "consultant" ? <Badge variant="outline">{tPlan(`rec.sources.${r.source}`)}</Badge> : null}
                      {r.visibility === "firm_private" ? (
                        <Badge variant="outline" className="gap-1">
                          <Lock className="size-3" />
                          {tVis("firm_private")}
                        </Badge>
                      ) : null}
                      {r.department ? <Badge variant="secondary">{localLabel(r.department, ar)}</Badge> : null}
                      {firmStaff ? (
                        <span className="ms-auto flex items-center gap-1">
                          {plan?.can.action && !r.withdrawnAt ? (
                            <ActionDialog
                              recommendationId={r.id}
                              recommendationTitle={r.title}
                              options={{
                                owners: plan.owners,
                                ownerByName: plan.ownerByName,
                                minimalRecords: plan.minimalRecords,
                                departments: plan.departments,
                                canRelease: plan.can.release,
                              }}
                              recommendationDepartmentId={r.departmentId}
                              trigger={
                                <Button size="sm" variant="outline">
                                  <Plus />
                                  {tPlan("action.add")}
                                </Button>
                              }
                            />
                          ) : null}
                          {r.withdrawnAt ? null : <AskAbout projectId={project.id} type="recommendation" id={r.id} size="icon-sm" />}
                          <RecordActions
                            kind="recommendation"
                            id={r.id}
                            title={r.title}
                            can={r.can}
                            openActions={openActions}
                            projectId={project.id}
                            client={project.kind === "client"}
                            findings={liveFindings}
                            scope={recScope}
                            values={{
                              title: r.title,
                              findingId: r.findingId,
                              rationale: r.rationale,
                              targetOutcome: r.targetOutcome,
                              priority: r.priority,
                              dueDate: r.dueDate,
                              requiredEvidence: r.requiredEvidence,
                              departmentId: r.departmentId,
                              accountableUserId: r.accountableUserId,
                            }}
                          />
                        </span>
                      ) : null}
                    </div>
                    {r.withdrawnAt ? (
                      <p className="text-xs text-muted-foreground">
                        {tPlan("changes.withdrawnOn", { date: format.dateTime(r.withdrawnAt, { dateStyle: "medium" }) })}{" "}
                        <span dir="auto">{r.withdrawnReason}</span>
                      </p>
                    ) : null}
                    {finding ? (
                      <p className="text-xs text-muted-foreground" dir="auto">
                        {tPlan("rec.answers", { finding: finding.title })}
                      </p>
                    ) : null}
                    {r.accountableName ? (
                      <p className="text-xs text-muted-foreground">{tPlan.rich("rec.accountableLine", { name: r.accountableName, who: (c) => <bdi>{c}</bdi> })}</p>
                    ) : null}
                    {r.rationale ? (
                      <Translatable entityType="recommendation" entityId={r.id} field="rationale" text={r.rationale} canReview={firmStaff} className="text-sm text-muted-foreground" />
                    ) : null}
                    {r.requiredEvidence ? (
                      <p className="text-xs text-muted-foreground">
                        <span className="font-medium text-foreground">{t("requiredEvidence")}:</span> {r.requiredEvidence}
                      </p>
                    ) : null}
                  </CardHeader>
                  <CardContent className="px-5">
                    <ActionsTable rows={r.actions.map((a) => ({ ...a, overdue: isOverdue(a) }))} empty="—" showProject={false} />
                  </CardContent>
                </Card>
              );
            })}
          </section>
        </TabsContent>

        {meetings ? (
          <TabsContent value="meetings" className="space-y-4">
            {invitees ? (
              <div className="flex justify-end">
                <MeetingForm
                  projectId={project.id}
                  firm={firmStaff}
                  invitees={invitees}
                  me={me}
                  departments={firmStaff ? recScope.departments.map((d) => ({ id: d.id, label: localLabel(d, ar) })) : undefined}
                  trigger={
                    <Button size="sm">
                      <CalendarPlus />
                      {tMeeting("book")}
                    </Button>
                  }
                />
              </div>
            ) : null}
            {meetings.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("noMeetings")}</p>
            ) : (
              <ul className="divide-y rounded-xl border bg-card">
                {meetings.map((m) => (
                  <li key={m.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
                    <CalendarDays className="size-4 text-muted-foreground" />
                    <Link href={`/meetings/${m.id}`} className="font-medium hover:underline">
                      {m.title}
                    </Link>
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {format.dateTime(m.startsAt, { dateStyle: "medium", timeStyle: "short" })}
                    </span>
                    <Badge variant="outline" className="ms-auto">
                      {tMeeting(`status.${m.status}`)}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </TabsContent>
        ) : null}

        {assessments ? (
          <TabsContent value="assessments" className="space-y-4">
            {templates ? (
              <div className="flex justify-end">
                <StartAssessment
                  projectId={project.id}
                  templates={templates.map((x) => ({ id: x.id, label: localName(x, ar) }))}
                />
              </div>
            ) : null}
            {assessments.length === 0 ? (
              <p className="text-sm text-muted-foreground">{firmStaff ? t("noAssessments") : t("noAssessmentsClient")}</p>
            ) : (
              <ul className="divide-y rounded-xl border bg-card">
                {assessments.map((x) => (
                  <li key={x.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
                    <ClipboardList className="size-4 text-muted-foreground" />
                    <Link href={`/assessments/${x.id}`} className="font-medium hover:underline">
                      {x.title}
                    </Link>
                    <span className="text-xs text-muted-foreground">
                      {(ar ? x.templateNameAr : null) ?? x.templateName} · v{x.version} ·{" "}
                      {format.dateTime(x.createdAt, { dateStyle: "medium" })}
                    </span>
                    <span className="ms-auto flex items-center gap-2">
                      {x.total ? (
                        <span className="text-xs text-muted-foreground tabular-nums">
                          {x.total.pct === null ? "—" : `${x.total.pct}%`} · {tRun("gapsCount", { n: x.total.gaps })}
                        </span>
                      ) : null}
                      {firmStaff && x.sharedWithClient ? <Badge variant="outline">{tRun("sharedWithClient")}</Badge> : null}
                      <Badge variant={x.status === "draft" ? "outline" : "secondary"}>{tRun(`status.${x.status}`)}</Badge>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </TabsContent>
        ) : null}

        {metrics ? (
          <TabsContent value="progress" className="space-y-6">
            <HandoverCard projectId={project.id} data={handover} />
            <ProgressTab projectId={project.id} data={metrics} reports={reports} firm={firmStaff} />
          </TabsContent>
        ) : null}

        {closure ? (
          <TabsContent value="closing" className="space-y-6">
            {/* The client sees the pulse first, as the one thing asked of them; the firm after the closing record. */}
            {pulse && !firmStaff ? <PulseSection projectId={project.id} data={pulse} /> : null}
            <ClosureTab projectId={project.id} data={closure} />
            {pulse && firmStaff ? <PulseSection projectId={project.id} data={pulse} /> : null}
          </TabsContent>
        ) : null}

        {deviations ? (
          <TabsContent value="attention">
            <Deviations rows={deviations} />
          </TabsContent>
        ) : null}
        {trace ? (
          <TabsContent value="trace">
            <Trace rows={trace} />
          </TabsContent>
        ) : null}

        {requests ? (
          <TabsContent value="requests">
            <InfoRequestsTab projectId={project.id} list={requests} />
          </TabsContent>
        ) : null}

        <TabsContent value="docs">
          {data.documents.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("noDocs")}</p>
          ) : (
            <ul className="divide-y rounded-xl border bg-card">
              {data.documents.map((d) => (
                <li key={d.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
                  <FileText className="size-4 text-muted-foreground" />
                  <a href={`/api/documents/${d.id}/download`} className="font-medium hover:underline">
                    {d.title}
                  </a>
                  <span className="text-xs text-muted-foreground">
                    {t("version")} {d.version}
                  </span>
                  <Badge variant={d.visibility === "shared" ? "secondary" : "outline"} className="ms-auto">
                    {tVis(d.visibility)}
                  </Badge>
                  {d.aiIndexable ? (
                    <Badge variant="outline" className="gap-1">
                      <Bot className="size-3" />
                      {t("aiIndexed")}
                    </Badge>
                  ) : null}
                  {firmStaff && d.aiIndexable ? <TextStatusBadge status={d.textStatus} /> : null}
                  {firmStaff && d.aiIndexable ? <DocumentSummary documentId={d.id} title={d.title} /> : null}
                  {firmStaff && d.aiIndexable ? <AskAbout projectId={project.id} type="document" id={d.id} size="icon-sm" /> : null}
                  <FileActions id={d.id} title={d.title} visibility={d.visibility} aiIndexable={d.aiIndexable} can={d.can} />
                </li>
              ))}
            </ul>
          )}
        </TabsContent>

        <TabsContent value="activity">
          {data.activity.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("noActivity")}</p>
          ) : (
            <ol className="space-y-3 border-s ps-4">
              {data.activity.map((e) => (
                <li key={e.id} className="text-sm">
                  <span className="font-medium">{e.actorName ?? "—"}</span>{" "}
                  {/* Only an action's states are action statuses; files and assessments have their own events. */}
                  {e.entityType === "action" && e.fromState && e.toState
                    ? t("changed", { from: tStatus(e.fromState as never), to: tStatus(e.toState as never) })
                    : t.has(`events.${e.event}`)
                      ? t(`events.${e.event}` as never)
                      : e.event}
                  <div className="text-xs text-muted-foreground">{format.dateTime(e.createdAt, { dateStyle: "medium", timeStyle: "short" })}</div>
                </li>
              ))}
            </ol>
          )}
        </TabsContent>
        {team || people || roles ? (
          <TabsContent value="team" className={team && people ? "grid gap-6 lg:grid-cols-2" : "flex flex-col gap-6"}>
            {team ? (
            <Card className="gap-4 py-5 shadow-xs">
              <CardHeader className="flex flex-row items-start justify-between gap-4 px-5">
                <div className="space-y-1.5">
                  <CardTitle className="text-base">{ts("firmStaff")}</CardTitle>
                  <CardDescription>{project.kind === "client" ? ts("staffHintClient") : ts("staffHintInternal")}</CardDescription>
                </div>
                {team.can.manage ? (
                  team.candidates.length ? (
                    <FormDialog
                      trigger={
                        <Button size="sm">
                          <UserPlus />
                          {ts("staff")}
                        </Button>
                      }
                      title={ts("staff")}
                      description={project.kind === "client" ? ts("staffHintClient") : ts("staffHintInternal")}
                      endpoint={`/api/projects/${project.id}/members`}
                      fields={[
                        {
                          name: "userId",
                          label: ts("consultant"),
                          type: "select",
                          required: true,
                          options: team.candidates.map((c) => ({ value: c.userId, label: `${c.name} · ${c.email}` })),
                        },
                        {
                          name: "as",
                          label: ts("staffAs"),
                          type: "select",
                          required: true,
                          defaultValue: "member",
                          options: [
                            { value: "member", label: ts("staffAsMember") },
                            { value: "observer", label: ts("staffAsObserver") },
                          ],
                        },
                      ]}
                      submitLabel={ts("add")}
                    />
                  ) : (
                    <span className="text-xs text-muted-foreground">{ts("noCandidatesProject")}</span>
                  )
                ) : null}
              </CardHeader>
              <CardContent className="divide-y px-5">
                {team.clientLead && !team.firm.some((m) => m.userId === team.clientLead!.userId) ? (
                  <div className="py-3">
                    <p className="flex items-center gap-2 text-sm font-medium">
                      {team.clientLead.name}
                      <Badge variant="outline" className="gap-1 border-transparent bg-accent text-accent-foreground">
                        <Crown className="size-3" />
                        {ts("clientLeadBadge")}
                      </Badge>
                    </p>
                    <p className="text-xs text-muted-foreground">{team.clientLead.email}</p>
                  </div>
                ) : null}
                {team.clientDeputy && !team.firm.some((m) => m.userId === team.clientDeputy!.userId) ? (
                  <div className="py-3">
                    <p className="flex items-center gap-2 text-sm font-medium">
                      {team.clientDeputy.name}
                      <Badge variant="outline" className="gap-1">
                        <UserCheck className="size-3" />
                        {ts("clientDeputyBadge")}
                      </Badge>
                    </p>
                    <p className="text-xs text-muted-foreground">{team.clientDeputy.email}</p>
                  </div>
                ) : null}
                {team.firm.length === 0 && !team.clientLead ? <p className="py-2 text-sm text-muted-foreground">{ts("noStaff")}</p> : null}
                {team.firm.map((m) => (
                  <div key={m.userId} className="flex items-center gap-3 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-2 text-sm font-medium">
                        {m.name}
                        {m.isLead ? (
                          <Badge variant="outline" className="gap-1 border-transparent bg-accent text-accent-foreground">
                            <Crown className="size-3" />
                            {ts("leadBadge")}
                          </Badge>
                        ) : null}
                        {m.userId === team.clientDeputy?.userId ? (
                          <Badge variant="outline" className="gap-1">
                            <UserCheck className="size-3" />
                            {ts("clientDeputyBadge")}
                          </Badge>
                        ) : null}
                        {m.observer ? (
                          <Badge variant="outline" className="gap-1">
                            <Eye className="size-3" />
                            {ts("observerBadge")}
                          </Badge>
                        ) : null}
                      </p>
                      <p className="text-xs text-muted-foreground">{m.email}</p>
                    </div>
                    {team.can.manage && !m.isLead ? (
                      <ApiButton
                        endpoint={`/api/projects/${project.id}/members/${m.userId}`}
                        method="DELETE"
                        label={ts("remove")}
                        variant="ghost"
                        confirm={ts("unstaffConfirm")}
                      />
                    ) : null}
                  </div>
                ))}
              </CardContent>
            </Card>
            ) : null}
            {people ? <ProjectPeople projectId={project.id} clientId={project.orgId} firm={firmStaff} data={people} /> : null}
            {roles ? <ClientRolesCard projectId={project.id} data={roles} /> : null}
          </TabsContent>
        ) : null}
      </Tabs>
    </>
  );
}
