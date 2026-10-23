import { describe, expect, it } from "vitest";
import { escapeHtml, renderReportHtml, type ReportHtmlInput } from "@/lib/report-html";

const input = (over: Partial<ReportHtmlInput["report"]> = {}, locale: "ar" | "en" = "ar"): ReportHtmlInput => ({
  locale,
  firmName: "Mizan Consulting",
  clientName: "Nukhba",
  projectTitle: "Board governance",
  report: {
    title: 'Q1 <script>alert("x")</script>',
    periodStart: "2027-01-01",
    periodEnd: "2027-03-31",
    author: "Khalid",
    createdAt: "2027-04-02",
    bodyMd: "Line one\n<img src=x onerror=alert(1)>",
    metrics: { total: 10, verified: 4, partially: 1, riskAccepted: 0, notApplicable: 1, superseded: 1, open: 3, overdue: 2, implementedPct: 50 },
    firmOnly: false,
    ...over,
  },
  actions: [{ title: "Draft <b>charter</b>", recommendation: "Adopt a charter", owner: null, dueDate: "2027-02-01", status: "Blocked", overdue: true }],
  exportedOn: "2027-04-10",
  t: (key, values) => `${key}${values ? JSON.stringify(values) : ""}`,
  outcome: (key) => `outcome.${key}`,
});

describe("report PDF page", () => {
  it("escapes everything people wrote and carries no script", () => {
    const html = renderReportHtml(input());
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<b>charter");
    expect(html).toContain("Q1 &lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
    expect(html).not.toMatch(/(src|href)=["']?https?:/i);
  });

  it("follows the reading direction and shows the frozen numbers", () => {
    expect(renderReportHtml(input())).toContain('<html lang="ar" dir="rtl">');
    const html = renderReportHtml(input({}, "en"));
    expect(html).toContain('<html lang="en" dir="ltr">');
    expect(html).toContain("50%");
    expect(html).toContain("implementedOf{&quot;verified&quot;:&quot;4&quot;,&quot;applies&quot;:&quot;8&quot;}");
    expect(html).toContain("overdueMark");
    expect(html).toContain("noOwner");
  });

  it("tells only the firm that the report is not shared yet", () => {
    expect(renderReportHtml(input({ firmOnly: true }))).toContain("firmOnly");
    expect(renderReportHtml(input({ firmOnly: false }))).not.toContain("firmOnly");
  });

  it("handles a report without numbers or notes", () => {
    const html = renderReportHtml(input({ metrics: null, bodyMd: "  " }));
    expect(html).not.toContain('class="headline"');
    expect(html).not.toContain('class="notes"');
    expect(escapeHtml(`'"&`)).toBe("&#39;&quot;&amp;");
  });
});
