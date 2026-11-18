import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { StructureBody, shownDepth, shownParam } from "@/components/org-chart/structure-body";
import { StructurePdfButton } from "@/components/org-chart/structure-pdf";
import { PageHeader } from "@/components/page-header";
import { withPrincipal } from "@/server/page";
import { getStructure, hasStructure } from "@/services/org-chart";
import { DepartmentTabs } from "../department-tabs";

// The client's own organisation structure, read only (org chart, part 2): the
// current version and the earlier ones, as the firm published them. The
// client's admins read every name; a manager every title, and names only as
// the database sends them (her branch, while names are shown). Action owners
// have no tab (404), and the firm's draft never reaches this page.
export default async function StructurePage({ searchParams }: { searchParams: Promise<{ version?: string; depth?: string }> }) {
  const { version, depth } = await searchParams;
  const data = await withPrincipal(async (tx, principal) => {
    if (principal.orgKind !== "client" || !["client_admin", "client_manager"].includes(principal.role)) return null;
    // No tab and no page until a version is published.
    if (!(await hasStructure(tx, principal, principal.orgId))) return null;
    return { orgId: principal.orgId, structure: await getStructure(tx, principal, principal.orgId, version ?? null) };
  });
  if (!data?.structure.shown) notFound();
  const { structure } = data;
  const t = await getTranslations("orgChart");
  const { levels, depth: shownLevels } = shownDepth(structure, depth);
  return (
    <>
      <PageHeader title={t("titleClient")} description={t("hintClient")}>
        {structure.shown?.units.length ? (
          <StructurePdfButton
            endpoint={`/api/clients/${data.orgId}/structure/pdf`}
            version={shownParam(structure)}
            levels={levels}
            depth={shownLevels}
            names={structure.shown.names !== "none"}
          />
        ) : null}
      </PageHeader>
      <DepartmentTabs current="structure" />
      <StructureBody structure={structure} base="/departments/structure" depthParam={depth} audience="client" />
    </>
  );
}
