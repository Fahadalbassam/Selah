import { getTranslations } from "next-intl/server";
import { LinkTabs } from "@/components/link-tabs";

const HREF = { departments: "/departments", structure: "/departments/structure" } as const;

/**
 * The client's Departments page and its Structure tab (client admins and
 * managers; action owners have neither). Which tabs a reader gets is
 * departmentTabs() (lib/org-chart.ts); a single tab draws no tab row.
 */
export async function DepartmentTabs({ tabs, current }: { tabs: ("departments" | "structure")[]; current: "departments" | "structure" }) {
  if (tabs.length < 2) return null;
  const t = await getTranslations("orgChart.clientTabs");
  return <LinkTabs label={t("label")} tabs={tabs.map((k) => ({ href: HREF[k], label: t(k) }))} current={HREF[current]} />;
}
