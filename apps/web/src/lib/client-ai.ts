// The client assistant (wave 3, F39; docs/assistant.md, "The client
// assistant"). What a client person may use it for is decided by the
// database (app_client_ai_on); this file holds the notice version and the
// filter every answer to a client passes before it is shown or stored.

/** The client AI notice the client's admin consents to. The database holds the same date (app_client_ai_version). */
import { foldArabic } from "./arabic-fold";

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
// Matched against foldArabic(text): the Arabic below is in the folded spelling
// (ة → ه, one alef, no marks or tatweel). What a rule or policy requires
// ("disclosure is legally required within 15 days", «يجب أن تستوفي...») is a
// fact and stays; a statement that the client meets it, or does not, is a ruling.
const LAW = String.raw`(?:the\s+)?(?:applicable\s+|relevant\s+|all\s+)?(?:laws?|legal\s+requirements?|regulations?|regulatory\s+requirements?|requirements\s+of\s+the\s+(?:law|regulations?|cma|companies\s+law)|companies\s+law|pdpl|cma(?:\s+\w+){0,3}|corporate\s+governance\s+regulations|governance\s+regulations|statutory\s+requirements?)`;
const NOT_DUTY = String.raw`(?<!\b(?:must|shall|should|to|will|would|need\s+to|needs\s+to|required\s+to|has\s+to|have\s+to)\s+(?:not\s+)?(?:fully\s+)?)`;
const LEGAL: RegExp[] = [
  // "... is compliant", "is not in compliance", "are in breach", "is unlawful", whatever the subject.
  /\b(?:is|are|was|were|be|remains?|isn't|aren't|wasn't|weren't)\s+(?:not\s+|now\s+|fully\s+|already\s+|still\s+|therefore\s+|thus\s+|also\s+)*(?:legally\s+|regulatorily\s+)?(?:compliant|non-?compliant|in\s+(?:full\s+)?compliance|out\s+of\s+compliance|in\s+breach|in\s+violation|unlawful|illegal|lawful)\b/i,
  // "is legal" as a verdict, not "the legal team".
  /\b(?:is|are)\s+(?:not\s+)?legal(?=\s*(?:[.,;:!?)]|$|\s+under\b|\s+according\b))/i,
  // Sufficiency in law: "legally sufficient", "adequate under the CMA regulations".
  /\blegally\s+(?:sufficient|adequate|enough|valid|acceptable|sound|compliant|binding\s+on\s+(?:you|the\s+company))\b/i,
  new RegExp(String.raw`\b(?:sufficient|adequate|enough|acceptable|valid)\s+(?:under|for|according\s+to|in\s+terms\s+of|as\s+far\s+as)\s+${LAW}`, "i"),
  // "complies with / meets / satisfies / is in line with / conforms to the law", not "must comply with".
  new RegExp(
    String.raw`${NOT_DUTY}\b(?:compl(?:y|ies|ied)|meets?|met|satisf(?:y|ies|ied)|fulfil(?:l?s)?|fulfill(?:s|ed)?|conforms?|conformed|aligns?|accords?|is\s+(?:not\s+)?(?:in\s+line|consistent|aligned|in\s+accordance)|are\s+(?:not\s+)?(?:in\s+line|consistent|aligned|in\s+accordance)|in\s+line)\s+(?:fully\s+)?(?:with\s+|to\s+)?${LAW}`,
    "i",
  ),
  new RegExp(String.raw`\b(?:violates?|violated|contravenes?|contravened|infringes?|breach(?:es|ed)?)\s+${LAW}`, "i"),
  /\b(?:you|the\s+company|your\s+company|we)\s+(?:are|is)\s+(?:legally\s+)?(?:obliged|bound)\b/i,
  /\b(?:certif(?:y|ies|ied)|guarantee[sd]?)\s+(?:that\s+)?(?:you|the\s+company|your\s+\w+|it)\s+(?:is|are|meets?)\b/i,
  // Arabic: compliant, conforming or committed to the law («ممتثلة للنظام», «متوافقة مع اللوائح», «مطابقة للائحة»).
  /(?:متوافق|ممتثل|مطابق|ملتزم|مستوف)(?:ه|ون|ين)?\s+(?:تماما\s+)?(?:مع\s+)?(?:ل|ب)?(?:ال|ل)?(?:نظام|انظمه|قانون|لائحه|لوائح|متطلبات|اشتراطات|ضوابط)/,
  // The subject and a verdict with no law named: «أنتم ممتثلون», «السياسة نظامية», «القرار غير قانوني».
  /(?:انتم|نحن|الشركه|شركتكم|المنشاه|منشاتكم|السياسه|سياستكم|اللائحه|المصفوفه|القرار|الاجراء|التشكيل|هذا|هذه|هي|هو)\s+(?:تعد\s+|يعد\s+)?(?:غير\s+)?(?:ممتثل|متوافق|مطابق|نظامي|قانوني|مخالف)(?:ه|ون|ين)?(?=[\s.,،؛:!؟?)]|$)/,
  /غير\s+(?:نظامي|قانوني|ممتثل|متوافق)/,
  // Sufficient in law: «كافية نظامًا», «كافٍ نظاماً», «كافية من الناحية النظامية».
  /(?:كاف|كافي|كافيه|يكفي|تكفي)\s+(?:من\s+(?:الناحيه|حيث)\s+)?(?:نظاما|قانونا|النظاميه|القانونيه|نظاميا|قانونيا|للنظام|للقانون)/,
  // Meets the requirements: «تحقق / تستوفي المتطلبات النظامية», not «يجب أن تستوفي».
  /(?<!(?:يجب|ينبغي|يلزم|لابد|لا\s+بد)\s+(?:ان|من)\s+)(?:يحقق|تحقق|حقق|حققت|يستوفي|تستوفي|استوفي|استوفت|يلبي|تلبي|لبت|يفي|تفي|وفت)\s+(?:ب)?(?:جميع\s+|كل\s+|كافه\s+)?(?:ال)?(?:متطلبات|اشتراطات|شروط)\s+(?:ال)?(?:نظاميه|قانونيه|نظام|قانون|هيئه|لائحه)/,
  // In breach: «تخالف النظام», «مخالفة للائحة حوكمة الشركات».
  /(?:يخالف|تخالف|خالف|خالفت)\s+(?:ال)?(?:نظام|قانون|لائح|انظم|ضوابط|متطلبات)/,
  /مخالف(?:ه)?\s+(?:ل|لل)?\S*(?:نظام|قانون|لائح|انظم|ضوابط|متطلبات)/,
  /ملزم(?:ه|ون)?\s+(?:نظاما|قانونا|بموجب\s+(?:ال)?(?:نظام|قانون))/,
  /(?:نشهد|نؤكد|يؤكد)\s+(?:ان|بان)\s+(?:الشركه|المنشاه|منشاتكم|شركتكم)\s+(?:ممتثله|متوافقه|مستوفيه)/,
];
const isRuling = (s: string) => {
  const f = foldArabic(s);
  return LEGAL.some((r) => r.test(f));
};

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
  if (isRuling(text)) return "legal_ruling";
  if (FIRM_INTENT.some((r) => r.test(text))) return "firm_intent";
  if (FIRM_INTERNAL.some((r) => r.test(text))) return "firm_internal";
  return null;
}

