// The help page for client people (F13; trimmed in batch 1, page audit U17).
// The database holds the same limits (app_support_per_day(), the
// support_body check), and tests/db/help.test.ts proves the two agree.

export const SUPPORT_LIMITS = {
  /** Messages to the firm's management one person may send in 24 hours. */
  perDay: 5,
  /** Characters in one message. */
  body: 2000,
} as const;

/** Where the action page's thread starts, so "Ask your consultant" can jump to it. */
export const THREAD_ANCHOR = "discussion";
/** The browser event that button sends; the thread mentions the lead and takes focus. */
export const ASK_EVENT = "selah:ask-consultant";

/** The questions on the help page, in order (messages: help.faq.<key>). */
export const FAQ_KEYS = ["states", "claimed", "awaiting", "revision", "blocked", "dueDate", "whoSees"] as const;

interface Consultant {
  userId: string;
  name: string;
  email: string;
  isLead: boolean;
  isDeputy: boolean;
}

/**
 * The help page's one list of consultants (page audit U17): the client's lead
 * first, then the deputy, then everyone else staffed on the person's
 * projects by name, each person once, with the titles of the projects they
 * work on. The people come from getHelp() (app_my_consultants), nothing more.
 */
export function helpConsultants(help: {
  lead: Consultant | null;
  deputy: Consultant | null;
  projects: { id: string; title: string; consultants: Consultant[] }[];
}): (Consultant & { projects: string[] })[] {
  const byId = new Map<string, Consultant & { projects: string[] }>();
  const add = (c: Consultant) => {
    const known = byId.get(c.userId);
    if (known) return known;
    const fresh = { ...c, projects: [] as string[] };
    byId.set(c.userId, fresh);
    return fresh;
  };
  if (help.lead) add(help.lead);
  if (help.deputy) add(help.deputy);
  for (const p of help.projects) for (const c of p.consultants) add(c).projects.push(p.title);
  const rank = (c: Consultant) => (c.userId === help.lead?.userId ? 0 : c.userId === help.deputy?.userId ? 1 : 2);
  return [...byId.values()].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}
