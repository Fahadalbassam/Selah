// The public inquiry form's fixed choices, shared by the page and the API.
// The service and sector lists live in the database (GET /api/intake/options).

/** Bump when the privacy notice text changes; the form sends back the version it showed. */
export const PRIVACY_NOTICE_VERSION = "2026-10-20";

export const EMPLOYEE_BANDS = ["1-9", "10-49", "50-249", "250+"] as const;
export const OWNERSHIP_TYPES = [
  "sole",
  "family_single_owner",
  "family_multi_partner",
  "llc",
  "joint_stock",
  "non_profit",
  "other",
] as const;
export const URGENCIES = ["exploring", "within_3_months", "urgent"] as const;
export const HEARD_FROM = ["referral", "search", "social_media", "event", "existing_client", "other"] as const;
/** The self-check questions (mirroring the firm's survey of family businesses). */
export const SELF_CHECKS = ["hasStrategy", "hasOrgChart", "hasDelegationMatrix", "hasPolicies", "hasSops", "hasKpis"] as const;
