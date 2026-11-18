import { getTranslations } from "next-intl/server";
import { LinkTabs } from "@/components/link-tabs";

/** The client's Departments page and its Structure tab (client admins and managers; action owners have neither). */
export async function DepartmentTabs({ current }: { current: "departments" | "structure" }) {
  const t = await getTranslations("orgChart.clientTabs");
  const tabs = [
    { href: "/departments", label: t("departments") },
    { href: "/departments/structure", label: t("structure") },
  ];
  return <LinkTabs label={t("label")} tabs={tabs} current={current === "departments" ? "/departments" : "/departments/structure"} />;
}
