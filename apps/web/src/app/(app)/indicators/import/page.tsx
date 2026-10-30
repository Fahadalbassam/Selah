import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/page-header";
import { isUuid } from "@/lib/ids";
import { localName } from "@/lib/names";
import { withPrincipal } from "@/server/page";
import { dataSettings, importContext } from "@/services/indicator-data";
import { IndicatorImportWizard } from "./import-wizard";

/** Bring a client's indicator figures in from an Excel or CSV export: for clients that share files or are connected. */
export default async function IndicatorImportPage({ searchParams }: { searchParams: Promise<{ client?: string }> }) {
  const { client } = await searchParams;
  const data = await withPrincipal(async (tx, principal) => {
    const clientId = client && isUuid(client) ? client : principal.orgKind === "client" ? principal.orgId : null;
    if (!clientId) return null;
    const ctx = await importContext(tx, principal, clientId).catch(() => null);
    if (!ctx) return null;
    const s = await dataSettings(tx, principal, clientId);
    return { ctx, client: s.client, firm: principal.orgKind === "firm" };
  });
  if (!data) notFound();
  const [t, locale] = await Promise.all([getTranslations("indicatorImport"), getLocale()]);
  const ar = locale === "ar";
  return (
    <>
      <Link
        href={`/indicators/data?client=${data.client.id}`}
        className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4 rtl:-scale-x-100" />
        {t("back")}
      </Link>
      <PageHeader title={t("title")} description={data.firm ? t("descriptionFirm", { client: localName(data.client, ar) }) : t("description")} />
      <IndicatorImportWizard clientId={data.client.id} ctx={data.ctx} onBehalf={data.firm} />
    </>
  );
}
