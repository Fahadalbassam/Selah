import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { withPrincipal } from "@/server/page";
import { listExportPacks } from "@/services/export-pack";
import { myOffboarding } from "@/services/offboarding";
import { ExportPacks } from "@/components/export-packs";

/**
 * For the admin of an archived client, in its grace period (J14.2, J14.4):
 * make the export pack, download it, and confirm receiving it.
 */
export default async function LeavingPage() {
  const data = await withPrincipal(async (tx, principal) => {
    const leaving = await myOffboarding(tx, principal);
    if (!leaving?.admin) return null;
    return { leaving, orgId: principal.orgId, packs: await listExportPacks(tx, principal, principal.orgId) };
  });
  if (!data) notFound();
  const t = await getTranslations("offboarding.pack");
  const format = await getFormatter();
  const until = format.dateTime(data.leaving.graceUntil, { dateStyle: "long" });
  return (
    <>
      <PageHeader title={t("open")} description={t("hintClient", { date: until })} />
      <Card className="max-w-3xl gap-4 py-5 shadow-xs">
        <CardHeader className="px-5">
          <CardTitle className="text-base">{t("title")}</CardTitle>
        </CardHeader>
        <CardContent className="px-5 text-sm">
          <ExportPacks clientId={data.orgId} packs={data.packs} side="client" canMake />
        </CardContent>
      </Card>
    </>
  );
}
