import { z } from "zod";
import {
  EMPLOYEE_BANDS,
  ENTERED_SOURCES,
  OWNERSHIP_TYPES,
  TENDER_NUMBER,
  URGENCIES,
} from "@/lib/intake";

// An inquiry typed in by firm staff (wave 1, item 8). The database checks it
// again in app_enter_inquiry() and the inquiry_* constraints.

const blank = (v: unknown) =>
  typeof v === "string" ? v.trim() || undefined : v;
const text = (max: number) =>
  z.preprocess(blank, z.string().max(max).optional());
const choice = <T extends readonly [string, ...string[]]>(values: T) =>
  z.preprocess(blank, z.enum(values).optional());

export const enteredInquiryInput = z
  .object({
    source: z.enum(ENTERED_SOURCES),
    orgName: z.preprocess(blank, z.string().min(1).max(200)),
    orgNameAr: text(200),
    sector: z.string().min(1).max(60),
    employeeBand: choice(EMPLOYEE_BANDS),
    ownershipType: choice(OWNERSHIP_TYPES),
    contactName: text(120),
    contactRole: text(120),
    email: z.preprocess(blank, z.email().max(254).optional()),
    phone: z.preprocess(
      blank,
      z
        .string()
        .regex(/^[+0-9 ()-]{0,30}$/)
        .optional(),
    ),
    preferredLanguage: z.enum(["ar", "en"]).default("ar"),
    services: z.array(z.string().min(1).max(60)).max(10).default([]),
    message: text(2000),
    urgency: choice(URGENCIES),
    sourceClientOrgId: z.preprocess(blank, z.uuid().optional()),
    tenderNumber: z.preprocess(
      blank,
      z.string().regex(TENDER_NUMBER).optional(),
    ),
    tenderClosesOn: z.preprocess(blank, z.iso.date().optional()),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.source === "tender" && !v.tenderNumber)
      ctx.addIssue({
        code: "custom",
        path: ["tenderNumber"],
        message: "required for a tender",
      });
    if (v.source !== "tender" && (v.tenderNumber || v.tenderClosesOn))
      ctx.addIssue({
        code: "custom",
        path: ["tenderNumber"],
        message: "tenders only",
      });
    if (v.source === "existing_client" && !v.sourceClientOrgId)
      ctx.addIssue({
        code: "custom",
        path: ["sourceClientOrgId"],
        message: "pick the client",
      });
    if (
      v.sourceClientOrgId &&
      v.source !== "existing_client" &&
      v.source !== "referral"
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["sourceClientOrgId"],
        message: "referrals and returning clients only",
      });
    }
  });

export type EnteredInquiryInput = z.infer<typeof enteredInquiryInput>;
