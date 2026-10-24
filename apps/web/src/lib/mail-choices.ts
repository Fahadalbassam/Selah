// Each person's mail choices (migration 0019), for the preferences form and
// its route. The database holds the same lists, defaults and limits, and
// tests/db/rule-parity.test.ts proves the two agree.

/** How often a kind of work mail comes. */
export const MAIL_CADENCES = ["instant", "daily", "weekly", "off"] as const;
export type MailCadence = (typeof MAIL_CADENCES)[number];

/** Reminders come from the daily job, so they have no "instant". */
export const REMINDER_CADENCES = ["daily", "weekly", "off"] as const satisfies readonly MailCadence[];

/** What someone who never saved a choice gets. Times are the firm's (Asia/Riyadh). */
export const MAIL_DEFAULTS = {
  updates: "instant" as MailCadence,
  reminders: "daily" as MailCadence,
  quietFrom: "20:00" as string | null,
  quietTo: "07:00" as string | null,
  saturday: false,
  ramadan: true,
};
export type MailChoices = typeof MAIL_DEFAULTS;

/** The firm's Ramadan hours until an admin sets others. */
export const RAMADAN_DEFAULTS = { mailFrom: "10:00", mailTo: "15:00" } as const;
/** Days from the first to the last day of Ramadan (29 or 30 days). */
export const RAMADAN_SPAN_DAYS = [28, 29] as const;

/** Mail about a person's own action, sent at once or batched into the summary. */
export const UPDATE_MAIL_KINDS = [
  "action.assigned",
  "action.revision_requested",
  "action.verified_complete",
  "evidence.requested",
  // The thread on an action (F11): to whoever the comment reached, not only the owner.
  "action.commented",
  "action.mentioned",
] as const;

/**
 * Mail held through quiet hours, Friday, Saturday and outside Ramadan hours.
 * Account and security mail, meeting invites and mail to inquirers go at once.
 */
export const WORK_MAIL_KINDS = [...UPDATE_MAIL_KINDS, "follow_up.digest", "access_review.due", "inquiry.new"] as const;

/** The weekly summary goes out on this day (0 = Sunday, the first day of the Saudi week). */
export const WEEKLY_DAY = 0;

/** Who a step of the reminder ladder reaches (app_action_ladder). */
export const LADDER_AUDIENCES = [
  "owner",
  "client_managers",
  "department_head",
  "client_lead",
  "project_lead",
  "sponsor",
  "client_admins",
  "watching_firm_admins",
] as const;
export type LadderAudience = (typeof LADDER_AUDIENCES)[number];

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
export const isClockTime = (s: string) => HHMM.test(s);
