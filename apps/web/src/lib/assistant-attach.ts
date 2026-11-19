// "@" in the assistant's box: attach a Selah file the asker can already see
// (lead-log, "Progress report change"; docs/assistant.md, "Attaching a file").
// Pure helpers shared by the picker, its chips and the server, so the screen
// and the search say the same thing about a file.
import { personMatches } from "@/lib/person-match";

/** Files one question may carry. */
export const MAX_ATTACHMENTS = 3;
/** Files the picker lists for one search. */
export const PICKER_RESULTS = 8;

/**
 * Whether an attached file's passages can go to the assistant, and if not, why.
 *   ok             - open to the assistant and indexed: its passages go first
 *   not_available  - the assistant switch is off, or the file is archived (or none of its passages is yours to read)
 *   not_indexed    - switched on, waiting for the indexing job
 *   scanned        - only scanned pages, no text layer yet (text recognition comes later)
 *   unreadable     - indexing could not read its text (damaged, encrypted)
 *   draft          - a progress draft is built from the actions only, never from a file
 *   gone           - not a file this person can see in the chat's projects: answered the same as one that doesn't exist
 */
export type AttachStatus = "ok" | "not_available" | "not_indexed" | "scanned" | "unreadable" | "draft" | "gone";

export const ATTACH_PROBLEMS = ["not_available", "not_indexed", "scanned", "unreadable", "draft", "gone"] as const satisfies readonly AttachStatus[];

/** A file's own state, as the indexing job left it (docs/assistant.md, "The search index"). */
export function attachStatus(file: { aiIndexable: boolean; textStatus: string; archived?: boolean }): AttachStatus {
  if (!file.aiIndexable || file.archived) return "not_available";
  switch (file.textStatus) {
    case "searchable":
      return "ok";
    case "pending":
      return "not_indexed";
    case "needs_ocr":
      return "scanned";
    default:
      return "unreadable";
  }
}

/** The files whose title has the typed words, in either language (the person picker's folding). */
export function matchFiles<T extends { title: string }>(files: readonly T[], query: string, limit = PICKER_RESULTS): T[] {
  return files.filter((f) => personMatches([f.title], query)).slice(0, limit);
}

/**
 * The "@" being typed just before the caret: at the start or after a space,
 * up to the caret, on one line. "name@company.com" is not one. Null when the
 * caret is not in one.
 */
export function mentionAt(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const at = before.lastIndexOf("@");
  if (at < 0) return null;
  if (at > 0 && !/\s/.test(before[at - 1]!)) return null;
  const query = before.slice(at + 1);
  if (query.includes("\n") || query.length > 80 || /^\s/.test(query)) return null;
  return { start: at, query };
}

/** The text with the "@…" typed for the picker taken out, and where the caret goes. */
export function withoutMention(text: string, mention: { start: number; query: string }): { text: string; caret: number } {
  const end = mention.start + 1 + mention.query.length;
  const rest = text.slice(end);
  const head = text.slice(0, mention.start);
  // One space between what was before and after, not two.
  const joined = head.endsWith(" ") && rest.startsWith(" ") ? head + rest.slice(1) : head + rest;
  return { text: joined, caret: head.length };
}

/** One more file on the question: never twice, never more than MAX_ATTACHMENTS. */
export function addAttachment<T extends { id: string }>(list: readonly T[], file: T): T[] {
  if (list.some((f) => f.id === file.id) || list.length >= MAX_ATTACHMENTS) return [...list];
  return [...list, file];
}
