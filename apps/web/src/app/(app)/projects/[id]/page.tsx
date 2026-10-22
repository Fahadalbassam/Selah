import { Bot, CalendarDays, CalendarPlus, ClipboardList, Crown, Eye, EyeOff, FileText, Lock, UserPlus } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { ActionsTable } from "@/components/actions-table";
import { ApiButton, FormDialog } from "@/components/form-dialog";
import { MeetingForm } from "@/components/meeting-form";
import { PageHeader } from "@/components/page-header";
import { Translatable } from "@/components/translatable";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { withPrincipal } from "@/server/page";
import { listAssessments, listTemplates } from "@/services/assessments";
import { listMeetings, meetingInvitees } from "@/services/meetings";
import { getProject, isOverdue } from "@/services/queries";
import { getProjectTeam } from "@/services/staffing";
import { StartAssessment } from "../../assessments/[id]/assessment-panels";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const { data, team, firmStaff, meetings, invitees, me, assessments, templates } = await withPrincipal(async (tx, principal) => {
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
      team: await getProjectTeam(tx, principal, id),
      firmStaff: principal.orgKind === "firm",
      // Roles that can't read meetings simply get no tab.
      meetings: await listMeetings(tx, principal, id).catch(() => null),
      // Who may book: the list of people to invite, or null.
      invitees: await meetingInvitees(tx, principal, id).catch(() => null),
      me: principal.userId,
    };
  });
  const [t, ts, tVis, tKind, tPrio, tStatus, tMeeting, tRun, format] = await Promise.all([
    getTranslations("project"),
    getTranslations("staffing"),
    getTranslations("visibility"),
    getTranslations("kind"),
    getTranslations("priority"),
    getTranslations("status"),
    getTranslations("meeting"),
    getTranslations("assessment.run"),
    getFormatter(),
  ]);
  const ar = (await getLocale()) === "ar";
  const { project } = data;

  return (
    <>
      <PageHeader title={project.title} description={project.description ?? undefined}>
        <Badge variant={project.kind === "internal" ? "secondary" : "outline"}>
          {tKind(project.kind)}
          {project.kind === "client" ? ` · ${(ar ? project.orgNameAr : null) ?? project.orgName}` : ""}
        </Badge>
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

      <Tabs defaultValue="recs" className="gap-4">
        <TabsList>
          <TabsTrigger value="recs">{t("recommendations")}</TabsTrigger>
          {meetings ? <TabsTrigger value="meetings">{t("meetings")}</TabsTrigger> : null}
          {assessments ? <TabsTrigger value="assessments">{t("assessments")}</TabsTrigger> : null}
          <TabsTrigger value="docs">{t("documents")}</TabsTrigger>
          <TabsTrigger value="activity">{t("activity")}</TabsTrigger>
          {team ? <TabsTrigger value="team">{ts("projectTeam")}</TabsTrigger> : null}
        </TabsList>

        <TabsContent value="recs" className="space-y-4">
          {data.recommendations.length === 0 ? <p className="text-sm text-muted-foreground">{t("noRecs")}</p> : null}
          {data.recommendations.map((r) => (
            <Card key={r.id} className="gap-4 py-5 shadow-xs">
              <CardHeader className="px-5">
                <div className="flex flex-wrap items-center gap-2">
                  <CardTitle className="text-base">{r.title}</CardTitle>
                  <Badge variant="outline">
                    {t("priority")}: {tPrio(r.priority)}
                  </Badge>
                </div>
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
          ))}
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
              <ul className="divide-y rounded-lg border bg-card">
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
              <ul className="divide-y rounded-lg border bg-card">
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

        <TabsContent value="docs">
          {data.documents.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("noDocs")}</p>
          ) : (
            <ul className="divide-y rounded-lg border bg-card">
              {data.documents.map((d) => (
                <li key={d.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
                  <FileText className="size-4 text-muted-foreground" />
                  <a href={`/api/documents/${d.id}/download`} className="font-medium hover:underline">
                    {d.title}
                  </a>
                  <span className="text-xs text-muted-foreground">
                    {t("version")} {d.version}
                  </span>
                  <Badge variant={d.visibility === "shared" ? "outline" : "secondary"} className="ms-auto">
                    {tVis(d.visibility)}
                  </Badge>
                  {d.aiIndexable ? (
                    <Badge variant="outline" className="gap-1">
                      <Bot className="size-3" />
                      {t("aiIndexed")}
                    </Badge>
                  ) : null}
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