/**
 * A legal question gets the facts, not a ruling (Gate B, 19 Nov 2026): the
 * answer without the sentences that rule, or null when nothing else is left.
 * Whatever is kept passes clientAnswerProblem() again before it is shown.
 */
export function withoutRulings(text: string): string | null {
  const kept = text
    .split("\n")
    .map((line) =>
      line
        .split(/(?<=[.!?؟؛;])\s+/)
        .filter((s) => !isRuling(s))
        .join(" "),
    )
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return /[\p{L}\p{N}]/u.test(kept) && clientAnswerProblem(kept) === null ? kept : null;
}

/** Said after the facts of a legal question, in place of the ruling taken out. */
export const LEGAL_NOTE = {
  ar: "هذا ما تقوله مصادرك. أمّا هل يكفي ذلك نظامًا، فالحكم لمستشارك أو لمستشارك القانوني.",
  en: "This is what your sources say. Whether it is enough is for your consultant or a legal adviser to judge.",
};

/** The first line of a client's progress-update draft: Selah never sends, stores as a record, or shares it. */
export const DRAFT_MARK = {
  ar: "مسودة: راجعها قبل الإرسال",
  en: "Draft: check before sending",
};

// A draft mark the model wrote in any of its forms, in either language, with Markdown or a dash
// ("**Draft: check before sending**", "Draft — check it before sending."). The AI service reads
// the same forms (DRAFT_MARK in services/ai/app/prompt.py) and writes the canonical one.
const ANY_DRAFT_MARK = /^[\s*_#>`~-]*(?:draft\s*[:\-–—]\s*check (?:it )?before sending|مسودة\s*[:\-–—]\s*راجعها قبل الإرسال)\.?[\s*_`~]*(?:\n|$)/i;

/** The draft with its mark first, once, in the language asked: any mark the model wrote is taken off first. */
export function withDraftMark(text: string, lang: "ar" | "en"): string {
  let body = text.trimStart();
  while (ANY_DRAFT_MARK.test(body)) body = body.replace(ANY_DRAFT_MARK, "").trimStart();
  return `${DRAFT_MARK[lang]}\n\n${body}`;
}

/** The draft without its mark: the note a firm report starts from ("Use as draft", migration 0110). */
export function withoutDraftMark(text: string): string {
  let body = text.trimStart();
  while (ANY_DRAFT_MARK.test(body)) body = body.replace(ANY_DRAFT_MARK, "").trimStart();
  return body.trim();
}

/** Any draft but the progress update, asked by firm staff: refused the same way, before the model is asked. */
export const STAFF_DRAFT_REFUSAL = {
  ar: "لا أكتب الرسائل أو الخطابات أو القرارات أو المحاضر. أستطيع أن أكتب مسودة تحديث عن تقدّم عمل العميل من السجلات، لتستعملها ملاحظةً في تقرير المكتب على صفحة التقرير، أو أن أجيب عن سؤالك من المصادر.",
  en: "I don't write messages, letters, decisions or minutes. I can write a draft progress update from the records, to use as the note of the firm's report on the report page, or answer your question from the sources.",
};

/** Any draft but the progress update: refused before the model is asked (review S3). */
export const DRAFT_REFUSAL = {
  ar: "لا أكتب الرسائل أو الخطابات أو القرارات أو المحاضر. أستطيع أن أكتب لك مسودة تحديث عن تقدّم عملكم من سجلاتك، لتراجعها وترسلها بنفسك، أو أن أجيب عن سؤالك من المصادر المتاحة لك.",
  en: "I don't write messages, letters, decisions or minutes. I can write a draft progress update from your records, for you to check and send yourself, or answer your question from the sources available to you.",
};

/** What a client sees instead of a filtered answer. Another client's name gets the plain "can't confirm", so a refusal never tells a client who else the firm serves. */
export const CLIENT_REFUSAL: Record<"legal_ruling" | "firm_intent" | "firm_internal", { ar: string; en: string }> = {
  legal_ruling: {
    ar: "لا أستطيع إصدار حكم نظامي أو حكم بالامتثال. المصادر المذكورة أدناه هي ما تقوله مستنداتك وسجلاتك في هذا، والحكم لمستشارك أو لمستشارك القانوني.",
    en: "I can't give a legal or compliance ruling. The sources listed below are what your documents and records say on this; the judgement is for your consultant or your legal adviser.",
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
