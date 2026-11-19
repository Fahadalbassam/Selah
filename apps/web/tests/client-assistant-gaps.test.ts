import { describe, expect, it } from "vitest";
import { consultantIntent, mineIntent, myDeadlinesIntent, progressDraftIntent } from "@/lib/assistant-search";
import { clientAnswerProblem, withoutRulings } from "@/lib/client-ai";

// The four client-assistant gaps agreed at Gate B (19 Nov 2026; docs/assistant.md).

describe("my deadlines", () => {
  it("notices a question about the person's own work, in both languages", () => {
    for (const q of [
      "What are my deadlines?",
      "Which of my actions are overdue?",
      "What do I own that is late?",
      "What is assigned to me?",
      "ما المطلوب مني؟",
      "ما الذي عليّ هذا الأسبوع؟",
      "ما المطلوب علي؟",
      "ما مواعيدي القادمة؟",
      "ما إجراءاتي المتأخرة؟",
    ])
      expect(mineIntent(q), q).toBe(true);
  });

  it("does not read the company, the team or a person called Ali as 'mine'", () => {
    for (const q of [
      "What is overdue for my company?",
      "What are my team's deadlines?",
      "What is late in my department?",
      "What is overdue on this project?",
      "ما المطلوب من علي العتيبي؟",
      "ما الإجراءات المتأخرة؟",
    ])
      expect(mineIntent(q), q).toBe(false);
  });

  it("makes 'my deadlines' a status question without a status word", () => {
    expect(myDeadlinesIntent("What are my deadlines?")).toBe(true);
    expect(myDeadlinesIntent("ما المطلوب مني؟")).toBe(true);
    expect(myDeadlinesIntent("What does my policy say?")).toBe(false);
  });
});

describe("who is my consultant", () => {
  it("notices the question in both languages", () => {
    expect(consultantIntent("Who is my consultant?")).toBe(true);
    expect(consultantIntent("Who are our advisers on this project?")).toBe(true);
    expect(consultantIntent("من هو مستشاري؟")).toBe(true);
    expect(consultantIntent("من المستشار المسؤول عن مشروعنا؟")).toBe(true);
    expect(consultantIntent("What does the policy say about conflicts?")).toBe(false);
  });
});

describe("progress-update draft", () => {
  it("notices a request for a progress-update draft, and nothing else", () => {
    expect(progressDraftIntent("Draft a progress update for our board")).toBe(true);
    expect(progressDraftIntent("Write my status report for this month")).toBe(true);
    expect(progressDraftIntent("اكتب لي مسودة تحديث التقدم لمجلس الإدارة")).toBe(true);
    expect(progressDraftIntent("صغ تقرير الإنجاز لهذا الشهر")).toBe(true);
    expect(progressDraftIntent("اكتب تحديثاً مختصراً عن تقدم العمل على ميثاق مجلس الإدارة")).toBe(true);
    expect(progressDraftIntent("Draft a short progress update for our board on the audit committee work.")).toBe(true);
    expect(progressDraftIntent("اكتب رسالة للمستشار تطلب تمديد الموعد")).toBe(false);
    expect(progressDraftIntent("Draft an e-mail to the firm asking for more time")).toBe(false);
    expect(progressDraftIntent("Draft a board resolution")).toBe(false);
    expect(progressDraftIntent("What is overdue?")).toBe(false);
  });
});

describe("legal questions: the facts, never the ruling", () => {
  it("keeps what the sources say and takes out the sentence that rules", () => {
    const answer = "Your conflict of interest policy requires an annual declaration by each director. The company is compliant with the Companies Law.";
    expect(clientAnswerProblem(answer)).toBe("legal_ruling");
    expect(withoutRulings(answer)).toBe("Your conflict of interest policy requires an annual declaration by each director.");
  });

  it("does the same in Arabic", () => {
    const answer = "تنص سياسة تعارض المصالح على إقرار سنوي من كل عضو. الشركة متوافقة مع النظام.";
    expect(clientAnswerProblem(answer)).toBe("legal_ruling");
    expect(withoutRulings(answer)).toBe("تنص سياسة تعارض المصالح على إقرار سنوي من كل عضو.");
  });

  it("gives nothing back when every sentence rules", () => {
    expect(withoutRulings("The company is compliant with the Companies Law.")).toBeNull();
    expect(withoutRulings("الشركة غير ممتثلة للنظام.")).toBeNull();
  });
});
