import { CalendarDays, CalendarPlus, ClipboardList, ClipboardPen, FilePenLine, UserCheck, UserPlus } from "lucide-react";
import { MorphTitle } from "@/components/morph";
import { Bot } from "@/components/animate-ui/icons/bot";
import { Crown } from "@/components/animate-ui/icons/crown";
import { Eye } from "@/components/animate-ui/icons/eye";
import { FileText } from "@/components/animate-ui/icons/file-text";
import { Lock } from "@/components/animate-ui/icons/lock";
import { Plus } from "@/components/animate-ui/icons/plus";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { FormDialog, type Field } from "@/components/form-dialog";
import { MeetingForm } from "@/components/meeting-form";
import { AskAbout } from "@/components/ask-about";
import { EmptyState } from "@/components/empty-state";
import { AddFileDialog } from "@/components/file-explorer";
import { FileActions } from "@/components/file-actions";
import { AudienceMarker } from "@/components/audience-marker";
import { PageHeader } from "@/components/page-header";
import { SectionHeader } from "@/components/section-header";
import { StanceBadge } from "@/components/stance-badge";
import { Translatable } from "@/components/translatable";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { buttonVariants } from "@/components/ui/button-variants";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { actionsHref } from "@/lib/action-filters";
import { firmRun } from "@/lib/engagement";
import { isUuid } from "@/lib/ids";
import { localLabel, localName } from "@/lib/names";
import { NO_PREVIOUS } from "@/lib/phases";
import { parsePlanRule, PLAN_RULES, type PlanRule } from "@/lib/plan-rules";
import { isOldTab, oldTabTarget, openTab, projectTabHref } from "@/lib/project-tabs";
import { cn } from "@/lib/utils";
import { withPrincipal } from "@/server/page";
import { isOverdue } from "@/services/queries";
import { loadProjectPage } from "@/services/project-page";
import { StartAssessment } from "../../assessments/[id]/assessment-panels";
import { ProjectPeople } from "./project-people";
import { DocumentSummary, TextStatusBadge } from "./document-summary";
import { ClientRolesCard } from "./client-roles-card";
import { ClosureTab } from "./closure-tab";
import { PulseSection } from "./pulse-section";
import { CaseStudySection } from "./case-study-section";
import { HandoverCard } from "./handover-card";
import { InfoRequestsTab } from "./info-requests-tab";
import { SinceLastVisit } from "./insight";
import { ActionDialog, RecommendationDialog } from "./plan-dialogs";
import { PlanActions } from "./plan-actions";
import { PlanAdd } from "./plan-add";
import { ProjectMenu, RemoveFromProject } from "./project-menu";
import { RecordActions } from "./record-actions";
import { ProgressTab } from "./progress-tab";

// The project page around its plan (page audit 4.3, batch 3): five tabs,
// Plan · Requests and files · Meetings · Progress · People, and Closing while
// it is needed. What each holds, and which the reader gets, is decided in
// services/project-page.ts and lib/project-tabs.ts.

