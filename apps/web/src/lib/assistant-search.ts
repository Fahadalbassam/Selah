import { foldArabic } from "./arabic-fold";

// Pure helpers for the assistant's hybrid search (docs/assistant.md): the
// keyword query, the merge of the two ranked lists, and a chat's title.

// Words too common to rank by, in both languages. The index uses the
// 'simple' configuration, which keeps every word as written.
const STOP = new Set([
  "the", "and", "for", "are", "was", "were", "what", "which", "who", "whom", "how", "why", "when", "where", "does", "did",
  "has", "have", "had", "this", "that", "these", "those", "with", "from", "into", "about", "any", "all", "can", "could",
  "should", "would", "will", "our", "their", "there", "its", "not", "but", "you", "your", "they", "them", "still", "is",
  "في", "من", "على", "إلى", "الى", "عن", "مع", "هل", "ما", "ماذا", "متى", "أين", "كيف", "لماذا", "هذا", "هذه",
  "ذلك", "تلك", "التي", "الذي", "الذين", "هو", "هي", "هم", "كان", "كانت", "أو", "او", "ثم", "قد", "لم", "لا", "كل",
  "بعد", "قبل", "حتى", "عند", "أن", "ان", "إن",
]);

/**
 * An OR query over the question's distinctive words, for to_tsquery('simple').
 * Only letters and digits survive, so nothing the person types can change the
 * query's syntax. Null when no word is left.
 */
export function keywordQuery(question: string, max = 12): string | null {
  const words = question
    .toLowerCase()
    // Arabic short vowels and other marks would split a word in two.
    .replace(/\p{M}/gu, "")
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length >= 2 && !STOP.has(w) && !/^\p{N}$/u.test(w));
  const unique = [...new Set(words)].slice(0, max);
  return unique.length ? unique.join(" | ") : null;
}

/**
 * Reciprocal rank fusion: each list adds 1 / (k + rank) to an item's score,
 * so an item high in either list rises, and one high in both rises most.
 * Items `boost` picks (the chat's case) come before all others, in the same
 * order among themselves. Ties keep the order of the first list.
 */
export function fuse<T extends { id: string }>(lists: T[][], limit: number, boost?: (item: T) => boolean, k = 60): T[] {
  const score = new Map<string, number>();
  const item = new Map<string, T>();
  const order: string[] = [];
  for (const list of lists) {
    list.forEach((x, rank) => {
      if (!item.has(x.id)) {
        item.set(x.id, x);
        order.push(x.id);
      }
      score.set(x.id, (score.get(x.id) ?? 0) + 1 / (k + rank + 1));
    });
  }
  const final = (id: string) => (score.get(id) ?? 0) + (boost?.(item.get(id)!) ? 1 : 0);
  return order
    .map((id, i) => ({ id, i, s: final(id) }))
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .slice(0, limit)
    .map((x) => item.get(x.id)!);
}

/** A new chat's title: its first question on one line, cut at 60 characters. */
export function chatTitle(question: string): string {
  const line = question.replace(/\s+/g, " ").trim();
  return line.length <= 60 ? line : `${line.slice(0, 59).trimEnd()}…`;
}

export type StatusKind = "overdue" | "blocked" | "review" | "revision" | "due_soon" | "open";

