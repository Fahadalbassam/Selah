import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Users } from "@/components/animate-ui/icons/users";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { withPrincipal } from "@/server/page";
import { expertiseOverview } from "@/services/expertise";
import { ExpertiseTable } from "./expertise-table";

// What each consultant can lead. The firm admin records services and
// sectors; each consultant keeps their own languages and availability.
export default async function ExpertisePage() {
  const data = await withPrincipal(async (tx, principal) =>
    principal.orgKind === "firm" ? { overview: await expertiseOverview(tx, principal), me: principal.userId } : null,
  );
  if (!data) notFound();
  const t = await getTranslations("expertise");
  const { overview } = data;
  return (
    <>
      <PageHeader title={t("title")} description={overview.canManage ? t("hint") : t("hintOwn")} />
      {overview.consultants.length === 0 ? (
        <EmptyState icon={<Users animateOnView />} description={t("empty")} />
      ) : (
        <ExpertiseTable data={overview} me={data.me} />
      )}
      <p className="text-xs text-muted-foreground">{t("footnote")}</p>
    </>
  );
}
