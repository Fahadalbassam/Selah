import { describe, expect, it } from "vitest";
import { renderClientReportHtml, type ClientReportHtmlInput, type ClientReportNumbers } from "@/lib/client-report-html";

const nums = (over: Partial<ClientReportNumbers> = {}): ClientReportNumbers => ({
  total: 10,
  verified: 2,
  notApplicable: 0,
  superseded: 0,
  open: 8,
  overdue: 3,
  awaitingReview: 1,
  blocked: 1,
  implementedPct: 20,
  ...over,
});

const input = (over: Partial<ClientReportHtmlInput> = {}): ClientReportHtmlInput => ({
  locale: "ar",
  firmName: "Mizan",
  clientName: 'Nukhba <script>alert("x")</script>',
  total: nums(),
  projects: [
    { title: "1. Governance <b>", state: null, numbers: nums({ total: 2, verified: 1, implementedPct: 50 }) },
    { title: "2. Rollout", state: "Closed", numbers: nums({ total: 8, verified: 1, implementedPct: 12.5 }) },
  ],
  departments: [],
  attention: [{ title: "Charter <img src=x>", project: "Governance", owner: null, dueDate: "2026-10-01", status: "Blocked", overdue: true }],
  exportedOn: "2026-10-24",
  t: (key, values) => `${key}${values ? JSON.stringify(values) : ""}`,
  ...over,
});

describe("client report PDF page", () => {
  it("escapes everything people wrote and carries no script", () => {
    const html = renderClientReportHtml(input());
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toContain("<img");
    expect(html).not.toContain("Governance <b>");
    expect(html).not.toMatch(/(src|href)=["']?https?:/i);
  });

  it("shows the pooled total with the per-project breakdown, in the reading direction", () => {
    const html = renderClientReportHtml(input({ locale: "en" }));
    expect(html).toContain('<html lang="en" dir="ltr">');
    expect(html).toContain('<p class="pct">20%</p>');
    expect(html).toContain("byProject");
    expect(html).toContain("13%"); // 12.5 rounded, as on the screen
    expect(renderClientReportHtml(input())).toContain('dir="rtl"');
  });

  it("leaves out the department table when the client doesn't use departments", () => {
    expect(renderClientReportHtml(input())).not.toContain("byDepartment");
    const html = renderClientReportHtml(input({ departments: [{ name: "HR", numbers: nums() }] }));
    expect(html).toContain("byDepartment");
  });
});