// Status words in both languages. Arabic patterns allow a prefix (ال، و، ب) and a feminine ending.
const STATUS: [StatusKind, RegExp][] = [
  ["overdue", /\b(overdue|late|past due|behind schedule|missed (the )?deadline)\b|متأخر|تأخر|فات موعد|تجاوز\S* (ال)?موعد/iu],
  ["blocked", /\b(blocked|stuck|on hold)\b|متعثر|معلق|متوقف|عالق/iu],
  ["review", /\b(awaiting|pending|waiting for|needs?|ready for) (my |our |a )?review\b|بانتظار (ال)?مراجع|تنتظر (ال)?مراجع|قيد (ال)?مراجع/iu],
  ["revision", /\b(revision|sent back|rework)\b|طلب (ال)?تعديل|أعيد\S* للتعديل|إعادة (ال)?عمل/iu],
  ["due_soon", /\bdue (this|next) week\b|\bdue soon\b|\bupcoming (deadline|due)|مستحق\S* (هذا|خلال|في) (ال)?أسبوع|(هذا|الأسبوع) (ال)?(أسبوع|القادم)|المواعيد القادمة/iu],
  ["open", /\b(still open|outstanding|not (yet )?(done|finished|complete)|what'?s left|remaining (work|actions))\b|لم (ت|ي)نج?ز|المفتوحة|المتبقية|غير المكتمل/iu],
];

/**
 * Whether a question asks about the state of the work rather than what a file
 * says ("what is overdue?", "ما الإجراءات المتعثرة؟"). Search can't see status,
 * so these are answered from the project's records (docs/assistant.md).
 */
export function statusIntent(question: string): Set<StatusKind> {
  const q = question.replace(/\p{M}/gu, "");
  return new Set(STATUS.filter(([, re]) => re.test(q)).map(([k]) => k));
}

// "My" work, in both languages: "my deadlines", "what do I own", «ما المطلوب مني؟», «ما الذي عليّ؟».
// Not "my company", "my team", "my manager's", "my CFO", "my direct reports" or "Ahmed's
// deadlines, not my own": those are about someone else (review S7). The Arabic is in the
// folded spelling (foldArabic). «علي» without its shadda is a name (Ali), so only «عليّ»
// and «علي أن» count.
const NOT_ME = String.raw`company|organi[sz]ation|business|team|department|unit|project|projects|firm|consultants?|board|colleagues?|staff|employees|manager|managers|boss|supervisor|cfo|ceo|coo|cto|chair(?:man|person)?|secretary|deputy|assistant|direct\s+reports?|reports|subordinates?|people|family|father|brother|partner`;
const MINE_EN = new RegExp(
  String.raw`\b(?:my|mine)\b(?!\s+(?:${NOT_ME})\b)(?!\s+[\w-]+'s\b)|\b(?:assigned to me|i own|i am responsible|i'm responsible|on my plate|do i (?:have|own|need))\b`,
  "i",
);
const MINE_AR = /المطلوب مني|مطلوب مني|علي ان|مهامي|مهماتي|اجراءاتي|مواعيدي|اعمالي|المسنده (?:الي|لي)|المكلف(?:ه)? بها|مسووليتي|مسؤوليتي/;
// Someone else's work named outright: "Ahmed's deadlines", "not my own".
const OTHERS = /\b(?!my\b)[a-z][\w-]*'s\s+(?:deadlines?|actions?|tasks?|work|due|items?)\b|\bnot (?:mine|my own)\b/i;
// Deadline words that make a "my ..." question a status question even without a status word ("my deadlines").
const DEADLINE = /\b(?:deadlines?|due dates?|tasks?|actions?|to-?dos?|due)\b|مواعيد|موعد|مهام|مهمه|اجراءات|المطلوب|مطلوب|مستحق/i;

/**
 * Whether a status question asks about the person's own work ("what are my
 * deadlines?", «ما المطلوب مني؟»). It only ever narrows: statusRecords then
 * keeps the actions the person owns or is named on (docs/assistant.md).
 */
export function mineIntent(question: string): boolean {
  if (OTHERS.test(question)) return false;
  // «عليّ» is read with its shadda, before folding takes it away.
  const shadda = /عل[يى]ّ/.test(question.replace(/[ً-ِْٰـ]/g, ""));
  return shadda || MINE_EN.test(question) || MINE_AR.test(foldArabic(question));
}

/** "My deadlines" with no status word: read as every open action of the person's. */
export function myDeadlinesIntent(question: string): boolean {
  return mineIntent(question) && DEADLINE.test(foldArabic(question));
}

// Who the person's consultants are, asked as such: "who is my consultant?", "who do I
// contact at the firm?", «من مستشاري؟», «من المستشار المسؤول عن مشروعنا؟». Not every
// question that names a consultant ("what does the consultant accept?"): those keep
// their file passages (review S6; folded spelling).
const CONSULTANT =
  /\bwho\b[^?]{0,50}\b(?:consultants?|advis[eo]rs?|contact|point of contact|account manager|lead|team at the firm|firm)\b|\b(?:name|names) of (?:my|our|the) consultants?\b|\b(?:my|our) (?:consultants?|advis[eo]rs?|point of contact|account manager)\s*\??$|^\s*و?(?:من|مين)\s+(?:هو\s+|هي\s+|هم\s+)?\S*مستشار|مستشاري(?=[\s؟?.،]|$)|مستشارنا|مستشارينا|(?:من|مين)\s+يتابع(?:نا|ني)?|(?:من|مين)\s+(?:هو\s+)?(?:ال)?مسوول\s+عن(?:نا|ي)?\s+في\s+(?:ال)?مكتب/i;

/** Whether a question asks who the person's consultants are ("who is my consultant?", «من مستشاري؟»). */
export function consultantIntent(question: string): boolean {
  return CONSULTANT.test(foldArabic(question).replace(/ؤ/g, "و"));
}

// A progress-update draft the person asks for (the one draft a client person may get: CLIENT_RULES).
const PROGRESS_DRAFT =
  /\b(?:draft|write|prepare|compose)\b.{0,40}\b(?:progress|status) (?:update|report|summary)\b|\b(?:progress|status) (?:update|report)\b.{0,30}\bdraft\b|(?:مسوده|صياغه|صغ|اكتب|اعد|جهز)(?:\s+\S+){0,4}\s+(?:تحديث|تقرير|ملخص)\S*(?:\s+\S+){0,3}\s+(?:ال)?(?:تقدم|انجاز|حاله|سير العمل)/i;
// Any other draft: a message, e-mail, letter, memo, minutes, a decision or a policy, or
// anything written to someone ("to the consultant", «إلى المستشار») or asking for something
// ("asking for two more weeks", «تطلب التمديد»). Refused in code (review S3; folded spelling).
const OTHER_DOC =
  /\b(?:draft|write|compose|prepare|formulate|word)\b(?:\s+\S+){0,6}?\s+(?:an?\s+|the\s+|my\s+|our\s+|me\s+an?\s+)?(?:e-?mails?|letters?|messages?|memos?|repl(?:y|ies)|responses?|minutes|resolutions?|decisions?|polic(?:y|ies)|announcements?|invitations?|notes?|whatsapp|texts?)\b|\bdraft\s+(?:a|an|the|me|us|for|something)\b(?!(?:\s+(?:a|an|my|our|the))?(?:\s+(?:short|brief|quick|monthly|weekly|quarterly))?\s+(?:progress|status)\b)|(?:مسوده|صياغه|صغ|اكتب|اعد|جهز|حرر)(?:\s+\S+){0,4}?\s+(?:ال)?(?:رساله|خطاب|بريد|ايميل|مذكره|محضر|قرار|رد|دعوه|تعميم|سياسه)|(?:اكتب|صغ|جهز|اعد|حرر)\s+(?:لي\s+|لنا\s+)?(?:ال)?مسوده(?!(?:\s+\S+){0,2}\s+(?:ال)?(?:تحديث|تقرير|ملخص))/i;
const TO_SOMEONE =
  /\bto (?:the |our |my )?(?:consultants?|firm|advis[eo]rs?|cma|regulator|authority|ministry|auditors?|lawyers?|bank|shareholders?|investors?|[A-Z][a-z]+)\b|\b(?:asking|requesting|to ask|to request|demanding|complaining|to complain)\b|(?:الي|ل)\s*(?:ال)?(?:مستشار|مكتب|هيئه|وزاره|مراجع|محامي|بنك|مساهمين)|تطلب|يطلب|نطلب|اطلب/;

/** Whether a client person asks for a draft of their own progress update, and nothing else. */
export function progressDraftIntent(question: string): boolean {
  const q = foldArabic(question);
  return PROGRESS_DRAFT.test(q) && !OTHER_DOC.test(q) && !TO_SOMEONE.test(q);
}

/** Whether a client person asks for any other draft (an e-mail, a letter, a decision): refused without asking the model. */
export function otherDraftIntent(question: string): boolean {
  if (progressDraftIntent(question)) return false;
  const q = foldArabic(question);
  return OTHER_DOC.test(q) || (PROGRESS_DRAFT.test(q) && TO_SOMEONE.test(q));
}

// Indicator words in both languages: the client's own business measures (KPI layer B).
const INDICATOR = /\b(kpis?|indicators?|metrics?|measures?|targets?|baselines?)\b|مؤشر|المؤشرات|مستهدف|المستهدفات|خط (ال)?أساس/iu;

/**
 * Whether a question asks about the client's business indicators ("how are
 * sales doing against target?", "ما آخر قيمة لمؤشر الشكاوى؟"). Those live in
 * their own records, so they are read from there (docs/assistant.md).
 */
export function indicatorIntent(question: string): boolean {
  return INDICATOR.test(question.replace(/\p{M}/gu, ""));
}
