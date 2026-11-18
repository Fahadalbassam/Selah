import { getTranslations } from "next-intl/server";
import { LinkTabs } from "@/components/link-tabs";
import { PEOPLE_TAB_HREF, TEAM_TAB_HREF, firmTeamTabs, type ClientPeopleTab, type FirmTeamTab } from "@/lib/people-tabs";

/** Firm staff: the Team page and its Expertise tab (page audit 4.1: Expertise was a sidebar sub-entry). */
export async function TeamTabs({ current }: { current: FirmTeamTab }) {
  const t = await getTranslations("nav");
  return <LinkTabs label={t("teamTabs")} tabs={firmTeamTabs().map((k) => ({ href: TEAM_TAB_HREF[k], label: t(k) }))} current={TEAM_TAB_HREF[current]} />;
}

/**
 * The client's People page with its Departments and Structure tabs (client
 * admins and managers; action owners have none). Which tabs a reader gets is
 * clientPeopleTabs() (lib/people-tabs.ts); a single tab draws no tab row.
 */
export async function ClientPeopleTabs({ tabs, current }: { tabs: ClientPeopleTab[]; current: ClientPeopleTab }) {
  if (tabs.length < 2) return null;
  const t = await getTranslations("orgChart.clientTabs");
  return <LinkTabs label={t("label")} tabs={tabs.map((k) => ({ href: PEOPLE_TAB_HREF[k], label: t(k) }))} current={PEOPLE_TAB_HREF[current]} />;
}
