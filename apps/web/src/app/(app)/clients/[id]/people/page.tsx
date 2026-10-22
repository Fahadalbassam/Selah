import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocale } from "next-intl/server";
import { withPrincipal } from "@/server/page";
import { listPeople } from "@/services/accounts";
import { PeopleAdmin } from "../../../team/people-admin";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The firm admin manages a client's accounts.
export default async function ClientPeoplePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const data = await withPrincipal(async (tx, principal) =>
    principal.role === "firm_admin"
      ? { people: await listPeople(tx, principal, id), me: principal.userId, role: principal.role }
      : null,
  );
  if (!data || data.people.organization.kind !== "client") notFound();
  const ar = (await getLocale()) === "ar";
  const org = data.people.organization;
  return (
    <>
      <Link href={`/clients/${id}`} className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4 rtl:-scale-x-100" />
        {(ar ? org.nameAr : null) ?? org.name}
      </Link>
      <PeopleAdmin data={data.people} me={data.me} myRole={data.role} reviewDays={null} />
    </>
  );
}
