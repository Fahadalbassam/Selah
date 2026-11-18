// The Help page (page audit U17, batch 1): it is not a second home page. It
// keeps three things: the person's consultants (one list, with how to reach
// them), a way to write to the firm's management, and the common questions.
import { readFileSync } from "node:fs";
import { createTranslator } from "next-intl";
import { describe, expect, it } from "vitest";
import ar from "../messages/ar.json";
import en from "../messages/en.json";
import { helpConsultants } from "@/lib/help";

const person = (userId: string, name: string, lead = false, deputy = false) => ({ userId, name, email: `${userId}@firm.test`, isLead: lead, isDeputy: deputy });

describe("your consultants, as one list", () => {
  it("names each person once: the lead first, then the deputy, then the others by name, each with the projects they work on", () => {
    const list = helpConsultants({
      lead: person("lead", "Khalid", true),
      deputy: person("deputy", "Noura", false, true),
      projects: [
        { id: "p1", title: "Board governance", consultants: [person("lead", "Khalid", true), person("omar", "Omar"), person("deputy", "Noura", false, true)] },
        { id: "p2", title: "Delegation matrix", consultants: [person("omar", "Omar"), person("amal", "Amal")] },
      ],
    });
    expect(list.map((c) => c.userId)).toEqual(["lead", "deputy", "amal", "omar"]);
    expect(list.find((c) => c.userId === "omar")!.projects).toEqual(["Board governance", "Delegation matrix"]);
    expect(list.find((c) => c.userId === "lead")!.projects).toEqual(["Board governance"]);
    expect(list.find((c) => c.userId === "amal")!.email).toBe("amal@firm.test");
  });

  it("is empty when the firm named nobody and the person is on no project", () => {
    expect(helpConsultants({ lead: null, deputy: null, projects: [] })).toEqual([]);
    expect(helpConsultants({ lead: null, deputy: null, projects: [{ id: "p", title: "T", consultants: [] }] })).toEqual([]);
  });
});

describe("the page itself", () => {
  const page = readFileSync("src/app/(app)/help/page.tsx", "utf8");

  it("holds the consultants, then the message to the firm's management, then the questions; nothing a home page shows", () => {
    expect(page).not.toMatch(/ActionsTable|openActions|steps\./);
    const at = (s: string) => page.indexOf(s);
    expect(at("consultants.title")).toBeGreaterThan(-1);
    expect(at("<ProblemForm")).toBeGreaterThan(at("consultants.title"));
    expect(at("faq.title")).toBeGreaterThan(at("<ProblemForm"));
    // One solid button on the page: the form's Send.
    expect(page).not.toMatch(/buttonVariants\(\{ variant: "default"/);
  });

  it("has no first steps and no second list of the person's actions in its texts", () => {
    for (const m of [ar, en]) {
      expect(Object.keys(m.help)).not.toContain("steps");
      // Only the action page's "Ask your consultant" button is left of that card.
      expect(Object.keys(m.help.ask)).toEqual(["button"]);
    }
  });
});

describe("writing to the firm's management (a way to reach the firm admin)", () => {
  const tr = (locale: "ar" | "en") =>
    createTranslator({ locale, messages: locale === "ar" ? ar : en, namespace: "help.problem" }) as unknown as (key: string, values?: Record<string, string | number>) => string;

  it("says who reads it, the firm by its own name when known, and that the consultants do not", () => {
    expect(tr("ar")("title")).toContain("إدارة المكتب");
    expect(tr("en")("title")).toMatch(/firm's management/);
    expect(tr("ar")("leadNamed", { firm: "ميزان للاستشارات" })).toContain("ميزان للاستشارات");
    expect(tr("en")("leadNamed", { firm: "Mizan Advisory" })).toContain("Mizan Advisory");
    expect(tr("ar")("hint", { n: 5 })).toContain("لا إلى مستشاريك");
    expect(tr("en")("hint", { n: 5 })).toMatch(/not your consultants/);
  });

  it("is not called a technical problem any more, on either side", () => {
    for (const s of [ar.help.problem.title, ar.help.support.title, ar.notifications.kinds.support_requested, ar.audit.actions.support_request_create]) {
      expect(s).not.toContain("تقنية");
    }
    for (const s of [en.help.problem.title, en.help.support.title, en.notifications.kinds.support_requested, en.audit.actions.support_request_create]) {
      expect(s).not.toMatch(/technical/i);
    }
  });
});
