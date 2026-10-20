import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ActionsTable } from "@/components/actions-table";
import { PageHeader } from "@/components/page-header";
import { withPrincipal } from "@/server/page";
import { isOverdue, listActions } from "@/services/queries";

export default async function ReviewPage() {
  const rows = await withPrincipal(async (tx, principal) => {
    if (principal.orgKind !== "firm") return null;
    return (await listActions(tx, principal)).filter((r) => r.status === "awaiting_review");
  });
  if (!rows) notFound();
  const t = await getTranslations("reviewPage");
  return (
    <>
      <PageHeader title={t("title")} description={t("subtitle")} />
      <ActionsTable rows={rows.map((r) => ({ ...r, overdue: isOverdue(r) }))} empty={t("empty")} />
    </>
  );
}
