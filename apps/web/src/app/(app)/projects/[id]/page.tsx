import { CalendarDays, CalendarPlus, ClipboardList, SearchCheck, UserPlus } from "lucide-react";
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
import { PageHeader } from "@/components/page-header";
import { SectionHeader } from "@/components/section-header";
import { Translatable } from "@/components/translatable";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { withPrincipal } from "@/server/page";
import { listAssessments, listTemplates } from "@/services/assessments";
import { listReports, projectMetrics, projectProgress } from "@/services/follow-through";
import { getHandover } from "@/services/handover";
import { projectDeviations, projectTrace, sinceLastVisit } from "@/services/insight";
import { listMeetings, meetingInvitees } from "@/services/meetings";
import { planOptions } from "@/services/plan";
import { getProject, isOverdue } from "@/services/queries";
import { getProjectTeam } from "@/services/staffing";
import { StartAssessment } from "../../assessments/[id]/assessment-panels";
import { DocumentSummary, TextStatusBadge } from "./document-summary";
import { HandoverCard } from "./handover-card";
import { Deviations, SinceLastVisit, Trace } from "./insight";
import { ActionDialog, RecommendationDialog } from "./plan-dialogs";
import { ProgressTab } from "./progress-tab";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const { data, plan, team, firmStaff, meetings, invitees, me, assessments, templates, metrics, reports, visit, deviations, trace, handover } = await withPrincipal(async (tx, principal) => {
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
      firmStaff: principal.orgKind === "firm",
      // Roles that can't read meetings simply get no tab.
      meetings: await listMeetings(tx, principal, id).catch(() => null),
      // Who may book: the list of people to invite, or null.
      invitees: await meetingInvitees(tx, principal, id).catch(() => null),
      me: principal.userId,
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
    };
  });
  const [t, tPlan, ts, tVis, tKind, tPrio, tStatus, tMeeting, tRun, tMetrics, tInsight, tExport, tImport, format] = await Promise.all([
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
    getFormatter(),
  ]);
  const ar = (await getLocale()) === "ar";
  const { project } = data;

  return (
    <>
      <PageHeader
        title={project.title}
        description={project.description ?? undefined}
        meta={
          <Badge variant={project.kind === "internal" ? "secondary" : "outline"}>
            {tKind(project.kind)}
            {project.kind === "client" ? ` · ${(ar ? project.orgNameAr : null) ?? project.orgName}` : ""}
          </Badge>
        }
      >
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

      {visit ? <SinceLastVisit projectId={project.id} {...visit} /> : null}

      <Tabs defaultValue="recs" className="gap-4">
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
          <TabsTrigger value="docs">{t("documents")}</TabsTrigger>
          <TabsTrigger value="activity">{t("activity")}</TabsTrigger>
          {team ? <TabsTrigger value="team">{ts("projectTeam")}</TabsTrigger> : null}
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
                    const answeredBy = data.recommendations.filter((r) => r.findingId === f.id).length;
                    return (
                      <li key={f.id} className="flex flex-wrap items-start gap-3 px-4 py-3 text-sm">
                        <div className="min-w-0 flex-1 space-y-1">
                          <p className="font-medium" dir="auto">
                            {f.title}
                          </p>
                          {f.description ? (
                            <p className="whitespace-pre-wrap text-muted-foreground" dir="auto">
                              {f.description}
                            </p>
                          ) : null}
                          <p className="text-xs text-muted-foreground">
                            {tPlan("findings.answeredBy", { n: answeredBy })}
                            {f.fromAssessment ? ` · ${tPlan("findings.fromAssessment")}` : ""}
                          </p>
                        </div>
                        {f.visibility === "firm_private" ? (
                          <Badge variant="outline" className="gap-1">
                            <Lock className="size-3" />
                            {tVis("firm_private")}
                          </Badge>
                        ) : null}
                        {plan?.can.recommendation ? (
                          <RecommendationDialog
                            projectId={project.id}
                            client={project.kind === "client"}
                            findings={data.findings.map((x) => ({ id: x.id, title: x.title }))}
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
                    findings={data.findings.map((x) => ({ id: x.id, title: x.title }))}
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
                      findings={data.findings.map((x) => ({ id: x.id, title: x.title }))}
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
              return (
                <Card key={r.id} className="gap-4 py-5 shadow-xs">
                  <CardHeader className="px-5">
                    <div className="flex flex-wrap items-center gap-2">
                      <CardTitle className="text-base">{r.title}</CardTitle>
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
                      {firmStaff ? (
                        <span className="ms-auto flex items-center gap-1">
                          {plan?.can.action ? (
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
                              trigger={
                                <Button size="sm" variant="outline">
                                  <Plus />
                                  {tPlan("action.add")}
                                </Button>
                              }
                            />
                          ) : null}
                          <AskAbout projectId={project.id} type="recommendation" id={r.id} size="icon-sm" />
                        </span>
                      ) : null}
                    </div>
                    {finding ? (
                      <p className="text-xs text-muted-foreground" dir="auto">
                        {tPlan("rec.answers", { finding: finding.title })}
                      </p>
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
                  templates={templates.map((x) => ({ id: x.id, label: (ar ? x.nameAr : null) ?? x.name }))}
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
                  {e.fromState && e.toState
                    ? t("changed", { from: tStatus(e.fromState as never), to: tStatus(e.toState as never) })
                    : e.event}
                  <div className="text-xs text-muted-foreground">{format.dateTime(e.createdAt, { dateStyle: "medium", timeStyle: "short" })}</div>
                </li>
              ))}
            </ol>
          )}
        </TabsContent>
        {team ? (
          <TabsContent value="team" className="grid gap-6 lg:grid-cols-2">
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
            {project.kind === "client" ? (
              <Card className="h-fit gap-4 py-5 shadow-xs">
                <CardHeader className="px-5">
                  <CardTitle className="text-base">{ts("clientUsers")}</CardTitle>
                </CardHeader>
                <CardContent className="divide-y px-5">
                  {team.client.length === 0 ? <p className="py-2 text-sm text-muted-foreground">{ts("noStaff")}</p> : null}
                  {team.client.map((m) => (
                    <div key={m.userId} className="py-3">
                      <p className="text-sm font-medium">{m.name}</p>
                      <p className="text-xs text-muted-foreground">{m.email}</p>
                    </div>
                  ))}
                </CardContent>
              </Card>
            ) : null}
          </TabsContent>
        ) : null}
      </Tabs>
    </>
  );
}
