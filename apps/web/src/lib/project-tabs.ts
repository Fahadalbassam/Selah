// The project page's tabs (page audit 4.3, batch 3; decision D2: Trace goes).
// Plain module: the page, the service that loads it and the tests share it.
//
// Eleven tabs became five, plus Closing while it is needed:
//   Plan · Requests and files · Meetings · Progress · People (· Closing)
// The same tabs for every role and every kind of project; what differs is
// what each holds, and a tab the reader has nothing to open in is not drawn
// (an action owner reads no project numbers, so has no Progress).

export const PROJECT_TABS = ["plan", "files", "meetings", "progress", "people", "closing"] as const;
export type ProjectTab = (typeof PROJECT_TABS)[number];

/** What the reader may open on this project, as the services answered. */
export interface TabFacts {
  /** The project's meetings (null from listMeetings when the reader may not read them). */
  meetings: boolean;
  /** The numbers and reports (projectMetrics), or the activity record (the firm and the client admin). */
  progress: boolean;
  /** The firm's staffing, the client's people, the client's named roles, or the firm's consultants for a client reader. */
  people: boolean;
  /** closingTabShown() */
  closing: boolean;
}

/** The tabs the reader gets, in the page's order. Plan and Requests and files are always there. */
export function projectTabs(f: TabFacts): ProjectTab[] {
  return PROJECT_TABS.filter((t) => {
    switch (t) {
      case "plan":
      case "files":
        return true;
      case "meetings":
        return f.meetings;
      case "progress":
        return f.progress;
      case "people":
        return f.people;
      case "closing":
        return f.closing;
    }
  });
}

/**
 * Closing is its own tab while the project is closing or closed, while a
 * request to close is on record (waiting, or answered: the client reads the
 * firm's answer there), or when an earlier closing was cancelled or reopened
 * (its history). Otherwise "Start closing" (the firm) or "Ask the firm to
 * close" (the client) is an item of the page's menu. A pitch has none.
 */
export function closingTabShown(c: { state: string; request: unknown; history: number } | null): boolean {
  if (!c) return false;
  return c.state === "closing" || c.state === "closed" || c.request !== null || c.history > 0;
}

/**
 * Where each tab of the old page lives now (page audit 4.3 and row 4d).
 * Assessments split by side: the firm's are the Sources block on Plan, the
 * client's shared ones a section of Requests and files.
 */
export const OLD_TABS = {
  recs: "plan",
  attention: "plan",
  trace: "plan",
  assessments: { firm: "plan", client: "files" },
  requests: "files",
  docs: "files",
  activity: "progress",
  team: "people",
} as const satisfies Record<string, ProjectTab | { firm: ProjectTab; client: ProjectTab }>;

export type OldTab = keyof typeof OLD_TABS;

/** The new tab an old address stands for, or null when it is not an old address. */
export function oldTabTarget(tab: string | undefined, firm: boolean): ProjectTab | null {
  if (!tab || !Object.hasOwn(OLD_TABS, tab)) return null;
  const to = OLD_TABS[tab as OldTab];
  return typeof to === "string" ? to : firm ? to.firm : to.client;
}

/**
 * The tab to open for `?tab=…`: one of the reader's tabs, or Plan. An old
 * address is answered by oldTabTarget() first (the page redirects to it).
 */
export function openTab(tab: string | undefined, tabs: readonly ProjectTab[]): ProjectTab {
  return tabs.find((t) => t === tab) ?? "plan";
}

/** A tab's address. Plan, the default, has none. */
export function projectTabHref(projectId: string, tab: ProjectTab, extra?: Record<string, string>): string {
  const p = new URLSearchParams();
  if (tab !== "plan" || extra) p.set("tab", tab);
  for (const [k, v] of Object.entries(extra ?? {})) p.set(k, v);
  const s = p.toString();
  return s ? `/projects/${projectId}?${s}` : `/projects/${projectId}`;
}
