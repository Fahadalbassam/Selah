// The public inquiry form (page audit row 50, batch 1): its first two steps,
// the organisation and the contact, are one step. Nothing the visitor
// answers is lost on the way: every answer is asked on one step, shown on
// the review step, and sent whole to the API, which takes every one of them.
import { describe, expect, it } from "vitest";
import ar from "../messages/ar.json";
import en from "../messages/en.json";
import { emptyAnswers, FIELD_STEP, inquiryBody, REVIEW, REVIEW_ROWS, STEPS, validateStep, type Answers } from "@/lib/inquiry-form";
import { inquiryBodySchema } from "@/lib/inquiry-schema";
import { PRIVACY_NOTICE_VERSION } from "@/lib/intake";

/** A visitor who answered everything, the optional questions too. */
const full: Answers = {
  orgName: "Al-Waha Trading",
  orgNameAr: "الواحة للتجارة",
  sector: "trade_distribution",
  employeeBand: "50-249",
  ownershipType: "family_multi_partner",
  familyGeneration: "second",
  familyWorking: "4-10",
  familyGovernance: "none",
  contactName: "Sami",
  requesterRole: "ceo",
  contactRole: "Chief executive",
  email: "sami@example.test",
  phone: "+966 55 000 0000",
  contactChannel: "whatsapp",
  preferredLanguage: "en",
  services: ["family_business_governance", "delegation_matrix"],
  whyNow: "A new board wants it settled this year.",
  message: "We want a family charter.",
  urgency: "within_3_months",
  heardFrom: "referral",
  selfCheck: { hasStrategy: false, hasOrgChart: true },
  consent: true,
  marketingConsent: true,
};
const ANSWERS = Object.keys(full) as (keyof Answers)[];
/** The two ticks on the review step itself. */
const ON_REVIEW: (keyof Answers)[] = ["consent", "marketingConsent"];

describe("the steps", () => {
  it("ask for the organisation and the contact on one first step, then the need, the optional questions and the review", () => {
    expect(STEPS).toEqual(["you", "needs", "about", "review"]);
    for (const f of ["orgName", "orgNameAr", "sector", "contactName", "requesterRole", "contactRole", "email", "phone", "contactChannel", "preferredLanguage"] as const) {
      expect(FIELD_STEP[f], f).toBe(0);
    }
  });

  it("ask every answer on exactly one step, the review's two ticks on the review", () => {
    for (const f of ANSWERS) {
      expect(FIELD_STEP[f], f).toBeGreaterThanOrEqual(0);
      expect(FIELD_STEP[f], f).toBe(ON_REVIEW.includes(f) ? REVIEW : FIELD_STEP[f]);
      if (!ON_REVIEW.includes(f)) expect(FIELD_STEP[f], f).toBeLessThan(REVIEW);
    }
  });

  it("check the whole first step at once: organisation and contact", () => {
    expect(Object.keys(validateStep(0, emptyAnswers("ar"))).sort()).toEqual(["contactName", "email", "orgName", "requesterRole", "sector"]);
    expect(validateStep(0, full)).toEqual({});
    expect(validateStep(0, { ...full, phone: "" })).toEqual({ phone: "phoneForChannel" });
    expect(Object.keys(validateStep(1, emptyAnswers("en"))).sort()).toEqual(["services", "whyNow"]);
    expect(validateStep(REVIEW, { ...full, consent: false })).toEqual({ consent: "consent" });
  });

  it("have a name in both languages, Arabic first", () => {
    for (const s of STEPS) {
      expect(ar.inquiry.steps[s as keyof typeof ar.inquiry.steps], s).toBeTruthy();
      expect(en.inquiry.steps[s as keyof typeof en.inquiry.steps], s).toBeTruthy();
    }
  });
});

describe("the review step", () => {
  it("shows every answer, each under the step that asks it, so its Edit opens the right step", () => {
    const shown = REVIEW_ROWS.flatMap((r) => r.fields);
    expect(new Set(shown)).toEqual(new Set(ANSWERS.filter((f) => !ON_REVIEW.includes(f))));
    for (const row of REVIEW_ROWS) for (const f of row.fields) expect(FIELD_STEP[f], `${row.key}.${f}`).toBe(row.step);
  });
});

describe("what the form sends", () => {
  it("carries every answer, and the API takes every one of them unchanged", () => {
    const body = inquiryBody(full, PRIVACY_NOTICE_VERSION);
    const taken = inquiryBodySchema.parse(body);
    for (const f of ANSWERS) expect(taken[f], f).toEqual(full[f]);
    expect(taken.privacyNoticeVersion).toBe(PRIVACY_NOTICE_VERSION);
  });

  it("leaves out only what was not answered, and the family questions outside a family business", () => {
    const bare = inquiryBody({ ...emptyAnswers("ar"), orgName: " Acme ", sector: "services", contactName: "Lina", requesterRole: "ceo", email: "lina@acme.test", services: ["strategic_plan"], whyNow: "Growth", consent: true }, PRIVACY_NOTICE_VERSION);
    expect(inquiryBodySchema.parse(bare)).toMatchObject({ orgName: "Acme", orgNameAr: undefined, phone: undefined, contactRole: undefined, contactChannel: "email" });
    const notFamily = inquiryBody({ ...full, ownershipType: "llc" }, PRIVACY_NOTICE_VERSION);
    expect([notFamily.familyGeneration, notFamily.familyWorking, notFamily.familyGovernance]).toEqual([undefined, undefined, undefined]);
    expect(inquiryBodySchema.safeParse(notFamily).success).toBe(true);
  });
});