export default async function ProjectPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string; rule?: string }>;
}) {
  const { id } = await params;
  // A link may open a tab (a notification about a request opens Requests and files), and Plan may be filtered by a rule.
  const { tab, rule: ruleParam } = await searchParams;
  if (!isUuid(id)) notFound();
  // An old address (the eleven tabs before batch 3, lib/project-tabs.ts OLD_TABS) goes on to its new place
  // before anything is loaded: only the reader's side is needed (where Assessments went differs by side).
  if (isOldTab(tab)) {
    const firm = await withPrincipal(async (_tx, principal) => principal.orgKind === "firm");
    const moved = oldTabTarget(tab, firm);
    if (moved) redirect(projectTabHref(id, moved));
  }
  const page = await withPrincipal((tx, principal) => loadProjectPage(tx, principal, id));
  const { data, plan, team, people, roles, consultants, firmStaff, reassign, meetings, invitees, me, observing, assessments, templates, metrics, reports, visit, handover } =
    page;
  const { requests, closure, pulse, caseStudy, attention, evidence, upload, tabs } = page;
  const current = openTab(tab, tabs);

  const [t, tPlan, tp, ts, tVis, tKind, tPrio, tStatus, tMeeting, tRun, tPh, tE, tClose, format] = await Promise.all([
    getTranslations("project"),
    getTranslations("plan"),
    getTranslations("projectPage"),
    getTranslations("staffing"),
    getTranslations("visibility"),
    getTranslations("kind"),
    getTranslations("priority"),
    getTranslations("status"),
    getTranslations("meeting"),
    getTranslations("assessment.run"),
    getTranslations("phases"),
    getTranslations("engagements"),
    getTranslations("closure"),
    getFormatter(),
  ]);
  const [tEng, tc] = await Promise.all([getTranslations("engagement"), getTranslations("common")]);
  const ar = (await getLocale()) === "ar";
  const { project } = data;
  const day = (d: string | Date) => format.dateTime(new Date(d), { dateStyle: "medium" });
  // A new recommendation's department and accountable person (F31).
  const recScope = { departments: plan?.departments ?? [], accountables: plan?.accountables ?? [] };
  // A new or corrected recommendation answers a live finding only.
  const liveFindings = data.findings.filter((f) => !f.withdrawnAt).map((x) => ({ id: x.id, title: x.title }));
  // An activity line in the reader's words: the client reads "with your company", never "with the client" (page audit 4.7).
  const eventLabel = (key: string) =>
    !firmStaff && t.has(`eventsClient.${key}`) ? t(`eventsClient.${key}` as never) : t(`events.${key}` as never);

  // The rule chips the reader is offered (the service answered only theirs), and the one chosen.
  const offered = PLAN_RULES.filter((r) => attention.rules[r] !== undefined);
  const chosen = parsePlanRule(ruleParam, firmStaff);
  const rule: PlanRule | null = chosen && offered.includes(chosen) ? chosen : null;
  const onRule = new Set(rule ? attention.rules[rule] : []);
  const recommendations = !rule
    ? data.recommendations
    : rule === "disputed"
      ? data.recommendations.filter((r) => onRule.has(r.id))
      : data.recommendations
          .map((r) => ({ ...r, actions: r.actions.filter((a) => onRule.has(a.id)) }))
          .filter((r) => r.actions.length > 0);
  // Findings no recommendation the reader sees answers: a short group at the end of the plan (page audit 4.3).
  const answered = new Set(data.recommendations.flatMap((r) => (r.findingId ? [r.findingId] : [])));
  const unanswered = data.findings.filter((f) => !answered.has(f.id));
  const openRequests = requests ? requests.items.filter((i) => i.status === "requested").length : 0;

  // "Edit details", for the page's menu.
  const editFields: Field[] | null = team?.can.edit
    ? [
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
      ]
    : null;
  const closingTab = tabs.includes("closing");

  // One status line under the title (October review, item 4): counts, never a health word (D5), each a link to its list.
  const { status } = attention;
  const statusLine =
    status.of || status.late.n || status.waiting.n ? (
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground" aria-label={tp("status.label")}>
        {status.of ? (
          tabs.includes("progress") ? (
            <Link href={projectTabHref(project.id, "progress")} className="hover:text-foreground hover:underline">
              {tp("status.verified", { verified: status.verified, of: status.of, pct: `${Math.round(status.pct ?? 0)}%` })}
            </Link>
          ) : (
            <span>{tp("status.verified", { verified: status.verified, of: status.of, pct: `${Math.round(status.pct ?? 0)}%` })}</span>
          )
        ) : (
          <span>{tp(firmStaff ? "status.verifiedNone" : "status.verifiedNoneClient")}</span>
        )}
        <span aria-hidden>·</span>
        <Link href={status.late.href} className={cn("hover:underline", status.late.n ? "font-medium text-destructive" : "hover:text-foreground")}>
          {tp("status.late", { n: status.late.n })}
        </Link>
        <span aria-hidden>·</span>
        <Link href={status.waiting.href} className="hover:text-foreground hover:underline">
          {tp("status.waiting", { n: status.waiting.n })}
        </Link>
      </p>
    ) : null;

  const assessmentRows = (list: NonNullable<typeof assessments>) => (
    <ul className="divide-y rounded-xl border bg-card">
      {list.map((x) => (
        <li key={x.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
          <ClipboardList className="size-4 text-muted-foreground" />
          <Link href={`/assessments/${x.id}`} className="font-medium hover:underline">
            {x.title}
          </Link>
          <span className="text-xs text-muted-foreground">
            {(ar ? x.templateNameAr : null) ?? x.templateName} · v{x.version} · {day(x.createdAt)}
          </span>
          <span className="ms-auto flex items-center gap-2">
            {/* The firm's working view, in the assessment page's own words: gaps are suggested until a consultant confirms them. */}
            {x.total ? (
              <span className="flex items-center gap-1 text-xs text-muted-foreground tabular-nums" title={tRun("indicative")}>
                <Lock className="size-3" />
                {tRun("firmOnly")} · {x.total.pct === null ? "—" : `${x.total.pct}%`} · {tRun("gapsSuggested", { n: x.total.gaps, confirmed: x.total.confirmed })}
              </span>
            ) : null}
            {firmStaff && x.sharedWithClient ? <Badge variant="outline">{tRun("sharedWithClient")}</Badge> : null}
            <Badge variant={x.status === "draft" ? "outline" : "secondary"}>{tRun(`status.${x.status}`)}</Badge>
          </span>
        </li>
      ))}
    </ul>
  );

  return (
    <>
      <div className="space-y-1">
        <PageHeader
          title={project.title}
          morph={`project-${project.id}`}
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
          <ProjectMenu
            projectId={project.id}
            edit={editFields}
            watch={team?.can.watch ? { on: team.watching } : null}
            startClosing={!closingTab && !!closure?.can.start}
            askToClose={!closingTab && !!closure?.can.request}
          />
        </PageHeader>
        {statusLine}
      </div>
      {project.kind === "internal" ? (
        <p className="flex items-center gap-2 rounded-lg bg-muted px-4 py-2 text-sm text-muted-foreground">
          <Lock className="size-4" />
          {t("internalBanner")}
        </p>
      ) : null}
      {firmRun(project.kind, project.engagementMode) ? (
        <p className="flex items-center gap-2 rounded-lg bg-muted px-4 py-2 text-sm text-muted-foreground">
          <ClipboardPen className="size-4" />
          {tEng("recordsForClient")}
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
          {/* The banner leads to the Closing tab (page audit 4.3). */}
          <Link href={projectTabHref(project.id, "closing")} className="hover:text-foreground hover:underline">
            {project.state === "closed" ? tClose("bannerClosed") : tClose("bannerClosing")}
          </Link>
        </p>
      ) : null}

      {visit ? <SinceLastVisit projectId={project.id} {...visit} /> : null}

      <Tabs defaultValue={current} className="gap-4">
        <TabsList className="max-w-full justify-start overflow-x-auto">
          <TabsTrigger value="plan">{tp("tabs.plan")}</TabsTrigger>
          <TabsTrigger value="files">
            {tp("tabs.files")}
            {openRequests ? (
              <span className="text-xs text-muted-foreground tabular-nums" title={tp("openRequests", { n: openRequests })}>
                {openRequests}
              </span>
            ) : null}
          </TabsTrigger>
          {meetings ? <TabsTrigger value="meetings">{tp("tabs.meetings")}</TabsTrigger> : null}
          {tabs.includes("progress") ? <TabsTrigger value="progress">{tp("tabs.progress")}</TabsTrigger> : null}
          {tabs.includes("people") ? <TabsTrigger value="people">{tp("tabs.people")}</TabsTrigger> : null}
          {closingTab ? <TabsTrigger value="closing">{tClose("tab")}</TabsTrigger> : null}
        </TabsList>

        <TabsContent value="plan" className="space-y-6">
          {/* Sources (the firm's assessments on this project) at the top of the plan. */}
          {firmStaff && assessments && !rule && (assessments.length || templates) ? (
            <section className="space-y-3">
              <SectionHeader title={tp("sources.title")} description={tp("sources.hint")}>
                {templates ? (
                  <StartAssessment projectId={project.id} variant="outline" templates={templates.map((x) => ({ id: x.id, label: localName(x, ar) }))} />
                ) : null}
              </SectionHeader>
              {assessments.length ? assessmentRows(assessments) : <p className="text-sm text-muted-foreground">{tp("sources.none")}</p>}
            </section>
          ) : null}

          <section className="space-y-3">
            <SectionHeader title={t("recommendations")}>
              <PlanAdd
                projectId={project.id}
                client={project.kind === "client"}
                findings={liveFindings}
                scope={recScope}
                can={{
                  recommendation: !!plan?.can.recommendation,
                  finding: !!plan?.can.finding,
                  import: !!(plan?.can.finding && plan.can.recommendation && plan.can.action),
                  excel: data.recommendations.length > 0 || data.findings.length > 0,
                }}
              />
            </SectionHeader>

            {/* The rules that were "Needs attention", as chips that filter the plan, each with its count. */}
            {offered.some((r) => attention.rules[r]!.length) ? (
              <nav aria-label={tp("rules.label")} className="flex flex-wrap items-center gap-2">
                <Link
                  href={projectTabHref(project.id, "plan")}
                  aria-current={rule ? undefined : "page"}
                  className={buttonVariants({ variant: rule ? "ghost" : "secondary", size: "sm" })}
                >
                  {tp("rules.all")}
                </Link>
                {offered
                  .filter((r) => attention.rules[r]!.length || r === rule)
                  .map((r) => (
                    <Link
                      key={r}
                      href={projectTabHref(project.id, "plan", { rule: r })}
                      aria-current={r === rule ? "page" : undefined}
                      title={tp(`rules.hint.${r}`)}
                      className={buttonVariants({ variant: r === rule ? "secondary" : "ghost", size: "sm" })}
                    >
                      {tp(`rules.${r}`)}
                      <span className="text-xs text-muted-foreground tabular-nums">{attention.rules[r]!.length}</span>
                    </Link>
                  ))}
                {rule && rule !== "disputed" ? (
                  <Link
                    href={
                      rule === "waiting-long"
                        ? actionsHref({ filter: "awaiting-review", waitingLong: true, project: project.id })
                        : actionsHref({ filter: rule, project: project.id })
                    }
                    className="ms-auto text-sm text-muted-foreground hover:text-foreground hover:underline"
                  >
                    {tp("rules.openInActions")}
                  </Link>
                ) : null}
              </nav>
            ) : null}

            {data.recommendations.length === 0 ? (
              <EmptyState icon={<ClipboardList />} description={t(firmStaff ? "noRecs" : "noRecsClient")} />
            ) : recommendations.length === 0 ? (
              <p className="rounded-xl border bg-card px-4 py-6 text-center text-sm text-muted-foreground">{tp("rules.none")}</p>
            ) : null}
            {recommendations.map((r) => {
              const finding = r.findingId ? data.findings.find((f) => f.id === r.findingId) : null;
              const openActions = r.actions.filter((a) => a.status !== "draft" && a.status !== "verified_complete" && a.status !== "closed").length;
              return (
                <Card key={r.id} className={cn("gap-4 py-5 shadow-xs", r.withdrawnAt && "bg-muted/40")}>
                  <CardHeader className="px-5">
                    <div className="flex flex-wrap items-center gap-2">
                      <CardTitle className={cn("text-base", r.withdrawnAt && "text-muted-foreground line-through")}>
                        <Link href={`/recommendations/${r.id}`} className="hover:underline" dir="auto">
                          <MorphTitle name={`rec-${r.id}`} className="inline-block">
                            {r.title}
                          </MorphTitle>
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
                        {tPlan("changes.withdrawnOn", { date: day(r.withdrawnAt) })} <span dir="auto">{r.withdrawnReason}</span>
                      </p>
                    ) : null}
                    {/* The finding it answers, as one line, with the assessment it came from (page audit 4.3 and row 4d). */}
                    {finding ? (
                      <div className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                        <span dir="auto" className={cn(finding.withdrawnAt && "line-through")}>
                          {tp(firmStaff ? "finding.lineFirm" : "finding.line", { finding: finding.title })}
                        </span>
                        {finding.assessmentId && finding.assessmentTitle ? (
                          <Link href={`/assessments/${finding.assessmentId}`} className="hover:text-foreground hover:underline" dir="auto">
                            {tp("finding.fromAssessment", { title: finding.assessmentTitle })}
                          </Link>
                        ) : finding.fromAssessment ? (
                          <span>{tPlan("findings.fromAssessment")}</span>
                        ) : null}
                        {finding.withdrawnAt ? <Badge variant="outline">{tPlan("changes.withdrawnBadge")}</Badge> : null}
                        {finding.visibility === "firm_private" ? (
                          <Badge variant="outline" className="gap-1">
                            <Lock className="size-3" />
                            {tVis("firm_private")}
                          </Badge>
                        ) : null}
                        <RecordActions kind="finding" id={finding.id} title={finding.title} can={finding.can} values={{ title: finding.title, description: finding.description }} />
                      </div>
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
                    <PlanActions
                      rows={r.actions.map((a) => ({
                        id: a.id,
                        title: a.title,
                        status: a.status,
                        dueDate: a.dueDate,
                        ownerName: a.ownerName,
                        overdue: isOverdue(a),
                        reasons: rule ? attention.reasons[a.id] : undefined,
                      }))}
                      evidence={Object.fromEntries(r.actions.map((a) => [a.id, evidence[a.id] ?? { evidence: [], review: null }]))}
                      client={!firmStaff}
                    />
                  </CardContent>
                </Card>
              );
            })}
          </section>

          {/* Findings no recommendation answers yet, in a short group at the end. */}
          {unanswered.length && !rule ? (
            <section className="space-y-3">
              <SectionHeader title={tp(firmStaff ? "unanswered.title" : "unanswered.titleClient")} description={tp(firmStaff ? "unanswered.hint" : "unanswered.hintClient")} />
              <ul className="divide-y rounded-xl border bg-card shadow-xs">
                {unanswered.map((f) => (
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
                      <p className="text-xs text-muted-foreground">
                        {f.withdrawnAt ? (
                          <>
                            {tPlan("changes.withdrawnOn", { date: day(f.withdrawnAt) })} <span dir="auto">{f.withdrawnReason}</span>
                          </>
                        ) : f.answeredElsewhere ? (
                          // A recommendation in a department the reader is not in still answers the finding; it is not named (D8).
                          tPlan("findings.answeredElsewhere")
                        ) : (
                          tPlan("findings.answeredBy", { n: 0 })
                        )}
                        {f.assessmentId && f.assessmentTitle ? (
                          <>
                            {" · "}
                            <Link href={`/assessments/${f.assessmentId}`} className="hover:text-foreground hover:underline" dir="auto">
                              {tp("finding.fromAssessment", { title: f.assessmentTitle })}
                            </Link>
                          </>
                        ) : f.fromAssessment ? (
                          ` · ${tPlan("findings.fromAssessment")}`
                        ) : null}
                      </p>
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
                            {tPlan("rec.addForFinding")}
                          </Button>
                        }
                      />
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </TabsContent>

        <TabsContent value="files" className="space-y-6">
          {/* Requests first, with their open count on the tab; an internal project has none (files only). */}
          {requests ? (
            <InfoRequestsTab projectId={project.id} list={requests} />
          ) : project.kind === "internal" ? (
            <p className="text-sm text-muted-foreground">{tp("files.internal")}</p>
          ) : null}

          <section className="space-y-3">
            <SectionHeader title={tp("files.title")} description={tp("files.hint")}>
              {/* The file's own upload (October review, item 13); the one main button here when no request can be added. */}
              {upload ? <AddFileDialog target={upload} primary={!requests?.can.manage} /> : null}
            </SectionHeader>
            {data.documents.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("noDocs")}</p>
            ) : (
              <ul className="divide-y rounded-xl border bg-card">
                {data.documents.map((d) => (
                  <li key={d.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
                    <FileText className="size-4 text-muted-foreground" />
                    <div className="min-w-0">
                      <a href={`/api/documents/${d.id}/download`} className="font-medium hover:underline" dir="auto">
                        {d.title}
                      </a>
                      {/* Who added it and when; the version only when there is more than one (October review, item 7). */}
                      <p className="text-xs text-muted-foreground">
                        {d.uploaderName ? tp("files.addedBy", { name: d.uploaderName, date: day(d.createdAt) }) : tp("files.addedOn", { date: day(d.createdAt) })}
                        {d.version > 1 ? ` · ${t("version")} ${d.version}` : ""}
                      </p>
                    </div>
                    {d.limited ? <AudienceMarker kind="document" className="ms-auto" /> : null}
                    <Badge variant={d.visibility === "shared" ? "secondary" : "outline"} className={d.limited ? undefined : "ms-auto"}>
                      {tVis(d.visibility)}
                    </Badge>
                    {d.aiIndexable && data.assistantReads ? (
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
          </section>

          {/* The client's shared assessments (the firm reads its own under Sources on Plan). */}
          {!firmStaff && assessments?.length ? (
            <section className="space-y-3">
              <SectionHeader title={tp("files.shared")} description={tp("files.sharedHint")} />
              {assessmentRows(assessments)}
            </section>
          ) : null}
        </TabsContent>

        {meetings ? (
          <TabsContent value="meetings" className="space-y-4">
            {/* A whole-project meeting is booked by people who see all of the project's work; a manager
                with department limits books one for her department (decision 1a). */}
            {invitees && (invitees.wholeProject || invitees.departments.length) ? (
              <div className="flex justify-end">
                <MeetingForm
                  projectId={project.id}
                  firm={firmStaff}
                  invitees={invitees}
                  me={me}
                  departments={invitees.departments.map((d) => ({ id: d.id, label: localLabel(d, ar) }))}
                  wholeProject={invitees.wholeProject}
                  audience={invitees.audience}
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
                    <span className="text-xs text-muted-foreground tabular-nums">{format.dateTime(m.startsAt, { dateStyle: "medium", timeStyle: "short" })}</span>
                    {m.limited ? <AudienceMarker kind="meeting" className="ms-auto" /> : null}
                    <Badge variant="outline" className={m.limited ? undefined : "ms-auto"}>
                      {tMeeting(`status.${m.status}`)}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </TabsContent>
        ) : null}

        {tabs.includes("progress") ? (
          <TabsContent value="progress" className="space-y-6">
            {/* Numbers first, then the reports, then the handover, then the activity record (page audit row 4b). */}
            {metrics ? <ProgressTab projectId={project.id} data={metrics} reports={reports} firm={firmStaff} /> : null}
            {/* The handover date and the firm's check-ins after it are the firm's to run (page audit U11, batch 1). */}
            {handover ? <HandoverCard projectId={project.id} data={handover} /> : null}
            {data.activity ? (
              <section className="space-y-3">
                <SectionHeader title={tp("activity.title")} description={tp("activity.hint")} />
                {data.activity.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t("noActivity")}</p>
                ) : (
                  <ol className="space-y-3 border-s ps-4">
                    {data.activity.map((e) => (
                      <li key={e.id} className="text-sm">
                        {/* "Event from person" in Arabic, so the line is right for anyone; "Person did" in English. */}
                        {tc.rich("byLine", {
                          name: e.actorName ?? "—",
                          // Only an action's states are action statuses; files and assessments have their own events.
                          event:
                            e.entityType === "action" && e.fromState && e.toState
                              ? t("changed", { from: tStatus(e.fromState as never), to: tStatus(e.toState as never) })
                              : t.has(`events.${e.entityType}_${e.event}`)
                                ? eventLabel(`${e.entityType}_${e.event}`)
                                : t.has(`events.${e.event}`)
                                  ? eventLabel(e.event)
                                  : t("events.other"),
                          who: (c) => <span className="font-medium">{c}</span>,
                        })}
                        {/* An answered request to close carries its note or the firm's reply. */}
                        {e.detail ? (
                          <p className="whitespace-pre-wrap text-muted-foreground" dir="auto">
                            {e.detail}
                          </p>
                        ) : null}
                        <div className="text-xs text-muted-foreground">{format.dateTime(e.createdAt, { dateStyle: "medium", timeStyle: "short" })}</div>
                      </li>
                    ))}
                  </ol>
                )}
              </section>
            ) : null}
          </TabsContent>
        ) : null}

        {tabs.includes("people") ? (
          <TabsContent value="people" className="grid gap-6 lg:grid-cols-2">
            {team ? (
              <Card className="h-fit gap-4 py-5 shadow-xs">
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
                            type: "person",
                            required: true,
                            options: team.candidates.map((c) => ({ value: c.userId, label: c.name, hint: c.email })),
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
                        <RemoveFromProject name={m.name} endpoint={`/api/projects/${project.id}/members/${m.userId}`} confirm={ts("unstaffConfirm")} />
                      ) : null}
                    </div>
                  ))}
                </CardContent>
              </Card>
            ) : null}
            {/* A client reader sees the firm's consultants here too (page audit row 4j; until batch 3 only on Help). */}
            {consultants ? (
              <Card className="h-fit gap-4 py-5 shadow-xs">
                <CardHeader className="px-5">
                  <CardTitle className="text-base">{tp("consultants.title")}</CardTitle>
                  <CardDescription>{tp("consultants.hint")}</CardDescription>
                </CardHeader>
                <CardContent className="divide-y px-5">
                  {!consultants.lead && !consultants.deputy && !consultants.staffed.length ? (
                    <p className="py-2 text-sm text-muted-foreground">{tp("consultants.none")}</p>
                  ) : null}
                  {[
                    ...(consultants.lead ? [{ ...consultants.lead, badge: tp("consultants.lead") }] : []),
                    ...(consultants.deputy ? [{ ...consultants.deputy, badge: tp("consultants.deputy") }] : []),
                    ...consultants.staffed.map((c) => ({ ...c, badge: null })),
                  ].map((c) => (
                    <div key={c.userId} className="py-3">
                      <p className="flex items-center gap-2 text-sm font-medium">
                        {c.name}
                        {c.badge ? <Badge variant="outline">{c.badge}</Badge> : null}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        <bdi dir="ltr">{c.email}</bdi>
                      </p>
                    </div>
                  ))}
                </CardContent>
              </Card>
            ) : null}
            {people ? <ProjectPeople projectId={project.id} clientId={project.orgId} firm={firmStaff} data={people} primary={!team} reassign={reassign} /> : null}
            {roles ? <ClientRolesCard projectId={project.id} data={roles} firm={firmStaff} /> : null}
          </TabsContent>
        ) : null}

        {closingTab && closure ? (
          <TabsContent value="closing" className="space-y-6">
            {/* The client sees the pulse first, as the one thing asked of them; the firm after the closing record. */}
            {pulse && !firmStaff ? <PulseSection projectId={project.id} data={pulse} /> : null}
            <ClosureTab projectId={project.id} data={closure} caseStudyNotAsked={caseStudy !== null && caseStudy.latest === null} />
            {caseStudy ? <CaseStudySection projectId={project.id} data={caseStudy} /> : null}
            {pulse && firmStaff ? <PulseSection projectId={project.id} data={pulse} /> : null}
          </TabsContent>
        ) : null}
      </Tabs>
    </>
  );
}
