// The public inquiry form's fixed choices, shared by the page and the API.
// The service and sector lists live in the database (GET /api/intake/options).

/** Bump when the privacy notice text changes; the form sends back the version it showed. */
export const PRIVACY_NOTICE_VERSION = "2026-10-24";

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
/** The requester's place in the company; the list doubles as the "who decides" signal. */
export const REQUESTER_ROLES = ["owner_chair", "board_member", "ceo", "executive", "family_member", "manager", "other"] as const;
/** How the requester wants to be reached. Phone and WhatsApp need a number. */
export const CONTACT_CHANNELS = ["email", "phone", "whatsapp"] as const;
/** Light questions for family businesses only. */
export const FAMILY_GENERATIONS = ["first", "second", "third_plus"] as const;
export const FAMILY_WORKING = ["none", "1-3", "4-10", "11+"] as const;
export const FAMILY_GOVERNANCE = ["charter", "council", "both", "none", "unsure"] as const;
export const FAMILY_OWNERSHIP: readonly string[] = ["family_single_owner", "family_multi_partner"];
export const WHY_NOW_MAX = 500;
/** The self-check questions (mirroring the firm's survey of family businesses). */
export const SELF_CHECKS = ["hasStrategy", "hasOrgChart", "hasDelegationMatrix", "hasPolicies", "hasSops", "hasKpis"] as const;

/** How an inquiry reached the firm. Staff enter every source but the public form. */
export const INQUIRY_SOURCES = ["website", "referral", "existing_client", "tender", "firm_outreach"] as const;
export const ENTERED_SOURCES = ["referral", "existing_client", "tender", "firm_outreach"] as const;
/** An Etimad tender number, as inquiry_tender_fields allows. */
export const TENDER_NUMBER = /^[0-9A-Za-z-]{1,40}$/;
