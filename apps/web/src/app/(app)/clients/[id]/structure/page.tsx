import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { OutlineEditor } from "@/components/org-chart/outline-editor";
import { PeopleView } from "@/components/org-chart/people-view";
import { StructureBody, shownDepth, shownParam, structureViews, viewHref } from "@/components/org-chart/structure-body";
import { StructurePdfButton } from "@/components/org-chart/structure-pdf";
import { PageHeader } from "@/components/page-header";
import { buttonVariants } from "@/components/ui/button-variants";
import { isUuid } from "@/lib/ids";
import { structureHint } from "@/lib/org-chart";
import { localName } from "@/lib/names";
import { withPrincipal } from "@/server/page";
import { canReadDepartments } from "@/services/engagement";
import { droppedHoldings, editorChoices, getPublishedChart, getStructure, hasStructure, holderCandidates, listVacancies } from "@/services/org-chart";
import { ClientTabs } from "../client-tabs";

// A client's organisation structure, firm side: the current version, the
// firm's draft (marked, never shown to the client) and the history (part 2);
// the outline editor on the draft for the firm's editors, and the people in
// positions on the current version for whoever changes holders (part 3). For
// the firm admin, the client's lead and deputy, and consultants staffed on
// its projects, observers included (they read only). The firm's editors have
// the tab before anything exists, to start the structure; anyone else gets
// 404 until there is something to read.
export default async function ClientStructurePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ version?: string; depth?: string; view?: string }>;
}) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const { version, depth, view: viewParam } = await searchParams;
  const data = await withPrincipal(async (tx, principal) => {
    if (principal.orgKind !== "firm" || !(await hasStructure(tx, principal, id))) return null;
    const structure = await getStructure(tx, principal, id, version ?? null);
    const { views, view } = structureViews(structure, viewParam);
    const editing = structure.can.canEditDraft && (!structure.shown || view === "outline");
    const people = view === "people";
    return {
      structure,
      views,
      view,
      departments: canReadDepartments(principal, id),
      choices: editing ? await editorChoices(tx, principal, id) : null,
      // The positions of the live structure: in the draft editor their holders show, read only (B1).
      liveLineages: editing && structure.current ? (await getPublishedChart(tx, principal, id)).positions.map((p) => p.lineageId) : [],
      candidates: people && structure.can.canChangeHolders ? await holderCandidates(tx, principal, id) : [],
      vacancies: people ? await listVacancies(tx, principal, id) : [],
      dropped: people ? await droppedHoldings(tx, principal, id) : [],
    };
  });
  if (!data) notFound();
  const { structure, view, views } = data;
  // Nothing at all yet: only an editor gets here, to start the structure.
  if (!structure.shown && !data.choices) notFound();
  const t = await getTranslations("orgChart");
  const ar = (await getLocale()) === "ar";
  const { levels, depth: shownLevels } = shownDepth(structure, depth);
  const base = `/clients/${id}/structure`;
  const editor = data.choices ? (
    <OutlineEditor
      clientId={id}
      draftId={structure.draftId}
      canRestart={!!structure.current && !!structure.draftId}
      units={structure.shown?.version.state === "draft" ? structure.shown.units : []}
      positions={structure.shown?.version.state === "draft" ? structure.shown.positions : []}
      departments={data.choices.departments}
      liveLineages={data.liveLineages}
      peopleHref={structure.current && structure.can.canChangeHolders ? viewHref(base, null, "people") : null}
      names={!structure.client.minimalRecords}
      banner={!structure.shown}
    />
  ) : null;
  // The editors' way to the draft from the current version: a quiet link, never the page's main action.
  const editLink =
    structure.can.canEditDraft && structure.shown?.version.state !== "draft" && structure.draftId ? (
      <Link href={viewHref(base, "draft", "outline")} className={buttonVariants({ variant: "outline", size: "sm" })}>
        {t("editDraft")}
      </Link>
    ) : null;
  return (
    <>
      <Link href={`/clients/${id}`} className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4 rtl:-scale-x-100" />
        {localName(structure.client, ar)}
      </Link>
      <ClientTabs clientId={id} current="structure" structure departments={data.departments} />
      <PageHeader title={t("title")} description={t(structureHint({ hasUnits: !!structure.shown?.units.length }))}>
        <div className="flex flex-wrap items-center gap-2">
          {editLink}
          {structure.shown?.units.length && view === "drawing" ? (
            <StructurePdfButton
              endpoint={`/api/clients/${id}/structure/pdf`}
              version={shownParam(structure)}
              levels={levels}
              depth={shownLevels}
              names={structure.shown.names !== "none"}
            />
          ) : null}
        </div>
      </PageHeader>
      {structure.shown ? (
        <StructureBody structure={structure} base={base} depthParam={depth} audience="firm" view={view} views={views}>
          {view === "outline" ? editor : null}
          {view === "people" ? (
            <PeopleView units={structure.shown.units} positions={structure.shown.positions} vacancies={data.vacancies} candidates={data.candidates} dropped={data.dropped} side="firm" />
          ) : null}
        </StructureBody>
      ) : (
        editor
      )}
    </>
  );
}
