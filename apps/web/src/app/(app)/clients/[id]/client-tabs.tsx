import { getTranslations } from "next-intl/server";
import { LinkTabs } from "@/components/link-tabs";

/**
 * The client page's tabs, firm side: the page itself, its Departments and its
 * Structure (only for the people who may read the structure: the firm admin,
 * the client's lead and deputy, and consultants staffed on its projects).
 * Each is its own address; nothing is added to the sidebar.
 */
export async function ClientTabs({ clientId, current, structure }: { clientId: string; current: "overview" | "departments" | "structure"; structure: boolean }) {
  const t = await getTranslations("orgChart.tabs");
  const tabs = [
    { key: "overview", href: `/clients/${clientId}`, label: t("overview") },
    { key: "departments", href: `/clients/${clientId}/departments`, label: t("departments") },
    ...(structure ? [{ key: "structure", href: `/clients/${clientId}/structure`, label: t("structure") }] : []),
  ];
  return <LinkTabs label={t("label")} tabs={tabs} current={tabs.find((x) => x.key === current)?.href ?? ""} />;
}
