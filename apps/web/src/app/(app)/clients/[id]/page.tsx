import { Archive, ArrowLeft, FilePenLine, Pencil, UserCheck, UserPlus } from "lucide-react";
import { MorphTitle } from "@/components/morph";
import { Plus } from "@/components/animate-ui/icons/plus";
import { Crown } from "@/components/animate-ui/icons/crown";
import { Search } from "@/components/animate-ui/icons/search";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { ApiButton, FormDialog } from "@/components/form-dialog";
import { PageHeader } from "@/components/page-header";
import { SectionHeader } from "@/components/section-header";
import { WordBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ToneBadge } from "@/components/tone-badge";
import { DepartmentsManager } from "@/components/departments-manager";
import { NO_PREVIOUS } from "@/lib/phases";
import { isUuid } from "@/lib/ids";
import { clientTab, clientTabHref } from "@/lib/client-tabs";
import { localLabel, localName } from "@/lib/names";
import { projectPlacement } from "@/lib/status-words";
import { withPrincipal } from "@/server/page";
import { canWriteContacts, listContacts, listPeople } from "@/services/accounts";
import { canReadDepartments, getEngagement } from "@/services/engagement";
import { listEngagements } from "@/services/engagements";
import { discardBlock } from "@/services/prospects";
import { suggestClientLeads } from "@/services/inquiries";
import { intakeOptions } from "@/services/intake";
import { getClientTeam } from "@/services/staffing";
import { EngagementDialog } from "@/components/engagement-form";
import { NOT_COVERED } from "@/lib/engagements";
import { RECEIPT_STATUSES } from "@/lib/deliverables";
import { EngagementCard } from "./engagement-card";
import { LegalProfileCard } from "./legal-profile-card";
import { getClientProfile } from "@/services/client-profile";
import { latestConflictSearch } from "@/services/conflicts";
import { ConflictMatches } from "@/components/conflict-matches";
import { ClientProgress } from "@/components/client-progress";
import { clientOverview } from "@/services/client-overview";
import { IndicatorsCard } from "@/components/indicators/indicators-card";
import { listIndicators } from "@/services/indicators";
import { listExportPacks } from "@/services/export-pack";
import { getOffboarding } from "@/services/offboarding";
import { OffboardingCard } from "./offboarding-card";
import { ClientAiCard } from "./client-ai-card";
import { getClientAi } from "@/services/client-ai";
import { getClientReviewRule } from "@/services/second-review";
import { SecondReviewRuleCard } from "./second-review-card";
import { hasStructure, listVacancies } from "@/services/org-chart";
import { ClientTabs } from "./client-tabs";
import { ClientPageMenu } from "./client-menu";
import { ClientTeamMenu, ContactMenu } from "@/components/client-team-row";
import { PeopleAdmin } from "../../team/people-admin";

