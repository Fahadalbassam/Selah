import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { authorize } from "@/authz";
import { PageHeader } from "@/components/page-header";
import { withPrincipal } from "@/server/page";
import { listProjects } from "@/services/queries";
import { AssistantForm } from "./assistant-form";

export default async function AssistantPage() {
  const projects = await withPrincipal(async (tx, principal) => {
    const all = await listProjects(tx, principal);
    return all.filter(
      (p) => authorize(principal, "assistant.query", { type: "project", id: p.id, orgId: p.orgId, firmOrgId: p.firmOrgId, projectId: p.id }).allowed,
    );
  });
  // Client roles don't have the assistant yet (open decision in the spec).
  if (projects.length === 0) notFound();
  const t = await getTranslations("assistant");
  return (
    <>
      <PageHeader title={t("title")} description={t("subtitle")} />
      <AssistantForm projects={projects.map((p) => ({ id: p.id, title: p.title }))} />
      <p className="text-xs text-muted-foreground">{t("disclaimer")}</p>
    </>
  );
}
