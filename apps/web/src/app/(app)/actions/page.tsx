import { getTranslations } from "next-intl/server";
import { ActionBoardTable } from "@/components/action-board-table";
import { ActionFacets } from "@/components/action-facets";
import { ActionFilterLinks, WaitingLinks } from "@/components/action-filters";
import { ExportButton } from "@/components/export-button";
import { ListPager } from "@/components/list-pager";
import { PageHeader } from "@/components/page-header";
import { actionsHref, parseActionsQuery } from "@/lib/action-filters";
import { withPrincipal } from "@/server/page";
import { actionBoard } from "@/services/action-board";

/**
 * Every action the reader may open, as one list with its filters in the
 * address (page audit 4.6, D2): all, mine, awaiting review, and the rules an
 * open action can break; narrowed by client, project, owner and department.
 * The review queue (/review) and Oversight (/oversight) send people here
 * (next.config.ts); Oversight's per-project columns are the Projects table.
 */
export default async function ActionsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const asked = parseActionsQuery(await searchParams);
  const { board, firm, owner } = await withPrincipal(async (tx, principal) => ({
    board: await actionBoard(tx, principal, asked),
    firm: principal.orgKind === "firm",
    owner: principal.role === "action_owner",
  }));
  const [t, tExport] = await Promise.all([getTranslations("actionsPage"), getTranslations("exports")]);
  const q = board.query;
  const narrowed = !!(q.client || q.project || q.owner || q.department);
  const filtered = q.filter !== "all" || narrowed;
  // An action owner's whole list is their own actions (1b), and the page says so.
  const hint =
    q.filter === "all" && owner ? t("mine") : q.filter === "awaiting-review" && !firm ? t("filters.awaiting-review.hintClient") : t(`filters.${q.filter}.hint`);
  return (
    <>
      <PageHeader title={t("title")} description={hint}>
        {/* The workbook holds every action the reader can see, so it is offered on the whole list only (review L12). */}
        {!filtered && board.total ? <ExportButton endpoint="/api/actions/export" label={tExport("excel")} title={tExport("downloadExcel")} /> : null}
      </PageHeader>
      <ActionFilterLinks query={q} filters={board.filters} counts={board.counts} firm={firm} />
      {q.filter === "awaiting-review" ? <WaitingLinks query={q} any={board.counts["awaiting-review"] ?? 0} long={board.waitingLongCount} /> : null}
      <ActionFacets query={q} {...board.facets} />
      <ActionBoardTable rows={board.rows} filter={q.filter} firm={firm} empty={filtered ? t("emptyFiltered") : t("empty")} />
      <ListPager page={q.page} pageSize={board.pageSize} total={board.total} href={(p) => actionsHref({ ...q, page: p })} />
    </>
  );
}
