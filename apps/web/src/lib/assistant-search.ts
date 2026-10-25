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
