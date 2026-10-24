// The client assistant (wave 3, F39; docs/assistant.md, "The client
// assistant"). What a client person may use it for is decided by the
// database (app_client_ai_on); this file holds the notice version and the
// filter every answer to a client passes before it is shown or stored.

/** The client AI notice the client's admin consents to. The database holds the same date (app_client_ai_version). */
export const CLIENT_AI_VERSION = "2026-10-24";

// Action owners are left out: the screens show them only their own actions and
// the files shared with them, narrower than what row-level security lets
// them read, and the index has no per-person filter yet.
export const CLIENT_AI_ROLES = ["client_admin", "client_manager"] as const;
export type ClientAiRole = (typeof CLIENT_AI_ROLES)[number];
export const CLIENT_AI_LIMIT = { min: 1, max: 200, default: 20 } as const;

export type FilterReason = "legal_ruling" | "firm_intent" | "firm_internal" | "other_client";

// Answers that rule on the law or on compliance. A client gets the facts the
// passages state, never a verdict: that is the consultant's and a lawyer's call.
const LEGAL: RegExp[] = [
  /\b(?:you|the company|your (?:company|organi[sz]ation)|it) (?:is|are|was|were|is not|are not|isn't|aren't) (?:fully |legally |now )?(?:compliant|non-compliant|in compliance|in breach|in violation)\b/i,
  /\b(?:complies|comply|complied) with (?:the )?(?:law|regulations?|companies law|pdpl|cma|requirements of)/i,
  /\b(?:violates?|breach(?:es)?|is illegal|is unlawful|legally (?:required|binding|obliged)|you are (?:legally )?obliged)\b/i,
  /\b(?:certif(?:y|ies|ied)|guarantee[sd]?) (?:that )?(?:you|the company|it) (?:is|are|meets?)\b/i,
  /(?:متوافق(?:ة)?|ممتثل(?:ة)?|غير متوافق(?:ة)?|غير ممتثل(?:ة)?) (?:مع|لـ|ل)(?:\s?)(?:النظام|الأنظمة|القانون|اللوائح|نظام)/,
  /(?:يخالف|تخالف|مخالف(?:ة)? (?:لل|ل)(?:نظام|قانون|أنظمة)|غير نظامي(?:ة)?|غير قانوني(?:ة)?|ملزم(?:ة)? (?:قانوناً|قانونا|نظاماً|نظاما))/,
  /(?:نشهد|نؤكد|يؤكد) (?:أن|بأن) (?:الشركة|المنشأة|منشأتكم|شركتكم) (?:ممتثلة|متوافقة|مستوفية)/,
];

// Guesses about what the firm or its consultants intend, think or will do.
// The assistant reports what the records say, never what the firm might want.
const FIRM_INTENT: RegExp[] = [
  /\bthe (?:firm|consultants?|consulting team|lead consultant)(?:'s)? (?:probably|likely|may be planning|is planning|plans|intends?|wants?|secretly|privately|internally) /i,
  /\bthe (?:firm|consultants?) (?:will|would) (?:probably|likely)\b/i,
  /\b(?:i|we) (?:think|believe|suspect) (?:that )?the (?:firm|consultants?)\b/i,
  /(?:المكتب|الشركة الاستشارية|المستشار|المستشارون|فريق الاستشارات) (?:ينوي|تنوي|يخطط|تخطط|يعتزم|تعتزم|يريد|تريد|على الأرجح|ربما)/,
  /(?:على الأرجح|ربما|من المحتمل) (?:أن )?(?:المكتب|المستشار|الشركة الاستشارية) /,
  /(?:أظن|أعتقد|يبدو) أن (?:المكتب|المستشار|الشركة الاستشارية)/,
];

// Words for the firm's own material, which a client's sources never hold.
// Seeing them in an answer means something reached the model that should not have.
const FIRM_INTERNAL: RegExp[] = [
  /\b(?:firm[- ]only|firm[- ]private|internal (?:note|notes|assessment)|assessment score|maturity score|lessons learned register|closing (?:pulse|survey) (?:answers?|results?|scores?)|audit log)\b/i,
  /(?:خاص بالمكتب|ملاحظات داخلية|درجة التقييم|درجات التقييم|نتيجة التقييم الداخلي|سجل التدقيق|نتائج استبيان الإغلاق)/,
];

/** Why an answer to a client must not be shown, or null when it may be. The other-client check is the database's (app_names_other_client). */
export function clientAnswerProblem(text: string): Exclude<FilterReason, "other_client"> | null {
  if (LEGAL.some((r) => r.test(text))) return "legal_ruling";
  if (FIRM_INTENT.some((r) => r.test(text))) return "firm_intent";
  if (FIRM_INTERNAL.some((r) => r.test(text))) return "firm_internal";
  return null;
}

/** What a client sees instead of a filtered answer. Another client's name gets the plain "can't confirm", so a refusal never tells a client who else the firm serves. */
export const CLIENT_REFUSAL: Record<"legal_ruling" | "firm_intent" | "firm_internal", { ar: string; en: string }> = {
  legal_ruling: {
    ar: "لا أستطيع إصدار حكم نظامي أو حكم بالامتثال. أستطيع أن أبيّن ما تقوله المستندات والسجلات المتاحة لك، والحكم لمستشارك أو لمستشارك القانوني.",
    en: "I can't give a legal or compliance ruling. I can show what the documents and records available to you say; the judgement is for your consultant or your legal adviser.",
  },
  firm_intent: {
    ar: "لا أستطيع التكهّن بما ينويه المكتب أو مستشاروه. أستطيع أن أبيّن ما تقوله السجلات المتاحة لك، ولأي سؤال آخر اسأل مستشارك مباشرة.",
    en: "I can't guess what the firm or its consultants intend. I can show what the records available to you say; for anything else, ask your consultant directly.",
  },
  firm_internal: {
    ar: "لا أستطيع الإجابة عن هذا من المصادر المتاحة لك. اسأل مستشارك مباشرة.",
    en: "I can't answer this from the sources available to you. Ask your consultant directly.",
  },
};
