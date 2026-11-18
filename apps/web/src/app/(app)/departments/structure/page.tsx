import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { PeopleView } from "@/components/org-chart/people-view";
import { StructureBody, shownDepth, shownParam, structureViews } from "@/components/org-chart/structure-body";
import { StructurePdfButton } from "@/components/org-chart/structure-pdf";
import { PageHeader } from "@/components/page-header";
import { departmentTabs } from "@/lib/org-chart";
import { withPrincipal } from "@/server/page";
import { droppedHoldings, getStructure, hasStructure, holderCandidates, listVacancies } from "@/services/org-chart";
import { DepartmentTabs } from "../department-tabs";

// The client's own organisation structure (org chart, part 2): the current
// version and the earlier ones, as the firm published them. The client's
// admins read every name; a manager every title, and names only as the
// database sends them (her branch, while names are shown). Each name with an
// account opens that person's work card, read as the reader (part 3). The
// client's admin also keeps the people in positions current here ("People
// in positions"); the structure itself is the firm's. Action owners have no
// tab (404), and the firm's draft never reaches this page. When the company
// does not use departments, a manager has only this tab (the Departments
// page sends her here); the admin keeps both.
export default async function StructurePage({ searchParams }: { searchParams: Promise<{ version?: string; depth?: string; view?: string }> }) {
  const { version, depth, view: viewParam } = await searchParams;
  const data = await withPrincipal(async (tx, principal) => {
    if (principal.orgKind !== "client" || !["client_admin", "client_manager"].includes(principal.role)) return null;
    // No tab and no page until a version is published.
    if (!(await hasStructure(tx, principal, principal.orgId))) return null;
    const structure = await getStructure(tx, principal, principal.orgId, version ?? null);
    const tabs = departmentTabs({ admin: principal.role === "client_admin", departmentsEnabled: structure.client.departmentsEnabled, structure: true });
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
    };
  });
  if (!data?.structure.shown) notFound();
  const { structure, view } = data;
  const t = await getTranslations("orgChart");
  const { levels, depth: shownLevels } = shownDepth(structure, depth);
  return (
    <>
      <DepartmentTabs tabs={data.tabs} current="structure" />
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
      <StructureBody structure={structure} base="/departments/structure" depthParam={depth} audience="client" view={view} views={data.views}>
        {view === "people" && structure.shown ? (
          <PeopleView units={structure.shown.units} positions={structure.shown.positions} vacancies={data.vacancies} candidates={data.candidates} dropped={data.dropped} side="client" />
        ) : null}
      </StructureBody>
    </>
  );
}
