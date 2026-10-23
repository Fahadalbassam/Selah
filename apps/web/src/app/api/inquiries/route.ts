import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { EMPLOYEE_BANDS, HEARD_FROM, OWNERSHIP_TYPES, PRIVACY_NOTICE_VERSION, URGENCIES } from "@/lib/intake";
import { publicRoute } from "@/server/http";
import { submitInquiry } from "@/services/intake";

// The public inquiry form. No session. The database validates again and
// limits each address to 5 an hour (submit_inquiry, baseline: Intake).
const text = (max: number) => z.string().trim().max(max);
const optional = (max: number) => text(max).optional().transform((v) => v || undefined);
const body = z.object({
  orgName: text(200).min(1),
  orgNameAr: optional(200),
  crNumber: z
    .string()
    .trim()
    .regex(/^[0-9]{0,20}$/)
    .optional()
    .transform((v) => v || undefined),
  sector: text(60).min(1),
  employeeBand: z.enum(EMPLOYEE_BANDS),
  ownershipType: z.enum(OWNERSHIP_TYPES),
  contactName: text(120).min(1),
  contactRole: optional(120),
  email: z.email().max(254),
  phone: z
    .string()
    .trim()
    .regex(/^[+0-9 ()-]{0,30}$/)
    .optional()
    .transform((v) => v || undefined),
  preferredLanguage: z.enum(["ar", "en"]),
  services: z.array(text(60).min(1)).min(1).max(10),
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
  // The form must show the current notice.
  privacyNoticeVersion: z.literal(PRIVACY_NOTICE_VERSION),
  // Honeypot: hidden from people, filled in by bots.
  website: z.string().max(500).optional(),
});

export const POST = publicRoute({ body, maxBytes: 16 * 1024 }, async ({ tx, body, ip, userAgent }) => {
  const { website, ...input } = body;
  // Bots get the same answer as people, and nothing is stored.
  if (website) return NextResponse.json({ ref: `INQ-${randomBytes(4).toString("hex").toUpperCase()}` }, { status: 201 });
  const { ref } = await submitInquiry(tx, input, ip, userAgent);
  return NextResponse.json({ ref }, { status: 201 });
});
