// The org chart's mails and notices (migration 0100): Arabic that reads
// right, the English beside it, and nothing about a person in either.
import { describe, expect, it } from "vitest";
import { renderMail } from "@/lib/mail-templates";
import ar from "../messages/ar.json";
import en from "../messages/en.json";

const kinds = (m: unknown) => (m as { notifications: { kinds: Record<string, string> } }).notifications.kinds;

describe("org chart mails and notices", () => {
  it("the suggestion mail speaks of the client's structure, and of agreeing with the suggestion", () => {
    const m = renderMail("org_chart.change_requested", "/clients/x", "http://selah.test");
    // "Its structure" would point at the admin, not the client; "if you see it" is not "if you agree".
    expect(m.text).toContain("على الهيكل التنظيمي للعميل");
    expect(m.text).not.toContain("هيكله");
    expect(m.text).toContain("إن وافقت عليه");
    expect(m.text).not.toContain("إن رأيته");
    expect(m.text).toContain("if you agree");
  });

  it("the suggestion notice reads right for any client's name, without a verb that has to agree with it", () => {
    expect(kinds(ar).org_chart_change_requested).toBe("اقتراح تعديل على الهيكل التنظيمي لـ{title}");
    expect(kinds(en).org_chart_change_requested).toContain("{title}");
  });

  it("neither mail nor notice carries a name: a line and a link", () => {
    for (const kind of ["org_chart.holder_changed", "org_chart.change_requested"] as const) {
      const m = renderMail(kind, "/clients/x", "http://selah.test");
      expect(m.text).not.toMatch(/\{[a-z]+\}/);
      expect(m.text).toContain("http://selah.test/clients/x");
    }
    for (const messages of [ar, en]) {
      for (const key of ["org_chart_holder_changed", "org_chart_change_requested"]) {
        expect(kinds(messages)[key]!.replace("{title}", "")).not.toMatch(/\{/);
      }
    }
  });
});
