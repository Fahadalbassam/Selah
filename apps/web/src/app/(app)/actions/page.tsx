import { getTranslations } from "next-intl/server";
import { ActionsTable } from "@/components/actions-table";
import { ExportButton } from "@/components/export-button";
import { PageHeader } from "@/components/page-header";
import { withPrincipal } from "@/server/page";
import { isOverdue, listActions } from "@/services/queries";

export default async function ActionsPage() {
  const { rows, mine } = await withPrincipal(async (tx, principal) => {
    const mine = principal.role === "action_owner";
    return { rows: await listActions(tx, principal, { mineOnly: mine }), mine };
  });
  const [t, tExport] = await Promise.all([getTranslations("actionsPage"), getTranslations("exports")]);
  return (
    <>
      <PageHeader title={t("title")} description={mine ? t("mine") : t("all")}>
        {rows.length ? <ExportButton endpoint="/api/actions/export" label={tExport("excel")} title={tExport("downloadExcel")} /> : null}
      </PageHeader>
      <ActionsTable rows={rows.map((r) => ({ ...r, overdue: isOverdue(r) }))} empty={t("empty")} />
    </>
  );
}
