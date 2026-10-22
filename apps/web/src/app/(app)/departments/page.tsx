import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { DepartmentsManager } from "@/components/departments-manager";
import { PageHeader } from "@/components/page-header";
import { withPrincipal } from "@/server/page";
import { listPeople } from "@/services/accounts";
import { getEngagement } from "@/services/engagement";

// The client's own departments. Its admin manages them; managers see them.
export default async function DepartmentsPage() {
  const data = await withPrincipal(async (tx, principal) => {
    if (principal.orgKind !== "client" || !["client_admin", "client_manager"].includes(principal.role)) return null;
    const engagement = await getEngagement(tx, principal, principal.orgId);
    const people = engagement.canManageDepartments
      ? (await listPeople(tx, principal, principal.orgId)).people.filter((p) => p.active)
      : [];
    return { engagement, people };
  });
  if (!data) notFound();
  const t = await getTranslations("engagement.departments");
  return (
    <>
      <PageHeader title={t("title")} description={t("hintClient")} />
      <DepartmentsManager data={data.engagement} people={data.people.map((p) => ({ userId: p.userId, name: p.name }))} />
    </>
  );
}
