import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { HeadSuggestions } from "@/components/org-chart/head-suggestions";
import { PeopleView } from "@/components/org-chart/people-view";
import { ShowNamesSwitch } from "@/components/org-chart/show-names-switch";
import { StructureBody, shownDepth, shownParam, structureViews } from "@/components/org-chart/structure-body";
import { StructurePdfButton } from "@/components/org-chart/structure-pdf";
import { StructureRequests } from "@/components/org-chart/structure-requests";
import { PageHeader } from "@/components/page-header";
import { ClientPeopleTabs } from "@/components/people-tabs";
import { clientPeopleTabs } from "@/lib/people-tabs";
import { withPrincipal } from "@/server/page";
import {
  canReadRequests,
  droppedHoldings,
  getStructure,
  hasStructure,
  headSuggestions,
  holderCandidates,
  listChangeRequests,
  listVacancies,
} from "@/services/org-chart";

// The client's own organisation structure (org chart, part 2): the current
// version and the earlier ones, as the firm published them. The client's
// admins read every name; a manager every title, and names only as the
// database sends them (her branch, while names are shown). Each name with an
// account opens that person's work card, read as the reader (part 3). The
// client's admin also keeps the people in positions current here ("People
// in positions"); the structure itself is the firm's. Part 5 adds, for the
// client's admin: the switch that shows names to the company's managers on
// the current version, "Suggest a change" with what became of each
// suggestion, and the department-head suggestion; and for everyone, the
// reading tools on the drawing. Action owners have no tab (404; they see
// "your manager" in their own menu), and the firm's draft never reaches this
// page. It is a tab of the company's People page, beside Departments; when
// the company does not use departments, a manager has People and this tab
// only (the Departments page sends her here); the admin keeps all three.
export default async function StructurePage({ searchParams }: { searchParams: Promise<{ version?: string; depth?: string; view?: string; focus?: string }> }) {
  const { version, depth, view: viewParam, focus } = await searchParams;
  const data = await withPrincipal(async (tx, principal) => {
    if (principal.orgKind !== "client" || !["client_admin", "client_manager"].includes(principal.role)) return null;
    // No tab and no page until a version is published.
    if (!(await hasStructure(tx, principal, principal.orgId))) return null;
    const structure = await getStructure(tx, principal, principal.orgId, version ?? null);
    const tabs = clientPeopleTabs({ admin: principal.role === "client_admin", departmentsEnabled: structure.client.departmentsEnabled, structure: true });
    const { views, view } = structureViews(structure, viewParam);
    const people = view === "people";
    return {
      orgId: principal.orgId,
      structure,
      tabs,
      views,
      view,
      candidates: people ? await holderCandidates(tx, principal, principal.orgId) : [],
      vacancies: people ? await listVacancies(tx, principal, principal.orgId) : [],
      dropped: people ? await droppedHoldings(tx, principal, principal.orgId) : [],
      // The company's suggestions and what became of them: its admins only.
      requests: canReadRequests(principal, principal.orgId) ? await listChangeRequests(tx, principal, principal.orgId) : null,
      heads: await headSuggestions(tx, principal, principal.orgId),
    };
  });
  if (!data?.structure.shown) notFound();
  const { structure, view } = data;
  const t = await getTranslations("orgChart");
  const { levels, depth: shownLevels } = shownDepth(structure, depth);
  // The names switch, on the version in effect (the one managers read names on): the client's admin.
  const current = structure.current;
  const switchShown = structure.can.canSetShowNames && current && structure.shown?.version.id === current.id && !structure.client.minimalRecords;
  return (
    <>
      <ClientPeopleTabs tabs={data.tabs} current="structure" />
      <PageHeader title={t("titleClient")} description={t("hintClient")}>
        {structure.shown?.units.length && view === "drawing" ? (
          <StructurePdfButton
            endpoint={`/api/clients/${data.orgId}/structure/pdf`}
            version={shownParam(structure)}
            levels={levels}
            depth={shownLevels}
            names={structure.shown.names !== "none"}
          />
        ) : null}
      </PageHeader>
      {switchShown ? <ShowNamesSwitch versionId={current.id} on={current.showNames} /> : null}
      <StructureBody structure={structure} base="/departments/structure" depthParam={depth} focusParam={focus} audience="client" view={view} views={data.views}>
        {view === "people" && structure.shown ? (
          <PeopleView units={structure.shown.units} positions={structure.shown.positions} vacancies={data.vacancies} candidates={data.candidates} dropped={data.dropped} side="client" />
        ) : null}
      </StructureBody>
      <HeadSuggestions clientId={data.orgId} items={data.heads} />
      {data.requests ? (
        <StructureRequests
          clientId={data.orgId}
          side="client"
          canClose={false}
          canSuggest={structure.can.canSuggest}
          items={data.requests.items.map((r) => ({ ...r, createdAt: r.createdAt.toISOString(), closedAt: r.closedAt?.toISOString() ?? null }))}
        />
      ) : null}
    </>
  );
}
