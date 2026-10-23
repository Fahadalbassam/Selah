import { z } from "zod";
import { route } from "@/server/http";
import { getFirmSettings, updateFirmSettings } from "@/services/firm-settings";

// Ranges match the database's checks (baseline: Firm settings, and the sections of each setting's feature).
const days = (min: number, max: number) => z.number().int().min(min).max(max);
const body = z
  .object({
    intakeEmail: z.union([z.email().max(254), z.literal(""), z.null()]),
    suggestionsEnabled: z.boolean(),
    clientKpisEnabled: z.boolean(),
    kpiGraceDays: days(0, 90),
    staleDays: days(1, 365),
    checkinDays: z.array(days(1, 730)).max(6),
    accessReviewDays: days(7, 365),
    restrictedMaxAdmins: days(1, 10),
    minimalPurgeDays: days(0, 3650),
    transcriptKeepDays: days(1, 90),
    chatArchiveDays: days(7, 365),
    chatAfterCloseDays: days(0, 365),
    // Must also be more than the archive days (checked by the database).
    chatIdleDeleteDays: days(30, 730),
  })
  .partial()
  .strict();

export const GET = route({}, ({ tx, principal }) => getFirmSettings(tx, principal));

export const PATCH = route({ body }, ({ tx, principal, body }) => updateFirmSettings(tx, principal, body));
