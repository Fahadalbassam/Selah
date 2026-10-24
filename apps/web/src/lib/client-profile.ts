import { z } from "zod";
import { LEGAL_FORMS } from "@/lib/assessments";

// A client's legal profile (wave 1, item 7). The database holds the rules
// (check_client_profile, 0011); these lists match its enums.

export const SIZE_BANDS = ["micro", "small", "medium", "large"] as const;
export const SAUDI_REGIONS = [
  "riyadh",
  "makkah",
  "madinah",
  "eastern",
  "qassim",
  "asir",
  "tabuk",
  "hail",
  "northern_borders",
  "jazan",
  "najran",
  "al_baha",
  "al_jawf",
] as const;
export const REGULATORS = ["mc", "cma", "sama", "ia", "cst", "ncnp", "sfda", "moh", "moe", "other"] as const;
export const LISTED_MARKETS = ["main", "parallel"] as const;
export const FISCAL_CALENDARS = ["gregorian", "hijri"] as const;

/** The unified national number: 7, then nine digits. Same as client_profile_unified_number. */
export const UNIFIED_NUMBER = /^7[0-9]{9}$/;
/** An ISIC activity code: four digits (ISIC Rev. 4 class) up to six (the national detail). */
export const ISIC_CODE = /^[0-9]{4,6}$/;

const text = (max: number) =>
  z.preprocess((v) => (typeof v === "string" ? v.trim() || null : v), z.string().min(2).max(max).nullable());
const pattern = (re: RegExp) =>
  z.preprocess((v) => (typeof v === "string" ? v.replace(/\s/g, "") || null : v), z.string().regex(re).nullable());
const choice = <T extends readonly [string, ...string[]]>(values: T) =>
  z.preprocess((v) => (v === "" ? null : v), z.enum(values).nullable());

export const clientProfileInput = z
  .object({
    legalNameAr: text(300),
    legalNameEn: text(300),
    tradeName: text(200),
    unifiedNumber: pattern(UNIFIED_NUMBER),
    isicCode: pattern(ISIC_CODE),
    sectorCode: z.preprocess((v) => (v === "" ? null : v), z.string().max(60).nullable()),
    sizeBand: choice(SIZE_BANDS),
    revenueBand: choice(SIZE_BANDS),
    region: choice(SAUDI_REGIONS),
    regulators: z.array(z.enum(REGULATORS)).max(REGULATORS.length),
    listedMarket: choice(LISTED_MARKETS),
    fiscalYearEndMonth: z.preprocess((v) => (v === "" || v == null ? null : Number(v)), z.number().int().min(1).max(12).nullable()),
    fiscalCalendar: z.enum(FISCAL_CALENDARS),
    // The firm admin only: it decides which assessment criteria are legal requirements.
    legalForm: choice(LEGAL_FORMS).optional(),
  })
  .strict();

export type ClientProfileInput = z.infer<typeof clientProfileInput>;
