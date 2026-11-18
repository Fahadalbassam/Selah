import { Plus } from "@/components/animate-ui/icons/plus";
import { MorphTitle } from "@/components/morph";
import { Megaphone } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { ApiButton, FormDialog } from "@/components/form-dialog";
import { LinkTabs } from "@/components/link-tabs";
import { PageHeader } from "@/components/page-header";
import { SectionHeader } from "@/components/section-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { authorize } from "@/authz";
import { clientTeamLine, splitPitches } from "@/lib/clients-list";
import { localName } from "@/lib/names";
import { withPrincipal } from "@/server/page";
import { listGroups } from "@/services/client-groups";
import { intakeOptions } from "@/services/intake";
import { listDeletions } from "@/services/offboarding";
import { listClients } from "@/services/queries";
import { clientDirectory, myPendingRequests, pendingRequestCounts } from "@/services/staffing";
import { EmptyState } from "@/components/empty-state";
import { Users } from "@/components/animate-ui/icons/users";
import { ToneBadge } from "@/components/tone-badge";
import { EnterInquiryDialog } from "../inquiries/enter-inquiry";
import { GroupsView } from "./groups-view";

const VIEWS = { clients: "/clients", groups: "/clients?view=groups" } as const;

// The firm's clients, with the holding groups as a second view (page audit
// rows 17 and 21: the sidebar's "All clients" and "Client groups" became this
// page's two views; /clients/groups redirects here). Each client's team is the
// lead's name and "and N others"; pitches have a small table of their own
// (October review item 3). "Enter an inquiry" sits beside "Start a pitch".
export default async function ClientsPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const view = (await searchParams).view === "groups" ? "groups" : "clients";
  const data = await withPrincipal(async (tx, principal) => {
    if (principal.orgKind !== "firm") return null;
    const firm = { orgId: principal.orgId, firmOrgId: principal.orgId, projectId: null };
    const admin = principal.role === "firm_admin";
    if (view === "groups") {
      return {
        view,
        admin,
        canCreate: authorize(principal, "client_group.manage", { type: "client_group", ...firm }).allowed,
        groups: await listGroups(tx, principal),
      } as const;
    }
    const canEnter = authorize(principal, "inquiry.enter", { type: "inquiry", ...firm }).allowed;
    const directory = await clientDirectory(tx, principal);
    return {
      view,
      admin,
      canAdd: authorize(principal, "organization.create", { type: "organization", ...firm }).allowed,
      canPitch: authorize(principal, "organization.pitch", { type: "organization", ...firm }).allowed,
      clients: await listClients(tx, principal),
      directory: principal.role === "consultant" ? directory.filter((c) => !c.assigned) : [],
      // "Enter an inquiry": the clients this person can name as the referrer or the returning client, as on Inquiries.
      inquiry: canEnter ? { options: await intakeOptions(tx), clients: directory.filter((c) => admin || c.assigned) } : null,
      mine: await myPendingRequests(tx, principal),
      requests: await pendingRequestCounts(tx, principal),
      // Clients deleted after their retention period: only this record remains (firm admin).
      deletions: await listDeletions(tx, principal),
    } as const;
  });
  if (!data) notFound();
  const tNav = await getTranslations("nav");
  const tabs = (
    <LinkTabs
      label={tNav("clientViews")}
      tabs={[
        { href: VIEWS.clients, label: tNav("allClients") },
        { href: VIEWS.groups, label: tNav("clientGroups") },
      ]}
      current={VIEWS[view]}
    />
  );
  if (data.view === "groups") {
    return (
      <>
        {tabs}
        <GroupsView admin={data.admin} canCreate={data.canCreate} groups={data.groups} />
      </>
    );
  }

  const [t, tc, tE, tOff, format] = await Promise.all([
    getTranslations("staffing"),
    getTranslations("clients"),
    getTranslations("engagements"),
    getTranslations("offboarding"),
    getFormatter(),
  ]);
  const day = (d: Date | string | null) => (d ? format.dateTime(new Date(d), { dateStyle: "medium" }) : "—");
  const ar = (await getLocale()) === "ar";
  const name = (c: { name: string; nameAr: string | null }) => localName(c, ar);
  const { clients, pitches } = splitPitches(data.clients);

  // The lead by name and the others counted, instead of a row of initials.
  const team = (c: (typeof data.clients)[number]) => {
    const line = clientTeamLine({ lead: c.lead, others: c.consultants });
    const all = c.consultants.join(ar ? "، " : ", ");
    if (line.kind === "nobody") return <span className="text-muted-foreground">{tc("none")}</span>;
    if (line.kind === "noLead") {
      return (
        <span className="text-muted-foreground" title={all}>
          {t("noLead")} · {t("consultantsCount", { n: line.others })}
        </span>
      );
    }
    return (
      <span>
        <span className="font-medium">{line.lead}</span>
        {line.others ? (
          <span className="text-muted-foreground" title={all}>
            {" "}
            {t("andOthers", { n: line.others })}
          </span>
        ) : null}
      </span>
    );
  };

  const table = (list: typeof clients) => (
    <div className="overflow-hidden rounded-xl border bg-card">
      <Table>
        <TableHeader className="bg-muted/50">
          <TableRow>
            <TableHead>{t("client")}</TableHead>
            <TableHead>{t("team")}</TableHead>
            <TableHead className="text-end">{t("projects")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {list.map((c) => {
            const pending = data.requests.get(c.id) ?? 0;
            return (
              <TableRow key={c.id}>
                <TableCell className="font-medium">
                  <Link href={`/clients/${c.id}`} className="hover:underline">
                    <MorphTitle name={`client-${c.id}`} className="inline-block">
                      {name(c)}
                    </MorphTitle>
                  </Link>
                  {c.status === "archived" ? (
                    <ToneBadge tone="neutral" className="ms-2">
                      {tOff("archived")}
                    </ToneBadge>
                  ) : null}
                  {pending ? (
                    <ToneBadge tone="waiting" className="ms-2">
                      {t("requests", { count: pending })}
                    </ToneBadge>
                  ) : null}
                </TableCell>
                <TableCell className="whitespace-normal">{team(c)}</TableCell>
                <TableCell className="text-end tabular-nums">{c.projectCount}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );

  return (
    <>
      {tabs}
      <PageHeader title={tc("title")} description={data.admin ? t("subtitleAdmin") : t("subtitle")}>
        {data.inquiry ? (
          <EnterInquiryDialog
            sectors={data.inquiry.options.sectors}
            services={data.inquiry.options.services}
            clients={data.inquiry.clients.map((c) => ({ id: c.id, name: name(c) }))}
          />
        ) : null}
        {data.canPitch ? (
          <FormDialog
            trigger={
              <Button variant={data.canAdd ? "outline" : "default"}>
                <Megaphone />
                {tE("startPitch")}
              </Button>
            }
            title={tE("startPitch")}
            description={tE("startPitchHint")}
            endpoint="/api/clients/pitch"
            fields={[
              { name: "name", label: t("nameEn"), required: true, maxLength: 200, dir: "ltr" },
              { name: "nameAr", label: t("nameAr"), maxLength: 200, dir: "rtl" },
              { name: "projectTitle", label: tE("pitchProject"), required: true, maxLength: 200, placeholder: tE("pitchProjectPlaceholder") },
            ]}
            submitLabel={tE("startPitchButton")}
            redirectTo="/clients/:id"
          />
        ) : null}
        {data.canAdd ? (
          <FormDialog
            trigger={
              <Button>
                <Plus />
                {t("addClient")}
              </Button>
            }
            title={t("addClient")}
            description={t("addClientHint")}
            endpoint="/api/clients"
            fields={[
              { name: "name", label: t("nameEn"), required: true, dir: "ltr" },
              { name: "nameAr", label: t("nameAr"), dir: "rtl" },
            ]}
            submitLabel={t("create")}
            redirectTo="/clients/:id"
          />
        ) : null}
      </PageHeader>

      {clients.length === 0 && pitches.length === 0 ? <EmptyState icon={<Users animateOnView />} description={tc("empty")} /> : null}
      {clients.length ? table(clients) : null}

      {pitches.length ? (
        <section className="space-y-3">
          <SectionHeader title={t("pitches")} description={t("pitchesHint")} />
          {table(pitches)}
        </section>
      ) : null}

      {data.directory.length ? (
        <Card className="gap-4 py-5 shadow-xs">
          <CardHeader className="px-5">
            <CardTitle className="text-base">{t("otherClients")}</CardTitle>
            <CardDescription>{t("otherHint")}</CardDescription>
          </CardHeader>
          <CardContent className="divide-y px-5">
            {data.directory.map((c) => {
              const requestId = data.mine.get(c.id);
              return (
                <div key={c.id} className="flex items-center justify-between gap-4 py-3">
                  <span className="text-sm font-medium">{name(c)}</span>
                  {requestId ? (
                    <span className="flex items-center gap-3">
                      <ToneBadge tone="waiting">{t("pending")}</ToneBadge>
                      <ApiButton endpoint={`/api/join-requests/${requestId}/withdraw`} label={t("withdraw")} variant="ghost" />
                    </span>
                  ) : (
                    <FormDialog
                      trigger={
                        <Button variant="outline" size="sm">
                          {t("requestJoin")}
                        </Button>
                      }
                      title={t("requestTitle", { client: name(c) })}
                      description={t("requestHint")}
                      endpoint={`/api/clients/${c.id}/join-requests`}
                      fields={[{ name: "reason", label: t("reason"), type: "textarea", required: true }]}
                      submitLabel={t("send")}
                    />
                  )}
                </div>
              );
            })}
          </CardContent>
        </Card>
      ) : null}

      {data.deletions.length ? (
        <Card className="gap-4 py-5 shadow-xs">
          <CardHeader className="px-5">
            <CardTitle className="text-base">{tOff("deletions.title")}</CardTitle>
            <CardDescription>{tOff("deletions.hint")}</CardDescription>
          </CardHeader>
          <CardContent className="px-5">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{tOff("deletions.client")}</TableHead>
                  <TableHead>{tOff("deletions.archived")}</TableHead>
                  <TableHead>{tOff("deletions.kept")}</TableHead>
                  <TableHead>{tOff("deletions.deleted")}</TableHead>
                  <TableHead>{tOff("deletions.what")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.deletions.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell className="font-medium">{name(d)}</TableCell>
                    <TableCell className="tabular-nums">{day(d.archivedAt)}</TableCell>
                    <TableCell className="tabular-nums">{day(d.retainUntil)}</TableCell>
                    <TableCell className="tabular-nums">{day(d.deletedAt)}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {tOff("deletions.counts", {
                        projects: d.counts.projects ?? 0,
                        actions: d.counts.actions ?? 0,
                        documents: d.counts.documents ?? 0,
                        people: d.counts.people ?? 0,
                      })}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : null}
    </>
  );
}
