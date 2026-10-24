import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  CONTACT_CHANNELS,
  EMPLOYEE_BANDS,
  FAMILY_GENERATIONS,
  FAMILY_GOVERNANCE,
  FAMILY_OWNERSHIP,
  FAMILY_WORKING,
  HEARD_FROM,
  OWNERSHIP_TYPES,
  PRIVACY_NOTICE_VERSION,
  REQUESTER_ROLES,
  URGENCIES,
  WHY_NOW_MAX,
} from "@/lib/intake";
import { publicRoute } from "@/server/http";
import { submitInquiry } from "@/services/intake";

// The public inquiry form. No session. The database validates again and
// limits each address to 5 an hour (submit_inquiry, baseline: Intake).
const text = (max: number) => z.string().trim().max(max);
const optional = (max: number) => text(max).optional().transform((v) => v || undefined);
const body = z
  .object({
    orgName: text(200).min(1),
    orgNameAr: optional(200),
    sector: text(60).min(1),
    // Asked on a later, optional step.
    employeeBand: z.enum(EMPLOYEE_BANDS).optional(),
    ownershipType: z.enum(OWNERSHIP_TYPES).optional(),
    familyGeneration: z.enum(FAMILY_GENERATIONS).optional(),
    familyWorking: z.enum(FAMILY_WORKING).optional(),
    familyGovernance: z.enum(FAMILY_GOVERNANCE).optional(),
    contactName: text(120).min(1),
    requesterRole: z.enum(REQUESTER_ROLES),
    contactRole: optional(120),
    email: z.email().max(254),
    phone: z
      .string()
      .trim()
      .regex(/^[+0-9 ()-]{0,30}$/)
      .optional()
      .transform((v) => v || undefined),
    contactChannel: z.enum(CONTACT_CHANNELS).default("email"),
    preferredLanguage: z.enum(["ar", "en"]),
    services: z.array(text(60).min(1)).min(1).max(10),
    whyNow: text(WHY_NOW_MAX).min(1),
    message: optional(2000),
    selfCheck: z
      .object({
        hasStrategy: z.boolean(),
        hasOrgChart: z.boolean(),
        hasDelegationMatrix: z.boolean(),
        hasPolicies: z.boolean(),
        hasSops: z.boolean(),
        hasKpis: z.boolean(),
      })
      .partial(),
    urgency: z.enum(URGENCIES).optional(),
    heardFrom: z.enum(HEARD_FROM).optional(),
    consent: z.literal(true),
    // Separate and unticked: hearing from the firm later is the requester's choice (PDPL).
    marketingConsent: z.boolean().default(false),
    // The form must show the current notice.
    privacyNoticeVersion: z.literal(PRIVACY_NOTICE_VERSION),
    // Honeypot: hidden from people, filled in by bots.
    website: z.string().max(500).optional(),
  })
  .superRefine((b, ctx) => {
    // Same rules as submit_inquiry: a number to call or message, family questions for family businesses.
    if (b.contactChannel !== "email" && !b.phone) ctx.addIssue({ code: "custom", path: ["phone"], message: "required" });
    const family = !!b.ownershipType && FAMILY_OWNERSHIP.includes(b.ownershipType);
    if (!family && (b.familyGeneration || b.familyWorking || b.familyGovernance)) {
      ctx.addIssue({ code: "custom", path: ["familyGeneration"], message: "family businesses only" });
    }
  });

export const POST = publicRoute({ body, maxBytes: 16 * 1024 }, async ({ tx, body, ip, userAgent }) => {
  const { website, ...input } = body;
  // Bots get the same answer as people, and nothing is stored.
  if (website) return NextResponse.json({ ref: `INQ-${randomBytes(4).toString("hex").toUpperCase()}` }, { status: 201 });
  const { ref } = await submitInquiry(tx, input, ip, userAgent);
  return NextResponse.json({ ref }, { status: 201 });
});
