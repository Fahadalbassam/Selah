import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { DepartmentsManager } from "@/components/departments-manager";
import { PageHeader } from "@/components/page-header";
import { isUuid } from "@/lib/ids";
import { localName } from "@/lib/names";
import { withPrincipal } from "@/server/page";
import { listPeople } from "@/services/accounts";
import { getEngagement } from "@/services/engagement";

// A client's departments, from the firm side. The firm admin manages them.
export default async function ClientDepartmentsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const data = await withPrincipal(async (tx, principal) => {
    if (principal.orgKind !== "firm") return null;
    const engagement = await getEngagement(tx, principal, id);
    const people = engagement.canManageDepartments ? (await listPeople(tx, principal, id)).people.filter((p) => p.active) : [];
    return { engagement, people };
  });
  if (!data) notFound();
  const t = await getTranslations("engagement.departments");
  const ar = (await getLocale()) === "ar";
  const org = data.engagement;
  return (
    <>
      <Link href={`/clients/${id}`} className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4 rtl:-scale-x-100" />
        {localName(org, ar)}
      </Link>
      <PageHeader title={t("title")} description={t("hint")} />
      <DepartmentsManager data={org} people={data.people.map((p) => ({ userId: p.userId, name: p.name }))} />
    </>
  );
}
