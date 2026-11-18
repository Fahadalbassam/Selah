import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { CircleCheck } from "@/components/animate-ui/icons/circle-check";
import { DeliverableList } from "@/components/deliverables/deliverable-list";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { withPrincipal } from "@/server/page";
import { deliverablesHandedOver } from "@/services/deliverables";

/**
 * Every file the firm handed over that this person answers for at their
 * company (F21): the ones still waiting first, with Confirm receipt, then the
 * others with their history. The client's admins and managers only; the
 * database decides which deliverables they read.
 */
export default async function DeliverablesPage() {
  const data = await withPrincipal(async (tx, principal) =>
    principal.orgKind === "client" && ["client_admin", "client_manager"].includes(principal.role) ? deliverablesHandedOver(tx, principal) : null,
  );
  if (!data) notFound();
  const t = await getTranslations("deliverables");
  const list = [...data].sort((a, b) => Number(b.can.confirm) - Number(a.can.confirm));
  return (
    <>
      <PageHeader title={t("pageTitle")} description={t("pageHint")} />
      {list.length === 0 ? (
        <EmptyState icon={<CircleCheck animateOnView />} description={t("pageEmpty")} />
      ) : (
        <Card className="gap-4 py-5 shadow-xs">
          <CardContent className="space-y-2 px-5">
            <p className="text-xs text-muted-foreground">{t("receiptOnlyClient")}</p>
            <DeliverableList deliverables={list} firmRun={false} showProject />
          </CardContent>
        </Card>
      )}
    </>
  );
}
