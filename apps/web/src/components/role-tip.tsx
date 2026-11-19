import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { Hint } from "@/components/hint";

/** The roles a chip or a role column names, each with one sentence under `tips.roles` (big prompt 6.1). */
export const ROLE_TIPS = [
  "firm_admin",
  "consultant",
  "client_admin",
  "client_manager",
  "action_owner",
  "clientLead",
  "clientDeputy",
  "projectLead",
  "observer",
] as const;
export type RoleTipKey = (typeof ROLE_TIPS)[number];

/**
 * A role chip or a role name with what the role does, as a tooltip. It only
 * explains: who may see or do anything is decided on the server.
 */
export function RoleTip({ role, children }: { role: RoleTipKey; children: ReactNode }) {
  const t = useTranslations("tips.roles");
  return <Hint tip={t(role)}>{children}</Hint>;
}
