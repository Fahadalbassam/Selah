// Limits on the firm's settings, for the settings API and page. The database
// holds the same limits as checks on firm_settings, and
// tests/db/rule-parity.test.ts proves the two agree.

/** Inclusive [min, max] for each number of days (or accounts). */
export const FIRM_SETTING_RANGES = {
  kpiGraceDays: [0, 90],
  staleDays: [1, 365],
  accessReviewDays: [7, 365],
  restrictedMaxAdmins: [1, 10],
  minimalPurgeDays: [0, 3650],
  transcriptKeepDays: [1, 90],
  chatArchiveDays: [7, 365],
  chatAfterCloseDays: [0, 365],
  // Must also be more than the archive days (checked by the database).
  chatIdleDeleteDays: [30, 730],
  // Months, not days: the audit log is kept at least 12 (NCA ECC 2-12), and the
  // database never lets a younger entry be removed (audit_log_guard()).
  auditKeepMonths: [12, 120],
} as const satisfies Record<string, readonly [number, number]>;

export type FirmSettingRange = keyof typeof FIRM_SETTING_RANGES;

/** Check-in days after handover: at most `count` days, each in [min, max], in increasing order. */
export const CHECKIN_DAYS = { min: 1, max: 730, count: 6 } as const;
