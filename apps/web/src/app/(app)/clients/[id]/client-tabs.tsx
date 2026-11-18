import { getTranslations } from "next-intl/server";
import { LinkTabs } from "@/components/link-tabs";

/**
 * The client page's tabs, firm side, above the page header: the page itself,
 * its Departments (for whoever may open them) and its Structure (once there
 * is a structure the reader may read: the firm admin, the client's lead and
 * deputy, consultants staffed on its projects). Each is its own address;
 * nothing is added to the sidebar; a single tab draws no tab row.
 */
export async function ClientTabs({
  clientId,
  current,
  structure,
  departments,
}: {
  clientId: string;
  current: "overview" | "departments" | "structure";
  structure: boolean;
  departments: boolean;
}) {
  const t = await getTranslations("orgChart.tabs");
  const tabs = [
    { key: "overview", href: `/clients/${clientId}`, label: t("overview") },
    ...(departments ? [{ key: "departments", href: `/clients/${clientId}/departments`, label: t("departments") }] : []),
    ...(structure ? [{ key: "structure", href: `/clients/${clientId}/structure`, label: t("structure") }] : []),
  ];
  if (tabs.length < 2) return null;
  return <LinkTabs label={t("label")} tabs={tabs} current={tabs.find((x) => x.key === current)?.href ?? ""} />;
}
