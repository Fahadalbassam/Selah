import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/page-header";
import { withPrincipal } from "@/server/page";
import { exceptions, portfolio } from "@/services/oversight";
import { ExceptionsTable, HealthTable, OversightSummary } from "./oversight-view";

/**
 * Oversight across projects (F18): which engagements drift, and what needs
 * chasing. Firm-only; each person sees the projects they can open.
 */
export default async function OversightPage() {
  const data = await withPrincipal(async (tx, principal) => {
    if (principal.orgKind !== "firm") return null;
    return { projects: await portfolio(tx, principal), exceptions: await exceptions(tx, principal) };
  });
  if (!data) notFound();
  const t = await getTranslations("oversight");
  return (
    <>
      <PageHeader title={t("title")} description={t("subtitle")} />
      <OversightSummary projects={data.projects} exceptions={data.exceptions} />
      <HealthTable rows={data.projects} />
      <ExceptionsTable rows={data.exceptions} />
    </>
  );
}
