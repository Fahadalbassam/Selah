import { getTranslations } from "next-intl/server";
import { LinkTabs } from "@/components/link-tabs";
import { CLIENT_TABS, clientTabHref, type ClientTab } from "@/lib/client-tabs";

/**
 * The firm's client page tabs (page audit 4.4, batch 5): Overview · People ·
 * Setup (lib/client-tabs.ts), then Structure, its own address, once there is
 * a structure the reader may read (the firm admin, the client's lead and
 * deputy, consultants staffed on its projects). The departments are a
 * section of People; `departments` is kept for the Structure page's call and
 * no longer draws a tab. Nothing is added to the sidebar.
 */
export async function ClientTabs({
  clientId,
  current,
  structure,
}: {
  clientId: string;
  current: ClientTab | "structure";
  structure: boolean;
  departments?: boolean;
}) {
  const [t, tOrg] = await Promise.all([getTranslations("clientPage.tabs"), getTranslations("orgChart.tabs")]);
  const tabs = [
    ...CLIENT_TABS.map((k) => ({ key: k as string, href: clientTabHref(clientId, k), label: t(k) })),
    ...(structure ? [{ key: "structure", href: `/clients/${clientId}/structure`, label: tOrg("structure") }] : []),
  ];
  return <LinkTabs label={t("label")} tabs={tabs} current={tabs.find((x) => x.key === current)?.href ?? ""} />;
}
