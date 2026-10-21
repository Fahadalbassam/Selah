import type { Role } from "./types";

/** Roles that must sign in with a second factor (drizzle/0032_two_factor_rules.sql). */
export const TWO_FACTOR_ROLES: readonly Role[] = ["firm_admin", "consultant", "client_admin"];

/** True when this person must set up two-factor sign-in before using anything else. */
export function mustSetUpTwoFactor(role: Role, enabled: boolean | null | undefined, required: boolean): boolean {
  return required && TWO_FACTOR_ROLES.includes(role) && !enabled;
}
