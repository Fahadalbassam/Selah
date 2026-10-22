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
