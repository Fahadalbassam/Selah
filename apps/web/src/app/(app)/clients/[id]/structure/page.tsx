import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { HeadSuggestions } from "@/components/org-chart/head-suggestions";
import { OutlineEditor } from "@/components/org-chart/outline-editor";
import { StructureRequests } from "@/components/org-chart/structure-requests";
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
import {
  canReadRequests,
  droppedHoldings,
  editorChoices,
  getPublishedChart,
  getStructure,
  hasStructure,
  headSuggestions,
  holderCandidates,
  listChangeRequests,
  listVacancies,
} from "@/services/org-chart";
import { canImport, plannedNames } from "@/services/org-chart-import";
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
  searchParams: Promise<{ version?: string; depth?: string; view?: string; focus?: string }>;
}) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const { version, depth, view: viewParam, focus } = await searchParams;
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
      // Bringing a structure in from Excel, Word or pasted text (part 4): the draft's editors, also before anything exists.
      canImport: canImport(principal, id),
      choices: editing ? await editorChoices(tx, principal, id) : null,
      // Who is planned for the draft's positions (part 4): firm only, shown as plans, never as holders.
      plans: editing && structure.shown?.version.state === "draft" ? await plannedNames(tx, structure.shown.positions.map((p) => p.id)) : {},
      // The positions of the live structure: in the draft editor their holders show, read only (B1).
      liveLineages: editing && structure.current ? (await getPublishedChart(tx, principal, id)).positions.map((p) => p.lineageId) : [],
      candidates: people && structure.can.canChangeHolders ? await holderCandidates(tx, principal, id) : [],
      vacancies: people ? await listVacancies(tx, principal, id) : [],
      dropped: people ? await droppedHoldings(tx, principal, id) : [],
      // The client's suggested changes (part 5), answered here by the firm's editors.
      requests: canReadRequests(principal, id) ? await listChangeRequests(tx, principal, id) : null,
      // Where a linked unit's head is not the department's head: for the firm admin, who manages departments.
      heads: await headSuggestions(tx, principal, id),
    };
  });
  if (!data) notFound();
  const { structure, view, views } = data;
  // Nothing at all yet: only an editor gets here, to start the structure.
  if (!structure.shown && !data.choices) notFound();
  const t = await getTranslations("orgChart");
  const tImport = await getTranslations("orgChartImport");
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
      plans={data.plans}
    />
  ) : null;
  // The editors' way to the draft from the current version: a quiet link, never the page's main action.
  const editLink =
    structure.can.canEditDraft && structure.shown?.version.state !== "draft" && structure.draftId ? (
      <Link href={viewHref(base, "draft", "outline")} className={buttonVariants({ variant: "outline", size: "sm" })}>
        {t("editDraft")}
      </Link>
    ) : null;
  // Publishing (part 5): the page's main action while the draft is shown, for the firm admin, the lead and the deputy.
  const publishLink =
    structure.can.canPublish && structure.shown?.version.state === "draft" && structure.shown.units.length ? (
      <Link href={`${base}/publish`} className={buttonVariants({ size: "sm" })}>
        {t("publish.open")}
      </Link>
    ) : null;
  const requests = data.requests;
  return (
    <>
      <Link href={`/clients/${id}`} className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4 rtl:-scale-x-100" />
        {localName(structure.client, ar)}
      </Link>
      <ClientTabs clientId={id} current="structure" structure departments={data.departments} />
      <PageHeader title={t("title")} description={t(structureHint({ hasUnits: !!structure.shown?.units.length }))}>
        <div className="flex flex-wrap items-center gap-2">
          {publishLink}
          {editLink}
          {data.canImport ? (
            <Link href={`${base}/import`} className={buttonVariants({ variant: "outline", size: "sm" })}>
              {tImport("button")}
            </Link>
          ) : null}
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
        <StructureBody structure={structure} base={base} depthParam={depth} focusParam={focus} audience="firm" view={view} views={views}>
          {view === "outline" ? editor : null}
          {view === "people" ? (
            <PeopleView units={structure.shown.units} positions={structure.shown.positions} vacancies={data.vacancies} candidates={data.candidates} dropped={data.dropped} side="firm" />
          ) : null}
        </StructureBody>
      ) : (
        editor
      )}
      <HeadSuggestions clientId={id} items={data.heads} />
      {requests && requests.items.length ? (
        <StructureRequests
          clientId={id}
          side="firm"
          // The draft's editors answer; nobody does on an archived client, whose structure is read only.
          canClose={requests.canClose && structure.can.canEditDraft}
          canSuggest={false}
          items={requests.items.map((r) => ({ ...r, createdAt: r.createdAt.toISOString(), closedAt: r.closedAt?.toISOString() ?? null }))}
        />
      ) : null}
    </>
  );
}
