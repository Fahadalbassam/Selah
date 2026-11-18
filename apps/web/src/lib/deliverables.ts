import { z } from "zod";
import { FIRM_TIME_ZONE } from "./dates";
import { RECEIVED_VIA } from "./engagement";

// A deliverable handed over and the client's receipt (F21, minimal; migration
// 0092_deliverable_receipts). Shared by the screens, the services and the
// tests; the database holds the same limits. "Received" is receipt only: it
// never says the work was accepted as good.

/**
 * The one word a deliverable shows, from its latest round. No percentage.
 * "no_answer": a round still waiting when its project closed; nothing is
 * written on a closed project, so it stays unanswered and says so.
 */
export const RECEIPT_STATUSES = ["not_handed_over", "waiting", "received", "commented", "no_answer"] as const;
export type ReceiptStatus = (typeof RECEIPT_STATUSES)[number];

/** Working days (Sunday to Thursday) a hand-over waits before its one reminder (app_deliverable_reminder_days()). */
export const DELIVERABLE_REMINDER_WORKING_DAYS = 10;

/** Text and size limits the database enforces (deliverable_handovers checks, app_* functions). */
export const DELIVERABLE_LIMITS = { versions: 20, comment: { min: 3, max: 2000 }, name: { min: 2, max: 200 } } as const;

interface RoundState {
  receivedAt: Date | string | null;
  commentedAt: Date | string | null;
}

/** The status of a deliverable from its rounds, newest first; `closed` when its project is closed. */
export function receiptStatus(rounds: readonly RoundState[], closed = false): ReceiptStatus {
  const latest = rounds[0];
  if (!latest) return "not_handed_over";
  return latestStatus(latest.receivedAt ? "received" : latest.commentedAt ? "commented" : "waiting", closed);
}

/**
 * The status from the latest round's state, which every reader gets from the
 * database, also when they cannot open that round's files (review S3).
 */
export function latestStatus(state: "waiting" | "received" | "commented" | null, closed = false): ReceiptStatus {
  if (!state) return "not_handed_over";
  if (state === "waiting") return closed ? "no_answer" : "waiting";
  return state;
}

/** What a round says, for the texts below. */
export interface RoundFacts {
  round: number;
  deliveredAt: Date | string;
  deliveredBy: string | null;
  files: { title: string; version: number }[];
  hiddenFiles: number;
  receivedAt: Date | string | null;
  receivedBy: string | null;
  receiptSource: string | null;
  receivedByName: string | null;
  receivedVia: string | null;
  receivedOn: string | null;
  comment: string | null;
  commentedAt: Date | string | null;
  commentedBy: string | null;
}

type Translate = (key: string, values?: Record<string, string | number>) => string;

/**
 * A round's status: its answer; or, while it is the latest, waiting (no
 * answer when its project closed first); or replaced by a later round.
 */
export function roundStatus(r: RoundFacts, latest: boolean, closed = false): ReceiptStatus | "replaced" {
  if (r.receivedAt) return "received";
  if (r.commentedAt) return "commented";
  if (!latest) return "replaced";
  return closed ? "no_answer" : "waiting";
}

/**
 * One line saying what happened to a round, for the closure report, the
 * export pack and the screens. `t` reads messages "deliverables.text";
 * `day` formats a date; `closed` when the round's project is closed. Receipt
 * is never acceptance, and the words say so.
 */
export function receiptText(r: RoundFacts | undefined, t: Translate, day: (d: Date | string) => string, closed = false): string {
  if (!r) return t("notHandedOver");
  if (r.receivedAt && r.receiptSource === "consultant_recorded") {
    return t("recorded", { date: day(r.receivedOn ?? r.receivedAt), person: r.receivedByName ?? "", via: t(`via.${r.receivedVia}`), name: r.receivedBy ?? "—" });
  }
  if (r.receivedAt) return t("received", { date: day(r.receivedAt), name: r.receivedBy ?? "—" });
  if (r.commentedAt) return t("commented", { date: day(r.commentedAt), name: r.commentedBy ?? "—", comment: r.comment ?? "" });
  return t(closed ? "noAnswer" : "waiting", { date: day(r.deliveredAt), name: r.deliveredBy ?? "—" });
}

/** A date for the texts above: a day ("2026-11-18") as it is, a moment in the firm's time zone. */
export function dayText(locale: string): (d: Date | string) => string {
  const moment = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: FIRM_TIME_ZONE });
  const plain = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" });
  return (d) => (typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d) ? plain.format(new Date(`${d}T00:00:00Z`)) : moment.format(new Date(d)));
}

/** The files of a round: "Board charter.docx (v2)", and how many the reader cannot open, never their names. */
export function filesText(r: Pick<RoundFacts, "files" | "hiddenFiles"> | undefined, t: Translate): string {
  if (!r) return "—";
  return [...r.files.map((f) => t("file", { title: f.title, version: f.version })), ...(r.hiddenFiles ? [t("hiddenFiles", { n: r.hiddenFiles })] : [])].join(" · ");
}

export const handOverInput = z.object({ versionIds: z.array(z.uuid()).min(1).max(DELIVERABLE_LIMITS.versions) }).strict();

/**
 * The receipt, for the round the reader saw: the client confirms with the
 * round alone; for a client the firm runs, the consultant also says who at the
 * client received it, how and on which day.
 */
export const receiptInput = z
  .object({
    round: z.coerce.number().int().min(1),
    receivedBy: z.string().trim().min(DELIVERABLE_LIMITS.name.min).max(DELIVERABLE_LIMITS.name.max).optional(),
    receivedVia: z.enum(RECEIVED_VIA).optional(),
    receivedOn: z.iso.date().optional(),
  })
  .strict();
export type ReceiptInput = z.infer<typeof receiptInput>;

export const commentInput = z
  .object({
    round: z.coerce.number().int().min(1),
    comment: z.string().trim().min(DELIVERABLE_LIMITS.comment.min).max(DELIVERABLE_LIMITS.comment.max),
  })
  .strict();
export type CommentInput = z.infer<typeof commentInput>;
