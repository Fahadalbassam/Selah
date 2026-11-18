// Batch 3 (page audit 4.3, U02, U06, U13; decision D2: Trace goes): the
// project page's tabs for every reader, where each old tab's address and
// content went, the rule chips on Plan, and the recommendation dialog's five
// fields (October review, item 5). The database side (which reader gets
// which tab on which kind of project, and that the status line's counts equal
// their lists) is tests/db/project-page.test.ts.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import ar from "../messages/ar.json";
import en from "../messages/en.json";
import { closingTabShown, oldTabTarget, openTab, OLD_TABS, PROJECT_TABS, projectTabHref, projectTabs } from "@/lib/project-tabs";
import { parsePlanRule, planRulesFor, PLAN_RULES } from "@/lib/plan-rules";
import { REC_MAIN_FIELDS, REC_MORE_FIELDS, recMoreOpen } from "@/lib/plan-fields";

const src = (p: string) => readFileSync(join(__dirname, "../src", p), "utf8");
const get = (o: unknown, key: string): unknown => key.split(".").reduce<unknown>((x, k) => (x as Record<string, unknown> | undefined)?.[k], o);

/** The eleven tabs of the page before batch 3 (page audit 4.3, "Today"). */
const BEFORE = ["recs", "progress", "attention", "trace", "meetings", "assessments", "requests", "docs", "activity", "team", "closing"];

describe("the tab set", () => {
  it("is Plan · Requests and files · Meetings · Progress · People, and Closing while it is needed", () => {
    expect(PROJECT_TABS).toEqual(["plan", "files", "meetings", "progress", "people", "closing"]);
    expect(projectTabs({ meetings: true, progress: true, people: true, closing: false })).toEqual(["plan", "files", "meetings", "progress", "people"]);
    expect(projectTabs({ meetings: true, progress: true, people: true, closing: true })).toEqual(["plan", "files", "meetings", "progress", "people", "closing"]);
  });

  it("draws only what the reader may open: an action owner has no Progress, and Plan and files are always there", () => {
    expect(projectTabs({ meetings: true, progress: false, people: true, closing: false })).toEqual(["plan", "files", "meetings", "people"]);
    expect(projectTabs({ meetings: false, progress: false, people: false, closing: false })).toEqual(["plan", "files"]);
  });

  it("shows Closing while closing or closed, while a request is on record, or when there is a closing history; never on a pitch", () => {
    expect(closingTabShown(null)).toBe(false);
    expect(closingTabShown({ state: "active", request: null, history: 0 })).toBe(false);
    expect(closingTabShown({ state: "closing", request: null, history: 0 })).toBe(true);
    expect(closingTabShown({ state: "closed", request: null, history: 0 })).toBe(true);
    expect(closingTabShown({ state: "active", request: { status: "pending" }, history: 0 })).toBe(true);
    expect(closingTabShown({ state: "active", request: null, history: 1 })).toBe(true);
  });
});

