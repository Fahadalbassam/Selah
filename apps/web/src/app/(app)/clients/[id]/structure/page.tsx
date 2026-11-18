import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { StructureBody, shownDepth, shownParam } from "@/components/org-chart/structure-body";
import { StructurePdfButton } from "@/components/org-chart/structure-pdf";
import { PageHeader } from "@/components/page-header";
import { isUuid } from "@/lib/ids";
import { localName } from "@/lib/names";
import { withPrincipal } from "@/server/page";
import { canReadStructure, getStructure } from "@/services/org-chart";
import { ClientTabs } from "../client-tabs";

// A client's organisation structure, firm side, read only (org chart, part 2):
// the current version, the firm's draft (marked, never shown to the client)
// and the history. For the firm admin, the client's lead and deputy, and
// consultants staffed on its projects, observers included; anyone else 404.
export default async function ClientStructurePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ version?: string; depth?: string }>;
}) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const { version, depth } = await searchParams;
  const structure = await withPrincipal(async (tx, principal) => {
    if (principal.orgKind !== "firm" || !canReadStructure(principal, id)) return null;
    return getStructure(tx, principal, id, version ?? null);
  });
  if (!structure) notFound();
  const t = await getTranslations("orgChart");
  const ar = (await getLocale()) === "ar";
  const { levels, depth: shownLevels } = shownDepth(structure, depth);
  return (
    <>
      <Link href={`/clients/${id}`} className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4 rtl:-scale-x-100" />
        {localName(structure.client, ar)}
      </Link>
      <PageHeader title={t("title")} description={t("hint")}>
        {structure.shown?.units.length ? (
          <StructurePdfButton
            endpoint={`/api/clients/${id}/structure/pdf`}
            version={shownParam(structure)}
            levels={levels}
            depth={shownLevels}
            names={structure.shown.names !== "none"}
          />
        ) : null}
      </PageHeader>
      <ClientTabs clientId={id} current="structure" structure />
      <StructureBody structure={structure} base={`/clients/${id}/structure`} depthParam={depth} audience="firm" />
    </>
  );
}
