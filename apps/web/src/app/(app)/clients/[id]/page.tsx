import { ArrowLeft, FilePenLine, Pencil, Trash2, UserPlus, UsersRound } from "lucide-react";
import { Plus } from "@/components/animate-ui/icons/plus";
import { Crown } from "@/components/animate-ui/icons/crown";
import { Eye } from "@/components/animate-ui/icons/eye";
import { EyeOff } from "@/components/animate-ui/icons/eye-off";
import { Search } from "@/components/animate-ui/icons/search";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { ApiButton, FormDialog } from "@/components/form-dialog";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ToneBadge } from "@/components/tone-badge";
import { NO_PREVIOUS } from "@/lib/phases";
import { isUuid } from "@/lib/ids";
import { localLabel, localName } from "@/lib/names";
import { withPrincipal } from "@/server/page";
import { listContacts } from "@/services/accounts";
import { getEngagement } from "@/services/engagement";
import { listEngagements } from "@/services/engagements";
import { discardBlock } from "@/services/prospects";
import { suggestClientLeads } from "@/services/inquiries";
import { intakeOptions } from "@/services/intake";
import { getClientTeam } from "@/services/staffing";
import { EngagementDialog } from "@/components/engagement-form";
import { NOT_COVERED } from "@/lib/engagements";
import { EngagementCard } from "./engagement-card";
import { LegalProfileCard } from "./legal-profile-card";
import { getClientProfile } from "@/services/client-profile";
import { latestConflictSearch } from "@/services/conflicts";
import { ConflictMatches } from "@/components/conflict-matches";
import { ClientProgress } from "@/components/client-progress";
import { clientOverview } from "@/services/client-overview";

