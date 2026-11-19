import { describe, expect, it } from "vitest";
import { clientAnswerProblem, withoutRulings } from "@/lib/client-ai";

// The review of PR #198 (B1): every ordinary way of ruling on the law, in both
// languages and with the marks people type, is caught; what a rule requires is a fact and stays.
const RULINGS = [
  "Your policy is compliant with the CMA regulations.",
  "Your policy is legally sufficient.",
  "The policy meets the regulatory requirements.",
  "The policy satisfies the regulatory requirements.",
  "This is in line with the Companies Law.",
  "The policy is lawful.",
  "The policy is legal under the regulations.",
  "The policy is adequate under the CMA regulations.",
  "It conforms to the Companies Law.",
  "The policy does not meet the legal requirements.",
  "So your policy is compliant with the law.",
  "- The policy is compliant with the law",
  "Your company is not compliant with the Companies Law.",
  "You are in breach of the regulations.",
  "The matrix violates the Companies Law.",
  "Yes, the company complies with the CMA governance regulations.",
  "السياسة كافية نظامًا.",
  "السياسة كافية نظاماً.",
  "السياسة كافٍ نظاماً.",
  "الإقرار ملزمة نظامًا.",
  "الشركة ممتثلةٌ للنظام.",
  "الشركة ممتـثلة للنظام.",
  "الشركة متوافقة مع اللوائح.",
  "السياسة تحقق المتطلبات النظامية.",
  "التشكيل يستوفي المتطلبات النظامية.",
  "السياسة مطابقة للنظام.",
  "السياسة نظامية.",
  "المصفوفة مخالفة للائحة حوكمة الشركات.",
  "هذا مخالف.",
  "القرار غير قانوني.",
  "نعم، أنتم ممتثلون لنظام الشركات.",
  "الشركة ملتزمة بالنظام.",
];
const FACTS = [
  "Article 12 says directors disclose within 15 days.",
  "Under the CMA rules disclosure is legally required within 15 days.",
  "Directors must comply with the Companies Law.",
  "The policy requires each director to disclose any conflict.",
  "The legal team reviews the policy every year.",
  "Any breach of this policy is reported to the board.",
  "تنص المادة 12 على الإفصاح خلال 15 يومًا.",
  "يجب أن تستوفي اللجنة المتطلبات النظامية قبل تشكيلها.",
  "كل من يخالف هذه السياسة يحال إلى لجنة المراجعة.",
  "الإطار النظامي للحوكمة مذكور في الملحق.",
];

describe("legal rulings (review B1)", () => {
  it.each(RULINGS)("catches %s", (s) =>
    expect(clientAnswerProblem(s)).toBe("legal_ruling"),
  );
  it.each(FACTS)("keeps the fact %s", (s) =>
    expect(clientAnswerProblem(s)).toBeNull(),
  );

  it("a mixed answer keeps every fact and loses only the ruling", () => {
    const answer =
      "Article 12 says directors disclose within 15 days. Under the CMA rules disclosure is legally required within 15 days. So your policy is compliant with the law.";
    expect(withoutRulings(answer)).toBe(
      "Article 12 says directors disclose within 15 days. Under the CMA rules disclosure is legally required within 15 days.",
    );
    expect(
      withoutRulings(
        "- Article 12: disclose within 15 days.\n- The policy is compliant with the law",
      ),
    ).toBe("- Article 12: disclose within 15 days.");
    expect(
      withoutRulings(
        "تنص المادة 12 على الإفصاح خلال 15 يومًا. لذلك السياسة كافية نظامًا.",
      ),
    ).toBe("تنص المادة 12 على الإفصاح خلال 15 يومًا.");
  });
});
