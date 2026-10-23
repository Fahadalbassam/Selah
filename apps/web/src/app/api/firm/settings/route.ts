import { z } from "zod";
import { route } from "@/server/http";
import { CHECKIN_DAYS, FIRM_SETTING_RANGES as R } from "@/lib/firm-settings";
import { getFirmSettings, updateFirmSettings } from "@/services/firm-settings";

// The ranges are lib/firm-settings, which the database checks agree with.
const days = ([min, max]: readonly [number, number]) => z.number().int().min(min).max(max);
const body = z
  .object({
    intakeEmail: z.union([z.email().max(254), z.literal(""), z.null()]),
    suggestionsEnabled: z.boolean(),
    clientKpisEnabled: z.boolean(),
    kpiGraceDays: days(R.kpiGraceDays),
    staleDays: days(R.staleDays),
    checkinDays: z.array(days([CHECKIN_DAYS.min, CHECKIN_DAYS.max])).max(CHECKIN_DAYS.count),
    accessReviewDays: days(R.accessReviewDays),
    restrictedMaxAdmins: days(R.restrictedMaxAdmins),
    minimalPurgeDays: days(R.minimalPurgeDays),
    transcriptKeepDays: days(R.transcriptKeepDays),
    chatArchiveDays: days(R.chatArchiveDays),
    chatAfterCloseDays: days(R.chatAfterCloseDays),
    chatIdleDeleteDays: days(R.chatIdleDeleteDays),
  })
  .partial()
  .strict();

export const GET = route({}, ({ tx, principal }) => getFirmSettings(tx, principal));

export const PATCH = route({ body }, ({ tx, principal, body }) => updateFirmSettings(tx, principal, body));
