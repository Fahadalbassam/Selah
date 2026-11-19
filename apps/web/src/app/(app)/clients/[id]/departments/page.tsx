import { notFound, redirect } from "next/navigation";
import { isUuid } from "@/lib/ids";
import { oldClientPageTarget } from "@/lib/client-tabs";

// The client's departments are a section of the client page's People tab now
// (page audit 4.4, batch 5). The old address goes on there; the page itself
// decides who may read them.
export default async function ClientDepartmentsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  redirect(oldClientPageTarget(id, "departments"));
}