export default async function ClientPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const data = await withPrincipal(async (tx, principal) => {
    if (principal.orgKind !== "firm") return null;
    const team = await getClientTeam(tx, principal, id);
    const admin = principal.role === "firm_admin";
    const engagement = await getEngagement(tx, principal, id);
    return {
      ...team,
      admin,
      engagement,
      signed: await listEngagements(tx, principal, id),
      // Legal names, unified number, bands, regulators, fiscal year (item 7).
      legal: await getClientProfile(tx, principal, id),
      // Null when this user may delete it now (a lost pitch, a client added by mistake).
      discard: await discardBlock(tx, id),
      // People at the client without an account; firm staff on the client's team only.
      contacts: await listContacts(tx, principal, id).catch(() => null),
      // Who fits this client, from the inquiry it came from. The admin decides.
      suggestions: admin ? await suggestClientLeads(tx, principal, id) : null,
      services: admin ? (await intakeOptions(tx)).services : [],
      // A pitch is checked for conflicts before the firm goes further (item 8).
      conflictSearch: admin ? await latestConflictSearch(tx, { orgId: id }) : null,
      // Pooled numbers across the client's projects (F30); a pitch has none yet.
      overview: team.client.prospect ? null : await clientOverview(tx, principal, id).catch(() => null),
    };
  });
  if (!data) notFound();
  const [t, tc, tq, tp, ti, tCt, tPh, tE, format] = await Promise.all([
    getTranslations("staffing"),
    getTranslations("clients"),
    getTranslations("assessment.question"),
    getTranslations("people"),
    getTranslations("inbox"),
    getTranslations("clients.contacts"),
    getTranslations("phases"),
    getTranslations("engagements"),
    getFormatter(),
  ]);
  const ar = (await getLocale()) === "ar";
  const { client, can } = data;
  const onTeam = new Set(data.team.map((m) => m.userId));
  const contactFields = (c?: { name: string; nameAlt: string | null; title: string | null; email: string | null; phone: string | null }) => [
    { name: "name", label: tCt("name"), required: true, maxLength: 120, defaultValue: c?.name },
    { name: "nameAlt", label: tCt("nameAlt"), maxLength: 200, defaultValue: c?.nameAlt ?? undefined },
    { name: "title", label: tCt("jobTitle"), maxLength: 120, defaultValue: c?.title ?? undefined },
    { name: "email", label: tCt("email"), maxLength: 254, dir: "ltr" as const, defaultValue: c?.email ?? undefined },
    { name: "phone", label: tCt("phone"), maxLength: 30, dir: "ltr" as const, defaultValue: c?.phone ?? undefined },
  ];
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
    ...(data.signed.can.record && data.signed.engagements.length
      ? [
          {
            name: "engagementId",
            label: tE("coveredBy"),
            type: "select" as const,
            options: [
              { value: NOT_COVERED, label: tE("notCovered") },
              ...data.signed.engagements.map((g) => ({ value: g.id, label: g.title })),
            ],
          },
        ]
      : []),
  ];
  const drafts = data.projects.filter((p) => p.state === "draft").map((p) => ({ id: p.id, title: p.title }));
  const serviceName = (code: string) => {
    const x = data.services.find((o) => o.code === code);
    return x ? localLabel(x, ar) : code;
  };

  return (
    <>
      <Link href="/clients" className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4 rtl:-scale-x-100" />
        {tc("title")}
      </Link>
      <PageHeader
        title={localName(client, ar)}
        description={ar ? client.name : (client.nameAr ?? undefined)}
        meta={client.prospect ? <ToneBadge tone="waiting">{tE("prospect")}</ToneBadge> : undefined}
      >
        {can.watch ? (
          <ApiButton
            endpoint={`/api/clients/${client.id}/watch`}
            method="PUT"
            body={{ on: !data.watching }}
            label={data.watching ? t("unwatch") : t("watch")}
            icon={data.watching ? <EyeOff /> : <Eye />}
            title={t("watchClientHint")}
          />
        ) : null}
        {data.discard === null ? (
          <ApiButton
            endpoint={`/api/clients/${client.id}`}
            method="DELETE"
            label={client.prospect ? tE("deletePitch") : tE("deleteClient")}
            icon={<Trash2 />}
            variant="ghost"
            confirm={client.prospect ? tE("deletePitchConfirm") : tE("deleteClientConfirm")}
            redirectTo="/clients"
          />
        ) : null}
      </PageHeader>
      {client.prospect ? (
        <p className="flex items-center gap-2 rounded-lg bg-muted px-4 py-2 text-sm text-muted-foreground">
          <FilePenLine className="size-4 shrink-0" />
          {tE("pitchBanner")}
        </p>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-6">
          {data.overview && data.overview.projects.length ? <ClientProgress data={data.overview} /> : null}
          <Card className="gap-4 py-5 shadow-xs">
            <CardHeader className="flex flex-row items-start justify-between gap-4 px-5">
              <div className="space-y-1.5">
                <CardTitle className="text-base">{t("clientProjects")}</CardTitle>
                <CardDescription>{tPh("hint")}</CardDescription>
              </div>
              {can.createProject ? (
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
                            {p.sequence ? tPh("numbered", { n: p.sequence, title: p.title }) : p.title}
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
                        <ToneBadge tone={p.state === "active" ? "active" : p.state === "closed" ? "neutral" : p.state === "draft" ? "waiting" : "open"}>{tPh(`states.${p.state}`)}</ToneBadge>
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card className="gap-4 py-5 shadow-xs">
            <CardHeader className="flex flex-row items-start justify-between gap-4 px-5">
              <div className="space-y-1.5">
                <CardTitle className="text-base">{tE("title")}</CardTitle>
                <CardDescription>{tE("hint")}</CardDescription>
              </div>
              {data.signed.can.record ? (
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
              {data.signed.engagements.length === 0 ? (
                <p className="text-sm text-muted-foreground">{drafts.length ? tE("noneWithDrafts", { n: drafts.length }) : tE("none")}</p>
              ) : (
                <ul className="divide-y">
                  {data.signed.engagements.map((g) => (
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
                      </div>
                      {g.retainerFollows ? <ToneBadge tone="neutral">{tE("retainer")}</ToneBadge> : null}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card className="gap-4 py-5 shadow-xs">
            <CardHeader className="flex flex-row items-start justify-between gap-4 px-5">
              <div className="space-y-1.5">
                <CardTitle className="text-base">{t("teamTitle")}</CardTitle>
                <CardDescription>{t("teamHint")}</CardDescription>
              </div>
              {can.manage ? (
                data.candidates.length ? (
                  <FormDialog
                    trigger={
                      <Button size="sm">
                        <UserPlus />
                        {t("addConsultant")}
                      </Button>
                    }
                    title={t("addConsultant")}
                    description={t("addConsultantHint")}
                    endpoint={`/api/clients/${client.id}/consultants`}
                    fields={[
                      {
                        name: "userId",
                        label: t("consultant"),
                        type: "select",
                        required: true,
                        options: data.candidates.map((c) => ({ value: c.userId, label: `${c.name} · ${c.email}` })),
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
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {m.email} · {t("since", { date: format.dateTime(m.since, { dateStyle: "medium" }) })}
                    </p>
                  </div>
                  {can.setLead && !m.isLead ? (
                    <ApiButton endpoint={`/api/clients/${client.id}/lead`} method="PUT" body={{ userId: m.userId }} label={t("makeLead")} variant="ghost" />
                  ) : null}
                  {can.manage && (!m.isLead || can.setLead) ? (
                    <ApiButton
                      endpoint={`/api/clients/${client.id}/consultants/${m.userId}`}
                      method="DELETE"
                      label={t("remove")}
                      variant="ghost"
                      confirm={t("removeConfirm")}
                    />
                  ) : null}
                </div>
              ))}
            </CardContent>
          </Card>

          {data.contacts ? (
            <Card className="gap-4 py-5 shadow-xs">
              <CardHeader className="flex flex-row items-start justify-between gap-4 px-5">
                <div className="space-y-1.5">
                  <CardTitle className="text-base">{tCt("title")}</CardTitle>
                  <CardDescription>{data.engagement.minimalRecords ? tCt("minimal") : tCt("hint")}</CardDescription>
                </div>
                {data.engagement.minimalRecords ? null : (
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
                      <FormDialog
                        trigger={
                          <Button size="sm" variant="ghost">
                            <Pencil />
                            {tCt("edit")}
                          </Button>
                        }
                        title={tCt("editTitle")}
                        endpoint={`/api/contacts/${c.id}`}
                        method="PATCH"
                        sendEmptyAsNull
                        fields={contactFields(c)}
                        submitLabel={tq("save")}
                      />
                      <ApiButton
                        endpoint={`/api/contacts/${c.id}`}
                        method="DELETE"
                        label={tCt("remove")}
                        variant="ghost"
                        confirm={tCt("removeConfirm", { name: c.name })}
                      />
                    </div>
                  ))}
                </CardContent>
              )}
            </Card>
          ) : null}

          {data.suggestions?.enabled ? (
            <Card className="gap-4 py-5 shadow-xs">
              <CardHeader className="px-5">
                <CardTitle className="text-base">{ti("leads")}</CardTitle>
                <CardDescription>
                  {data.suggestions.inquiry ? t("suggestionsHint", { ref: data.suggestions.inquiry.publicRef }) : t("suggestionsNoInquiry")}
                </CardDescription>
              </CardHeader>
              {data.suggestions.inquiry ? (
                <CardContent className="divide-y px-5 text-sm">
                  {data.suggestions.leads.length === 0 ? <p className="py-2 text-muted-foreground">{ti("noLeads")}</p> : null}
                  {data.suggestions.leads.map((l) => (
                    <div key={l.userId} className="flex flex-wrap items-center gap-3 py-3">
                      <div className="min-w-0 flex-1 space-y-1">
                        <p className="font-medium">{l.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {[
                            l.matchedServices.length
                              ? ti("matched", { services: l.matchedServices.map(serviceName).join(ar ? "، " : ", ") })
                              : null,
                            l.sectorMatch ? ti("sectorMatch") : null,
                            l.speaksLanguage ? ti("speaks") : null,
                            l.acceptingNewClients ? null : ti("notAccepting"),
                            ti("activeClients", { n: l.activeClients }),
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </p>
                      </div>
                      {onTeam.has(l.userId) ? (
                        <span className="text-xs text-muted-foreground">{t("onTeam")}</span>
                      ) : can.manage ? (
                        <ApiButton endpoint={`/api/clients/${client.id}/consultants`} body={{ userId: l.userId }} label={t("add")} icon={<UserPlus />} />
                      ) : null}
                    </div>
                  ))}
                </CardContent>
              ) : null}
            </Card>
          ) : null}

          {can.decide && !client.prospect ? (
            <Card className="gap-4 py-5 shadow-xs">
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
                    <div className="flex gap-2">
                      <ApiButton endpoint={`/api/join-requests/${r.id}/decision`} body={{ approve: true }} label={t("approve")} variant="default" />
                      <ApiButton endpoint={`/api/join-requests/${r.id}/decision`} body={{ approve: false }} label={t("decline")} />
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          ) : null}
        </div>

        <div className="space-y-6">
        <EngagementCard
          data={{
            id: client.id,
            engagementMode: data.engagement.engagementMode,
            departmentsEnabled: data.engagement.departmentsEnabled,
            minimalRecords: data.engagement.minimalRecords,
            displayAlias: data.engagement.displayAlias,
            departmentCount: data.engagement.departments.filter((d) => d.active).length,
            canChangeMode: data.engagement.canChangeMode,
            fit: data.engagement.fit,
          }}
        />
        <LegalProfileCard
          clientId={client.id}
          profile={data.legal.profile}
          legalForm={data.legal.legalForm}
          minimalRecords={data.legal.minimalRecords}
          sectors={data.legal.sectors}
          sectorName={data.legal.sector ? (ar ? data.legal.sector.nameAr : data.legal.sector.nameEn) : null}
          can={data.legal.can}
        />
        <Card className="h-fit gap-4 py-5 shadow-xs">
          <CardHeader className="flex flex-row items-start justify-between gap-4 px-5">
            <div className="space-y-1.5">
              <CardTitle className="text-base">{tc("shortNames.title")}</CardTitle>
              <CardDescription>{tc("shortNames.hint")}</CardDescription>
            </div>
            {can.setLegalForm ? (
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
        {data.admin && client.prospect ? (
          <Card className="h-fit gap-4 py-5 shadow-xs">
            <CardHeader className="px-5">
              <CardTitle className="text-base">{ti("conflictCheck")}</CardTitle>
              <CardDescription>{ti("pitchConflictHint")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 px-5 text-sm">
              <ConflictMatches search={data.conflictSearch} />
              <ApiButton
                endpoint={`/api/clients/${client.id}/conflict-search`}
                label={data.conflictSearch ? ti("searchAgain") : ti("runSearch")}
                icon={<Search />}
              />
            </CardContent>
          </Card>
        ) : null}
        {data.admin ? (
          <Card className="h-fit gap-4 py-5 shadow-xs">
            <CardHeader className="px-5">
              <CardTitle className="text-base">{tp("clientPeople")}</CardTitle>
              <CardDescription>{tp("clientPeopleHint")}</CardDescription>
            </CardHeader>
            <CardContent className="px-5">
              {client.prospect ? (
                <p className="text-sm text-muted-foreground">{tE("noAccountsYet")}</p>
              ) : (
              <Button asChild size="sm" variant="outline">
                <Link href={`/clients/${client.id}/people`}>
                  <UsersRound />
                  {tp("manage")}
                </Link>
              </Button>
              )}
            </CardContent>
          </Card>
        ) : null}
        </div>
      </div>
    </>
  );
}
