import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ExportButton } from "@/components/export-button";
import { PageHeader } from "@/components/page-header";
import { withPrincipal } from "@/server/page";
import { importContext } from "@/services/plan-import";
import { getProject } from "@/services/queries";
import { ImportWizard } from "./import-wizard";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Import findings, recommendations and actions from Excel or Word: firm staff who can write the plan. */
export default async function ImportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const { project, ctx } = await withPrincipal(async (tx, principal) => ({
    project: (await getProject(tx, principal, id)).project,
    ctx: await importContext(tx, principal, id),
  }));
  if (!ctx) notFound();
  const t = await getTranslations("planImport");
  return (
    <>
      <Link href={`/projects/${project.id}`} className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4 rtl:-scale-x-100" />
        {project.title}
      </Link>
      <PageHeader title={t("title")} description={t("description", { project: project.title })}>
        <ExportButton endpoint={`/api/projects/${project.id}/import/template`} label={t("template")} />
      </PageHeader>
      <ImportWizard projectId={project.id} ctx={ctx} />
    </>
  );
}