// The firm's client page in three tabs (page audit 4.4, batch 5, U07):
// Overview · People · Setup, plus Structure once there is one
// (lib/client-tabs.ts). Each tab loads only what it draws; the services
// decide who may read and change each part, as before.
export default async function ClientPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const current = clientTab((await searchParams).tab);
  const data = await withPrincipal(async (tx, principal) => {
    if (principal.orgKind !== "firm") return null;
    const team = await getClientTeam(tx, principal, id);
    const admin = principal.role === "firm_admin";
    const engagement = await getEngagement(tx, principal, id);
    const prospect = team.client.prospect;
    const offboarding = await getOffboarding(tx, principal, id);
    const departments = canReadDepartments(principal, id);
    const people = current === "people";
    const setup = current === "setup";
    const overview = current === "overview";
    return {
      ...team,
      admin,
      engagement,
      offboarding,
      departments,
      me: principal.userId,
      role: principal.role,
      // Null when this user may delete it now (a lost pitch, a client added by mistake).
      discard: await discardBlock(tx, id),
      structure: await hasStructure(tx, principal, id),
      // Overview: pooled numbers across the client's projects (F30) and its indicators; a pitch has none yet.
      overview: overview && !prospect ? await clientOverview(tx, principal, id).catch(() => null) : null,
      indicators: overview && !prospect ? await listIndicators(tx, principal, id, { includeInactive: true }).catch(() => null) : null,
      // People: contacts without an account (firm staff on the client's team only); a consultant
      // who only observes reads them and writes nothing (M05).
      contacts: people ? await listContacts(tx, principal, id).catch(() => null) : null,
      editContacts: people ? await canWriteContacts(tx, principal, id) : false,
      // Who fits this client, from the inquiry it came from; offered inside "Add a consultant". The admin decides.
      suggestions: people && admin ? await suggestClientLeads(tx, principal, id) : null,
      services: people && admin ? (await intakeOptions(tx)).services : [],
      // The client's own accounts, the firm admin's to manage; the invite offers the structure's vacant positions.
      accounts: people && admin && !prospect ? await listPeople(tx, principal, id) : null,
      vacancies: people && admin && !prospect ? await listVacancies(tx, principal, id) : [],
      // The departments' people to choose heads and members from, for whoever manages them.
      departmentPeople:
        people && departments && engagement.canManageDepartments ? (await listPeople(tx, principal, id)).people.filter((p) => p.active) : [],
      // Setup (and the projects' engagement field on Overview).
      signed: setup || overview ? await listEngagements(tx, principal, id) : null,
      legal: setup ? await getClientProfile(tx, principal, id) : null,
      // A pitch is checked for conflicts before the firm goes further (item 8).
      conflictSearch: setup && admin ? await latestConflictSearch(tx, { orgId: id }) : null,
      packs: setup ? await listExportPacks(tx, principal, id) : [],
      // The client assistant (F39): the firm admin offers it, the client's admin consents.
      clientAi: setup && !prospect ? await getClientAi(tx, principal, id) : null,
      // When evidence needs a second consultant's sign-off (F22).
      secondReview: setup && !prospect ? await getClientReviewRule(tx, principal, id) : null,
    };
  });
  if (!data) notFound();
  const [t, tc, tq, tp, ti, tCt, tPh, tE, tOff, tD, tTabs, format] = await Promise.all([
    getTranslations("staffing"),
    getTranslations("clients"),
    getTranslations("assessment.question"),
    getTranslations("people"),
    getTranslations("inbox"),
    getTranslations("clients.contacts"),
    getTranslations("phases"),
    getTranslations("engagements"),
    getTranslations("offboarding"),
    getTranslations("deliverables"),
    getTranslations("clientPage"),
    getFormatter(),
  ]);
  const ar = (await getLocale()) === "ar";
  // An archived client is read-only: the database refuses changes, so the page offers none (staffing included, M06).
  const open = !data.offboarding.archived;
  const { client } = data;
  const can = open ? data.can : { ...data.can, manage: false, setLead: false, setDeputy: false };
  const onTeam = new Set(data.team.map((m) => m.userId));
  const joinWaiting = can.decide && !client.prospect && open ? data.requests.length : 0;
  const contactFields = (c?: { name: string; nameAlt: string | null; title: string | null; email: string | null; phone: string | null }) => [
    { name: "name", label: tCt("name"), required: true, maxLength: 120, defaultValue: c?.name },
    { name: "nameAlt", label: tCt("nameAlt"), maxLength: 200, defaultValue: c?.nameAlt ?? undefined },
    { name: "title", label: tCt("jobTitle"), maxLength: 120, defaultValue: c?.title ?? undefined },
    { name: "email", label: tCt("email"), maxLength: 254, dir: "ltr" as const, defaultValue: c?.email ?? undefined },
    { name: "phone", label: tCt("phone"), maxLength: 30, dir: "ltr" as const, defaultValue: c?.phone ?? undefined },
  ];
  const drafts = data.projects.filter((p) => p.state === "draft").map((p) => ({ id: p.id, title: p.title }));
  const signed = data.signed;
  const phaseFormFields = () => [
    { name: "title", label: tPh("title"), required: true, maxLength: 200, placeholder: tPh("titlePlaceholder") },
    { name: "description", label: tPh("description"), type: "textarea" as const, maxLength: 2000 },
    { name: "sequence", label: tPh("sequence"), maxLength: 2, dir: "ltr" as const, placeholder: String(data.projects.length + 1) },
    { name: "plannedWorkingDays", label: tPh("plannedDays"), maxLength: 4, dir: "ltr" as const },
    { name: "startDate", label: tPh("start"), type: "date" as const },
    { name: "endDate", label: tPh("end"), type: "date" as const },
    ...(data.projects.length
      ? [
          {
            name: "followsProjectId",
            label: tPh("followsField"),
            type: "select" as const,
            options: [{ value: NO_PREVIOUS, label: tPh("followsNone") }, ...data.projects.map((p) => ({ value: p.id, label: p.title }))],
          },
        ]
      : []),
    // Only the firm admin puts a project under an engagement; anyone else's new project is a draft.
    ...(signed?.can.record && signed.engagements.length
      ? [
          {
            name: "engagementId",
            label: tE("coveredBy"),
            type: "select" as const,
            options: [{ value: NOT_COVERED, label: tE("notCovered") }, ...signed.engagements.map((g) => ({ value: g.id, label: g.title }))],
          },
        ]
      : []),
  ];
  const serviceName = (code: string) => {
    const x = data.services.find((o) => o.code === code);
    return x ? localLabel(x, ar) : code;
  };
  // "Suggested consultants" live inside "Add a consultant" (page audit 4.4): the suggested ones first, with why.
  const suggested = new Map(
    (data.suggestions?.enabled && data.suggestions.inquiry ? data.suggestions.leads : [])
      .filter((l) => !onTeam.has(l.userId))
      .map((l) => [
        l.userId,
        [
          t("suggested"),
          l.matchedServices.length ? ti("matched", { services: l.matchedServices.map(serviceName).join(ar ? "، " : ", ") }) : null,
          l.sectorMatch ? ti("sectorMatch") : null,
          l.speaksLanguage ? ti("speaks") : null,
          l.acceptingNewClients ? null : ti("notAccepting"),
          ti("activeClients", { n: l.activeClients }),
        ]
          .filter(Boolean)
          .join(" · "),
      ]),
  );
  const candidates = [...data.candidates].sort((a, b) => Number(suggested.has(b.userId)) - Number(suggested.has(a.userId)));

  return (
    <>
      <Link href="/clients" className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4 rtl:-scale-x-100" />
        {tc("title")}
      </Link>
      <PageHeader
        title={localName(client, ar)}
        morph={`client-${client.id}`}
        description={ar ? client.name : (client.nameAr ?? undefined)}
        meta={
          client.prospect ? (
            <ToneBadge tone="waiting">{tE("prospect")}</ToneBadge>
          ) : open ? undefined : (
            <ToneBadge tone="neutral">{tOff("archived")}</ToneBadge>
          )
        }
      >
        <ClientPageMenu
          clientId={client.id}
          name={localName(client, ar)}
          watch={{ can: data.can.watch, on: data.watching }}
          remove={
            data.discard === null
              ? {
                  label: client.prospect ? tE("deletePitch") : tE("deleteClient"),
                  confirm: client.prospect ? tE("deletePitchConfirm") : tE("deleteClientConfirm"),
                }
              : null
          }
        />
      </PageHeader>
      <ClientTabs clientId={client.id} current={current} structure={data.structure} />
      {client.prospect ? (
        <p className="flex items-center gap-2 rounded-lg bg-muted px-4 py-2 text-sm text-muted-foreground">
          <FilePenLine className="size-4 shrink-0" />
          {tE("pitchBanner")}
        </p>
      ) : null}
      {data.offboarding.current ? (
        <p className="flex items-center gap-2 rounded-lg bg-muted px-4 py-2 text-sm text-muted-foreground">
          <Archive className="size-4 shrink-0" />
          {tOff("banner", { date: format.dateTime(data.offboarding.current.archivedAt, { dateStyle: "medium" }) })}
        </p>
      ) : null}

      {current === "overview" ? (
        <div className="space-y-6">
          {/* A join request waiting is the one thing on Overview that is not about the work: a notice that leads to it. */}
          {joinWaiting ? (
            <p className="flex flex-wrap items-center gap-2 rounded-lg bg-muted px-4 py-2 text-sm">
              <UserPlus className="size-4 shrink-0 text-muted-foreground" />
              {tTabs("joinWaiting", { n: joinWaiting })}
              <Link href={clientTabHref(client.id, "people", "join-requests")} className="font-medium underline-offset-4 hover:underline">
                {tTabs("joinWaitingOpen")}
              </Link>
            </p>
          ) : null}
          <Card className="gap-4 py-5 shadow-xs">
            <CardHeader className="flex flex-row items-start justify-between gap-4 px-5">
              <div className="space-y-1.5">
                <CardTitle className="text-base">{t("clientProjects")}</CardTitle>
                <CardDescription>{tPh("hint")}</CardDescription>
              </div>
              {/* The tab's one solid button. */}
              {can.createProject && open ? (
                <FormDialog
                  trigger={
                    <Button size="sm">
                      <Plus />
                      {tPh("new")}
                    </Button>
                  }
                  title={tPh("new")}
                  description={tPh("newHint")}
                  endpoint={`/api/clients/${client.id}/projects`}
                  fields={phaseFormFields()}
                  submitLabel={tPh("create")}
                  redirectTo="/projects/:id"
                />
              ) : null}
            </CardHeader>
            <CardContent className="px-5">
              {data.projects.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("noProjects")}</p>
              ) : (
                <ul className="divide-y">
                  {data.projects.map((p) => {
                    const follows = p.followsProjectId ? data.projects.find((x) => x.id === p.followsProjectId) : null;
                    return (
                      <li key={p.id} className="flex flex-wrap items-center gap-3 py-3 text-sm">
                        <div className="min-w-0 flex-1 space-y-0.5">
                          <Link href={`/projects/${p.id}`} className="font-medium hover:underline" dir="auto">
                            <MorphTitle name={`project-${p.id}`} className="inline-block">
                              {p.sequence ? tPh("numbered", { n: p.sequence, title: p.title }) : p.title}
                            </MorphTitle>
                          </Link>
                          <p className="text-xs text-muted-foreground tabular-nums">
                            {[
                              p.startDate || p.endDate
                                ? format.dateTimeRange(new Date(p.startDate ?? p.endDate!), new Date(p.endDate ?? p.startDate!), { dateStyle: "medium" })
                                : null,
                              p.plannedWorkingDays ? tPh("days", { n: p.plannedWorkingDays }) : null,
                              follows ? tPh("follows", { title: follows.title }) : null,
                            ]
                              .filter(Boolean)
                              .join(" · ") || tPh("noDates")}
                          </p>
                        </div>
                        <WordBadge placement={projectPlacement(p.state)} reader="firm" />
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>
          {data.overview && data.overview.projects.length ? <ClientProgress data={data.overview} /> : null}
          {data.indicators && (data.indicators.indicators.length || data.indicators.canManage) ? <IndicatorsCard data={data.indicators} quiet /> : null}
        </div>
      ) : null}

      {current === "people" ? (
        <div className="space-y-8">
          <Card className="gap-4 py-5 shadow-xs">
            <CardHeader className="flex flex-row items-start justify-between gap-4 px-5">
              <div className="space-y-1.5">
                <CardTitle className="text-base">{t("teamTitle")}</CardTitle>
                <CardDescription>{t("teamHint")}</CardDescription>
              </div>
              {can.manage ? (
                candidates.length ? (
                  <FormDialog
                    trigger={
                      <Button size="sm" variant="outline">
                        <UserPlus />
                        {t("addConsultant")}
                      </Button>
                    }
                    title={t("addConsultant")}
                    description={
                      data.suggestions?.enabled
                        ? `${t("addConsultantHint")} ${data.suggestions.inquiry ? t("suggestionsHint", { ref: data.suggestions.inquiry.publicRef }) : t("suggestionsNoInquiry")}`
                        : t("addConsultantHint")
                    }
                    endpoint={`/api/clients/${client.id}/consultants`}
                    fields={[
                      {
                        name: "userId",
                        label: t("consultant"),
                        type: "person",
                        required: true,
                        options: candidates.map((c) => ({ value: c.userId, label: c.name, hint: suggested.get(c.userId) ?? c.email })),
                      },
                    ]}
                    submitLabel={t("add")}
                  />
                ) : (
                  <span className="text-xs text-muted-foreground">{t("noCandidates")}</span>
                )
              ) : null}
            </CardHeader>
            <CardContent className="divide-y px-5">
              {data.team.length === 0 ? <p className="py-2 text-sm text-muted-foreground">{t("noLead")}</p> : null}
              {data.team.map((m) => (
                <div key={m.userId} className="flex flex-wrap items-center gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2 text-sm font-medium">
                      {m.name}
                      {m.isLead ? (
                        <Badge variant="outline" className="gap-1 border-transparent bg-accent text-accent-foreground">
                          <Crown className="size-3" />
                          {t("leadBadge")}
                        </Badge>
                      ) : null}
                      {m.isDeputy ? (
                        <Badge variant="outline" className="gap-1">
                          <UserCheck className="size-3" />
                          {t("deputyBadge")}
                        </Badge>
                      ) : null}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {m.email} · {t("since", { date: format.dateTime(m.since, { dateStyle: "medium" }) })}
                    </p>
                  </div>
                  <ClientTeamMenu
                    clientId={client.id}
                    member={{ userId: m.userId, name: m.name, isLead: m.isLead, isDeputy: m.isDeputy }}
                    can={{ manage: can.manage, setLead: can.setLead, setDeputy: can.setDeputy }}
                  />
                </div>
              ))}
            </CardContent>
          </Card>

          {/* The client's own accounts (was /clients/:id/people). */}
          {data.admin ? (
            <div id="accounts" className="scroll-mt-20">
              {data.accounts && data.accounts.organization.kind === "client" ? (
                <PeopleAdmin data={data.accounts} me={data.me} myRole={data.role} reviewDays={null} vacancies={data.vacancies} />
              ) : (
                <section className="space-y-2">
                  <SectionHeader title={tp("clientPeople")} description={tp("clientPeopleHint")} />
                  <p className="text-sm text-muted-foreground">{tE("noAccountsYet")}</p>
                </section>
              )}
            </div>
          ) : null}

          {data.contacts ? (
            <Card className="gap-4 py-5 shadow-xs">
              <CardHeader className="flex flex-row items-start justify-between gap-4 px-5">
                <div className="space-y-1.5">
                  <CardTitle className="text-base">{tCt("title")}</CardTitle>
                  <CardDescription>{data.engagement.minimalRecords ? tCt("minimal") : tCt("hint")}</CardDescription>
                </div>
                {data.engagement.minimalRecords || !open || !data.editContacts ? null : (
                  <FormDialog
                    trigger={
                      <Button size="sm" variant="outline">
                        <Plus />
                        {tCt("add")}
                      </Button>
                    }
                    title={tCt("add")}
                    description={tCt("hint")}
                    endpoint={`/api/clients/${client.id}/contacts`}
                    fields={contactFields()}
                    submitLabel={tCt("add")}
                  />
                )}
              </CardHeader>
              {data.engagement.minimalRecords ? null : (
                <CardContent className="divide-y px-5">
                  {data.contacts.length === 0 ? <p className="py-2 text-sm text-muted-foreground">{tCt("none")}</p> : null}
                  {data.contacts.map((c) => (
                    <div key={c.id} className="flex flex-wrap items-center gap-3 py-3">
                      <div className="min-w-0 flex-1 space-y-0.5">
                        <p className="text-sm font-medium">
                          <span dir="auto">{c.name}</span>
                          {c.nameAlt ? (
                            <span className="ms-2 text-xs font-normal text-muted-foreground" dir="auto">
                              {c.nameAlt}
                            </span>
                          ) : null}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {c.title ? <span dir="auto">{c.title}</span> : null}
                          {c.title && (c.email || c.phone) ? " · " : null}
                          {c.email ? <bdi dir="ltr">{c.email}</bdi> : null}
                          {c.email && c.phone ? " · " : null}
                          {c.phone ? <bdi dir="ltr">{c.phone}</bdi> : null}
                          {c.email ? null : (
                            <>
                              {c.title || c.phone ? " · " : null}
                              {tCt("noEmail")}
                            </>
                          )}
                        </p>
                      </div>
                      <ContactMenu contact={{ id: c.id, name: c.name }} fields={contactFields(c)} canEdit={open && data.editContacts} />
                    </div>
                  ))}
                </CardContent>
              )}
            </Card>
          ) : null}

          {can.decide && !client.prospect && open ? (
            <Card id="join-requests" className="scroll-mt-20 gap-4 py-5 shadow-xs">
              <CardHeader className="px-5">
                <CardTitle className="text-base">{t("joinRequests")}</CardTitle>
              </CardHeader>
              <CardContent className="divide-y px-5">
                {data.requests.length === 0 ? <p className="text-sm text-muted-foreground">{t("noRequests")}</p> : null}
                {data.requests.map((r) => (
                  <div key={r.id} className="space-y-2 py-3">
                    <p className="text-sm">
                      <span className="font-medium">{r.name}</span>
                      <span className="ms-2 text-xs text-muted-foreground">
                        {r.email} · {format.dateTime(r.createdAt, { dateStyle: "medium" })}
                      </span>
                    </p>
                    <p className="text-sm whitespace-pre-wrap text-muted-foreground">{r.reason}</p>
                    {/* One button per row; declining is the quieter one. */}
                    <div className="flex gap-2">
                      <ApiButton endpoint={`/api/join-requests/${r.id}/decision`} body={{ approve: true }} label={t("approve")} />
                      <ApiButton endpoint={`/api/join-requests/${r.id}/decision`} body={{ approve: false }} label={t("decline")} variant="ghost" />
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          ) : null}

          {/* The client's departments (was /clients/:id/departments), for whoever may read them. */}
          {data.departments && !client.prospect ? (
            <section id="departments" className="scroll-mt-20 space-y-4">
              <SectionHeader title={tTabs("departments")} description={tTabs("departmentsHint")} />
              <DepartmentsManager data={data.engagement} people={data.departmentPeople.map((p) => ({ userId: p.userId, name: p.name }))} />
            </section>
          ) : null}
        </div>
      ) : null}

      {current === "setup" ? (
        <div className="grid items-start gap-6 lg:grid-cols-2">
          <EngagementCard
            data={{
              id: client.id,
              engagementMode: data.engagement.engagementMode,
              departmentsEnabled: data.engagement.departmentsEnabled,
              minimalRecords: data.engagement.minimalRecords,
              displayAlias: data.engagement.displayAlias,
              departmentCount: data.engagement.departments.filter((d) => d.active).length,
              canChangeMode: data.engagement.canChangeMode && open,
              fit: data.engagement.fit,
            }}
          />
          {data.legal ? (
            <LegalProfileCard
              clientId={client.id}
              profile={data.legal.profile}
              legalForm={data.legal.legalForm}
              minimalRecords={data.legal.minimalRecords}
              sectors={data.legal.sectors}
              sectorName={data.legal.sector ? (ar ? data.legal.sector.nameAr : data.legal.sector.nameEn) : null}
              can={open ? data.legal.can : { edit: false, legalForm: false }}
            />
          ) : null}
          <Card className="h-fit gap-4 py-5 shadow-xs">
            <CardHeader className="flex flex-row items-start justify-between gap-4 px-5">
              <div className="space-y-1.5">
                <CardTitle className="text-base">{tc("shortNames.title")}</CardTitle>
                <CardDescription>{tc("shortNames.hint")}</CardDescription>
              </div>
              {can.setLegalForm && open ? (
                <FormDialog
                  trigger={
                    <Button size="sm" variant="outline">
                      <Pencil />
                      {tq("change")}
                    </Button>
                  }
                  title={tc("shortNames.title")}
                  description={tc("shortNames.editHint")}
                  endpoint={`/api/orgs/${client.id}/short-names`}
                  method="PUT"
                  fields={[
                    {
                      name: "shortNames",
                      label: tc("shortNames.field"),
                      type: "textarea",
                      maxLength: 1000,
                      defaultValue: client.shortNames.join("\n"),
                    },
                  ]}
                  submitLabel={tq("save")}
                />
              ) : null}
            </CardHeader>
            <CardContent className="flex flex-wrap gap-1.5 px-5 text-sm">
              {client.shortNames.length ? (
                client.shortNames.map((n) => (
                  <Badge key={n} variant="secondary" dir="auto">
                    {n}
                  </Badge>
                ))
              ) : (
                <span className="text-muted-foreground">{tc("shortNames.none")}</span>
              )}
            </CardContent>
          </Card>
          {data.secondReview ? <SecondReviewRuleCard clientId={client.id} view={{ ...data.secondReview, canChange: data.secondReview.canChange && open }} /> : null}
          {data.clientAi ? <ClientAiCard clientId={client.id} view={{ ...data.clientAi, canManage: data.clientAi.canManage && open }} /> : null}

          {signed ? (
            <Card className="h-fit gap-4 py-5 shadow-xs">
              <CardHeader className="flex flex-row items-start justify-between gap-4 px-5">
                <div className="space-y-1.5">
                  <CardTitle className="text-base">{tE("title")}</CardTitle>
                  <CardDescription>{tE("hint")}</CardDescription>
                </div>
                {signed.can.record && open ? (
                  <EngagementDialog
                    trigger={
                      <Button size="sm" variant="outline">
                        <FilePenLine />
                        {tE("record")}
                      </Button>
                    }
                    endpoint={`/api/clients/${client.id}/engagements`}
                    drafts={drafts}
                    redirectTo="/engagements/:id"
                  />
                ) : null}
              </CardHeader>
              <CardContent className="px-5">
                {signed.engagements.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{drafts.length ? tE("noneWithDrafts", { n: drafts.length }) : tE("none")}</p>
                ) : (
                  <ul className="divide-y">
                    {signed.engagements.map((g) => (
                      <li key={g.id} className="flex flex-wrap items-center gap-3 py-3 text-sm">
                        <div className="min-w-0 flex-1 space-y-0.5">
                          <Link href={`/engagements/${g.id}`} className="font-medium hover:underline" dir="auto">
                            {g.title}
                          </Link>
                          <p className="text-xs text-muted-foreground">
                            {[
                              tE("signedOnShort", { date: format.dateTime(new Date(g.signedOn), { dateStyle: "medium" }) }),
                              g.projects.length ? tE("coversCount", { n: g.projects.length }) : tE("coversNone"),
                              g.dataAgreementOn ? null : tE("noDataAgreement"),
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                          </p>
                          {/* Each deliverable's status word, counted (F21): no percentage. */}
                          {RECEIPT_STATUSES.some((s) => g.deliverables[s]) ? (
                            <p className="text-xs text-muted-foreground">
                              {tD("summary", {
                                list: RECEIPT_STATUSES.filter((s) => g.deliverables[s])
                                  .map((s) => tD("summaryItem", { status: tD(`status.${s}`), n: g.deliverables[s]! }))
                                  .join(" · "),
                              })}
                            </p>
                          ) : null}
                        </div>
                        {g.retainerFollows ? <ToneBadge tone="neutral">{tE("retainer")}</ToneBadge> : null}
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          ) : null}

          {client.prospect ? null : <OffboardingCard clientId={client.id} view={data.offboarding} packs={data.packs} />}
          {data.admin && client.prospect ? (
            <Card className="h-fit gap-4 py-5 shadow-xs">
              <CardHeader className="px-5">
                <CardTitle className="text-base">{ti("conflictCheck")}</CardTitle>
                <CardDescription>{ti("pitchConflictHint")}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 px-5 text-sm">
                <ConflictMatches search={data.conflictSearch} />
                <ApiButton endpoint={`/api/clients/${client.id}/conflict-search`} label={data.conflictSearch ? ti("searchAgain") : ti("runSearch")} icon={<Search />} />
              </CardContent>
            </Card>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
