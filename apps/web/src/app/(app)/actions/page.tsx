import { getTranslations } from "next-intl/server";
import { ActionsTable } from "@/components/actions-table";
import { ActionsTabs } from "@/components/actions-tabs";
import { ExportButton } from "@/components/export-button";
import { ListPager, pageParam } from "@/components/list-pager";
import { PageHeader } from "@/components/page-header";
import { withPrincipal } from "@/server/page";
import { actionCounts, isOverdue, listActions, PAGE_SIZE } from "@/services/queries";

export default async function ActionsPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const page = pageParam((await searchParams).page);
  const { rows, total, mine, firm } = await withPrincipal(async (tx, principal) => {
    const mine = principal.role === "action_owner";
    const counts = await actionCounts(tx, principal, { mineOnly: mine });
    return {
      rows: await listActions(tx, principal, { mineOnly: mine, page }),
      total: counts.reduce((n, c) => n + c.n, 0),
      mine,
      firm: principal.orgKind === "firm",
    };
  });
  const [t, tExport, tNav] = await Promise.all([getTranslations("actionsPage"), getTranslations("exports"), getTranslations("nav")]);
  return (
    <>
      {firm ? <ActionsTabs label={tNav("actions")} labels={{ actions: tNav("actions"), review: tNav("reviewQueue"), oversight: tNav("oversight") }} /> : null}
      <PageHeader title={t("title")} description={mine ? t("mine") : t("all")}>
        {total ? <ExportButton endpoint="/api/actions/export" label={tExport("excel")} title={tExport("downloadExcel")} /> : null}
      </PageHeader>
      <ActionsTable rows={rows.map((r) => ({ ...r, overdue: isOverdue(r) }))} empty={t("empty")} />
      <ListPager page={page} pageSize={PAGE_SIZE} total={total} href={(p) => (p === 1 ? "/actions" : `/actions?page=${p}`)} />
    </>
  );
}
