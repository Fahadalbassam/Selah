import { getTranslations } from "next-intl/server";
import { ActionsTable } from "@/components/actions-table";
import { ExportButton } from "@/components/export-button";
import { ListPager, pageParam } from "@/components/list-pager";
import { PageHeader } from "@/components/page-header";
import { withPrincipal } from "@/server/page";
import { actionCounts, isOverdue, listActions, PAGE_SIZE } from "@/services/queries";

export default async function ActionsPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const page = pageParam((await searchParams).page);
  const { rows, total, mine } = await withPrincipal(async (tx, principal) => {
    const mine = principal.role === "action_owner";
    const counts = await actionCounts(tx, principal, { mineOnly: mine });
    return {
      rows: await listActions(tx, principal, { mineOnly: mine, page }),
      total: counts.reduce((n, c) => n + c.n, 0),
      mine,
    };
  });
  const [t, tExport] = await Promise.all([getTranslations("actionsPage"), getTranslations("exports")]);
  return (
    <>
      <PageHeader title={t("title")} description={mine ? t("mine") : t("all")}>
        {total ? <ExportButton endpoint="/api/actions/export" label={tExport("excel")} title={tExport("downloadExcel")} /> : null}
      </PageHeader>
      <ActionsTable rows={rows.map((r) => ({ ...r, overdue: isOverdue(r) }))} empty={t("empty")} />
      <ListPager page={page} pageSize={PAGE_SIZE} total={total} href={(p) => (p === 1 ? "/actions" : `/actions?page=${p}`)} />
    </>
  );
}
