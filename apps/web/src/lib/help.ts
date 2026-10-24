// The help page for client people (F13). The database holds the same limits
// (app_support_per_day(), the support_body check), and tests/db/help.test.ts
// proves the two agree.

export const SUPPORT_LIMITS = {
  /** Problem reports one person may send in 24 hours. */
  perDay: 5,
  /** Characters in one report. */
  body: 2000,
} as const;

/** Where the action page's thread starts, so "Ask your consultant" can jump to it. */
export const THREAD_ANCHOR = "discussion";
/** The browser event that button sends; the thread mentions the lead and takes focus. */
export const ASK_EVENT = "selah:ask-consultant";

/** The questions on the help page, in order (messages: help.faq.<key>). */
export const FAQ_KEYS = ["states", "claimed", "awaiting", "revision", "blocked", "dueDate", "whoSees"] as const;