describe("old tab addresses", () => {
  it("each old tab has a new place, by side where it split", () => {
    for (const old of BEFORE) {
      const firm = oldTabTarget(old, true) ?? old;
      const client = oldTabTarget(old, false) ?? old;
      expect(PROJECT_TABS, `${old} (firm)`).toContain(firm);
      expect(PROJECT_TABS, `${old} (client)`).toContain(client);
    }
    expect(oldTabTarget("recs", true)).toBe("plan");
    expect(oldTabTarget("attention", true)).toBe("plan");
    expect(oldTabTarget("trace", false)).toBe("plan");
    expect(oldTabTarget("assessments", true)).toBe("plan");
    expect(oldTabTarget("assessments", false)).toBe("files");
    expect(oldTabTarget("requests", false)).toBe("files");
    expect(oldTabTarget("docs", true)).toBe("files");
    expect(oldTabTarget("activity", true)).toBe("progress");
    expect(oldTabTarget("team", false)).toBe("people");
    expect(Object.keys(OLD_TABS).sort()).toEqual(BEFORE.filter((t) => !(PROJECT_TABS as readonly string[]).includes(t)).sort());
  });

  it("are not new addresses, and nothing else is taken for one", () => {
    for (const t of PROJECT_TABS) expect(oldTabTarget(t, true)).toBeNull();
    expect(oldTabTarget(undefined, true)).toBeNull();
    expect(oldTabTarget("constructor", true)).toBeNull();
    expect(oldTabTarget("toString", false)).toBeNull();
  });

  it("the page sends an old address on to the new one before drawing anything", () => {
    const page = src("app/(app)/projects/[id]/page.tsx");
    expect(page).toMatch(/const moved = oldTabTarget\(tab, [^)]+\);\s*if \(moved\) redirect\(projectTabHref\(id, moved/);
  });

  it("a tab the reader does not get opens Plan; the address of Plan is the project's own", () => {
    expect(openTab("progress", ["plan", "files", "meetings", "people"])).toBe("plan");
    expect(openTab("people", ["plan", "files", "people"])).toBe("people");
    expect(openTab(undefined, ["plan"])).toBe("plan");
    expect(projectTabHref("p", "plan")).toBe("/projects/p");
    expect(projectTabHref("p", "files")).toBe("/projects/p?tab=files");
    expect(projectTabHref("p", "plan", { rule: "late" })).toBe("/projects/p?tab=plan&rule=late");
  });

  it("no link in the app points at an old tab any more", () => {
    for (const f of ["services/notifications.ts", "services/home.ts", "services/today.ts", "app/(app)/clients/[id]/offboarding-card.tsx", "app/(app)/recommendations/[id]/page.tsx"]) {
      for (const old of Object.keys(OLD_TABS)) expect(src(f), `${f} ?tab=${old}`).not.toContain(`tab=${old}`);
    }
  });
});

describe("Trace goes (D2), its parts on Plan", () => {
  it("has no tab, no component, no route and no service left", () => {
    const page = src("app/(app)/projects/[id]/page.tsx");
    expect(page).not.toMatch(/trace/i);
    expect(existsSync(join(__dirname, "../src/app/api/projects/[id]/trace/route.ts"))).toBe(false);
    expect(src("services/insight.ts")).not.toContain("projectTrace");
    expect(src("app/(app)/projects/[id]/insight.tsx")).not.toContain("function Trace");
    expect(get(en, "insight.trace")).toBeUndefined();
    expect(get(ar, "insight.trace")).toBeUndefined();
  });

  it("the evidence and the review result show on an opened action row; the finding line names its assessment", () => {
    const plan = src("app/(app)/projects/[id]/plan-actions.tsx");
    expect(plan).toContain("CollapsibleContent");
    expect(plan).toMatch(/review\.outcome/);
    expect(plan).toMatch(/evidence\.map/);
    expect(src("services/queries.ts")).toMatch(/assessmentTitle: assessments\.title/);
  });
});

describe("the rule chips on Plan", () => {
  it("are the six rules of Needs attention and Oversight's two, the firm's measures for the firm only", () => {
    expect(PLAN_RULES).toEqual(["late", "blocked", "no-activity", "date-moved", "sent-back", "no-owner", "waiting-long", "disputed"]);
    expect(planRulesFor(true)).toEqual([...PLAN_RULES]);
    expect(planRulesFor(false)).toEqual(["late", "blocked"]);
    expect(parsePlanRule("sent-back", true)).toBe("sent-back");
    expect(parsePlanRule("sent-back", false)).toBeNull();
    expect(parsePlanRule(["late"], false)).toBe("late");
    expect(parsePlanRule("nonsense", true)).toBeNull();
  });

  it("each has its name in both languages", () => {
    for (const r of PLAN_RULES) {
      expect(get(ar, `projectPage.rules.${r}`), r).toEqual(expect.any(String));
      expect(get(en, `projectPage.rules.${r}`), r).toEqual(expect.any(String));
    }
  });
});

describe("the recommendation dialog (October item 5)", () => {
  it("shows five fields and keeps the rest behind More", () => {
    expect(REC_MAIN_FIELDS).toEqual(["title", "priority", "accountable", "dueDate", "rationale"]);
    expect(REC_MORE_FIELDS).toEqual(["finding", "source", "department", "targetOutcome", "requiredEvidence", "visibility"]);
    const dialog = src("app/(app)/projects/[id]/plan-dialogs.tsx");
    expect(dialog).toContain("recMoreOpen(");
    expect(dialog).toMatch(/<CollapsibleContent forceMount[^>]*data-more/);
  });

  it("opens More by itself when it holds something already", () => {
    expect(recMoreOpen({})).toBe(false);
    expect(recMoreOpen({ defaultFindingId: "f" })).toBe(true);
    expect(recMoreOpen({ values: { findingId: null, departmentId: null, targetOutcome: null, requiredEvidence: null } })).toBe(false);
    expect(recMoreOpen({ values: { findingId: null, departmentId: null, targetOutcome: "x", requiredEvidence: null } })).toBe(true);
  });
});

describe("the screen standard on the project page", () => {
  it("Add a recommendation is Plan's one solid button; Excel, Import and Add a finding are in its menu", () => {
    const menu = src("app/(app)/projects/[id]/plan-add.tsx");
    expect(menu).toMatch(/key: "finding"/);
    expect(menu).toMatch(/key: "import"/);
    expect(menu).toMatch(/key: "excel"/);
    const page = src("app/(app)/projects/[id]/page.tsx");
    // Every other "Add a recommendation" is gone (U06: there were four).
    expect(page.match(/tPlan\("rec\.add"\)/g)?.length ?? 0).toBeLessThanOrEqual(1);
  });

  it("Edit details, Watch and the closing steps are in the page's menu, not buttons in the header", () => {
    const menu = src("app/(app)/projects/[id]/project-menu.tsx");
    for (const k of ["edit", "watch", "startClosing", "askToClose"]) expect(menu).toContain(`key: "${k}"`);
  });

  it("the client's upload is on Requests and files; the Files card keeps Add a file for the firm only (October item 13)", () => {
    expect(src("components/file-explorer.tsx")).toMatch(/orgKind === "firm" \? <UploadDialog/);
    expect(src("app/(app)/projects/[id]/page.tsx")).toContain("<AddFileDialog");
  });
});

describe("words", () => {
  const keys = [
    "projectPage.tabs.plan",
    "projectPage.tabs.files",
    "projectPage.tabs.meetings",
    "projectPage.tabs.progress",
    "projectPage.tabs.people",
    "projectPage.status.verified",
    "projectPage.status.late",
    "projectPage.status.waiting",
    "projectPage.sources.title",
    "projectPage.files.title",
    "projectPage.files.add",
    "projectPage.files.shared",
    "projectPage.unanswered.title",
    "projectPage.menu.label",
    "projectPage.consultants.title",
    "plan.rec.more",
  ];
  it("every new label exists in Arabic and English", () => {
    for (const k of keys) {
      expect(get(ar, k), k).toEqual(expect.any(String));
      expect(get(en, k), k).toEqual(expect.any(String));
    }
  });

  it("the status line counts, never a health word (D5)", () => {
    const words = JSON.stringify([get(ar, "projectPage.status"), get(en, "projectPage.status")]);
    expect(words).not.toMatch(/on track|off track|watch|خارج المسار|على المسار|متعثر/i);
  });
});
