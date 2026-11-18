import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { DepartmentsManager } from "@/components/departments-manager";
import { PageHeader } from "@/components/page-header";
import { departmentTabs } from "@/lib/org-chart";
import { withPrincipal } from "@/server/page";
import { listPeople } from "@/services/accounts";
import { getEngagement } from "@/services/engagement";
import { hasStructure } from "@/services/org-chart";
import { DepartmentTabs } from "./department-tabs";

// The client's own departments. Its admin manages them; managers see them.
// With departments off, a manager is taken to the Structure tab (once there is
// one): this page holds nothing for her then.
export default async function DepartmentsPage() {
  const data = await withPrincipal(async (tx, principal) => {
    if (principal.orgKind !== "client" || !["client_admin", "client_manager"].includes(principal.role)) return null;
    const engagement = await getEngagement(tx, principal, principal.orgId);
    const people = engagement.canManageDepartments
      ? (await listPeople(tx, principal, principal.orgId)).people.filter((p) => p.active)
      : [];
    const tabs = departmentTabs({
      admin: principal.role === "client_admin",
      departmentsEnabled: engagement.departmentsEnabled,
      structure: await hasStructure(tx, principal, principal.orgId),
    });
    return { engagement, people, tabs };
  });
  if (!data) notFound();
  if (!data.tabs.includes("departments")) redirect("/departments/structure");
  const t = await getTranslations("engagement.departments");
  return (
    <>
      <PageHeader title={t("title")} description={t("hintClient")} />
      <DepartmentTabs tabs={data.tabs} current="departments" />
      <DepartmentsManager data={data.engagement} people={data.people.map((p) => ({ userId: p.userId, name: p.name }))} />
    </>
  );
}
