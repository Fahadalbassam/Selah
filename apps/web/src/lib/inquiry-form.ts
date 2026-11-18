// The public inquiry form's steps, checks and the body it sends, kept apart
// from the screen so tests can hold them: every answer the visitor gives is
// on one step, shown again on the review step, and sent to the API
// (tests/inquiry-form.test.ts). The API and submit_inquiry() check again.
import { CONTACT_CHANNELS, FAMILY_OWNERSHIP, SELF_CHECKS } from "@/lib/intake";

type SelfCheckKey = (typeof SELF_CHECKS)[number];

export interface Answers {
  orgName: string;
  orgNameAr: string;
  sector: string;
  employeeBand: string;
  ownershipType: string;
  familyGeneration: string;
  familyWorking: string;
  familyGovernance: string;
  contactName: string;
  requesterRole: string;
  contactRole: string;
  email: string;
  phone: string;
  contactChannel: (typeof CONTACT_CHANNELS)[number];
  preferredLanguage: "ar" | "en";
  services: string[];
  whyNow: string;
  message: string;
  urgency: string;
  heardFrom: string;
  selfCheck: Partial<Record<SelfCheckKey, boolean>>;
  consent: boolean;
  marketingConsent: boolean;
}

export function emptyAnswers(locale: "ar" | "en"): Answers {
  return {
    orgName: "", orgNameAr: "", sector: "", employeeBand: "", ownershipType: "",
    familyGeneration: "", familyWorking: "", familyGovernance: "",
    contactName: "", requesterRole: "", contactRole: "", email: "", phone: "", contactChannel: "email", preferredLanguage: locale,
    services: [], whyNow: "", message: "", urgency: "", heardFrom: "", selfCheck: {}, consent: false, marketingConsent: false,
  };
}

// The organisation and the person are one step (page audit row 50, batch 1).
// Size, ownership and the family questions come after the need, and are optional.
export const STEPS = ["you", "needs", "about", "review"] as const;
export type Step = (typeof STEPS)[number];
export const REVIEW = STEPS.length - 1;

/** Which step asks each answer (and each field the API names), to route a server's refusal back to it. */
export const FIELD_STEP: Record<keyof Answers | "privacyNoticeVersion", number> = {
  orgName: 0, orgNameAr: 0, sector: 0,
  contactName: 0, requesterRole: 0, contactRole: 0, email: 0, phone: 0, contactChannel: 0, preferredLanguage: 0,
  services: 1, whyNow: 1, message: 1, urgency: 1, heardFrom: 1,
  employeeBand: 2, ownershipType: 2, familyGeneration: 2, familyWorking: 2, familyGovernance: 2, selfCheck: 2,
  consent: 3, marketingConsent: 3, privacyNoticeVersion: 3,
};

/** The review step's rows, by the step that asks them: every answer is shown before sending. */
export const REVIEW_ROWS: { step: number; key: string; fields: (keyof Answers)[] }[] = [
  { step: 0, key: "orgName", fields: ["orgName", "orgNameAr"] },
  { step: 0, key: "sector", fields: ["sector"] },
  { step: 0, key: "contactName", fields: ["contactName", "requesterRole", "contactRole"] },
  { step: 0, key: "email", fields: ["email"] },
  { step: 0, key: "phone", fields: ["phone"] },
  { step: 0, key: "channel", fields: ["contactChannel"] },
  { step: 0, key: "language", fields: ["preferredLanguage"] },
  { step: 1, key: "services", fields: ["services"] },
  { step: 1, key: "whyNow", fields: ["whyNow"] },
  { step: 1, key: "message", fields: ["message"] },
  { step: 1, key: "urgency", fields: ["urgency"] },
  { step: 1, key: "heardFrom", fields: ["heardFrom"] },
  { step: 2, key: "ownership", fields: ["ownershipType"] },
  { step: 2, key: "size", fields: ["employeeBand"] },
  { step: 2, key: "family", fields: ["familyGeneration", "familyWorking", "familyGovernance"] },
  { step: 2, key: "today", fields: ["selfCheck"] },
];

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** One step's checks; they mirror the API's. Each answer is checked on the step that asks it. */
export function validateStep(step: number, a: Answers): Record<string, string> {
  const e: Record<string, string> = {};
  const on = (field: keyof Answers) => FIELD_STEP[field] === step;
  if (on("orgName") && !a.orgName.trim()) e.orgName = "required";
  if (on("sector") && !a.sector) e.sector = "required";
  if (on("contactName") && !a.contactName.trim()) e.contactName = "required";
  if (on("requesterRole") && !a.requesterRole) e.requesterRole = "required";
  if (on("email") && !EMAIL.test(a.email.trim())) e.email = a.email.trim() ? "email" : "required";
  if (on("phone")) {
    if (a.phone && !/^[+0-9 ()-]{1,30}$/.test(a.phone.trim())) e.phone = "phone";
    else if (a.contactChannel !== "email" && !a.phone.trim()) e.phone = "phoneForChannel";
  }
  if (on("services") && a.services.length === 0) e.services = "services";
  if (on("whyNow") && !a.whyNow.trim()) e.whyNow = "whyNow";
  if (on("consent") && !a.consent) e.consent = "consent";
  return e;
}

/** What the form sends to POST /api/inquiries: every answer, trimmed; an empty optional one is left out. */
export function inquiryBody(a: Answers, privacyNoticeVersion: string, honeypot?: string) {
  const opt = (v: string) => v.trim() || undefined;
  const family = FAMILY_OWNERSHIP.includes(a.ownershipType);
  return {
    orgName: a.orgName.trim(),
    orgNameAr: opt(a.orgNameAr),
    sector: a.sector,
    employeeBand: a.employeeBand || undefined,
    ownershipType: a.ownershipType || undefined,
    familyGeneration: (family && a.familyGeneration) || undefined,
    familyWorking: (family && a.familyWorking) || undefined,
    familyGovernance: (family && a.familyGovernance) || undefined,
    contactName: a.contactName.trim(),
    requesterRole: a.requesterRole,
    contactRole: opt(a.contactRole),
    email: a.email.trim(),
    phone: opt(a.phone),
    contactChannel: a.contactChannel,
    preferredLanguage: a.preferredLanguage,
    services: a.services,
    whyNow: a.whyNow.trim(),
    message: opt(a.message),
    selfCheck: a.selfCheck,
    urgency: a.urgency || undefined,
    heardFrom: a.heardFrom || undefined,
    consent: a.consent,
    marketingConsent: a.marketingConsent,
    privacyNoticeVersion,
    website: honeypot || undefined,
  };
}
