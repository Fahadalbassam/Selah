// Slow AI calls as jobs (docs/assistant.md, "Slow calls as jobs"): the
// shapes the page and the server share, and what the page says while it
// waits. A file summary, a translation or an org chart draft from pasted
// text is asked for, answered at once with a job (HTTP 202), done by the jobs
// runner one at a time, and the page asks after it every few seconds.

export const AI_JOB_KINDS = ["summary", "translation", "org_draft"] as const;
export type AiJobKind = (typeof AI_JOB_KINDS)[number];

export const AI_JOB_STATUSES = ["queued", "running", "done", "failed", "refused", "cancelled", "expired"] as const;
export type AiJobStatus = (typeof AI_JOB_STATUSES)[number];

/**
 * Why a job did not end "done", in words the page has a sentence for:
 * access (the person may no longer see or change it), changed (the text or
 * file changed while the model read it), local_only (an org chart draft
 * needs the local model), limit (an hourly limit), too_long, no_text,
 * unavailable (the model failed), stopped (the runner stopped mid-job),
 * expired (it waited 30 minutes), cancelled.
 */
export const AI_JOB_ERRORS = ["access", "changed", "local_only", "limit", "too_long", "no_text", "unavailable", "stopped", "expired", "cancelled"] as const;
export type AiJobError = (typeof AI_JOB_ERRORS)[number];

/** A job as the page sees it (GET /api/ai-jobs/[id]). */
export interface AiJob {
  id: string;
  kind: AiJobKind;
  status: AiJobStatus;
  error: AiJobError | null;
  /** While queued: how many jobs, anyone's, are ahead of it. */
  ahead: number | null;
}

export const isFinished = (s: AiJobStatus) => s !== "queued" && s !== "running";

/** How long the page waits between asks: soon at first (a short job, a kept answer), then every five seconds. */
export function pollDelay(asked: number): number {
  return asked < 3 ? 1500 : asked < 10 ? 3000 : 5000;
}

/**
 * What the page says about a job (keys under "aiJob" in messages): waiting
 * in line, with how many are ahead; being worked on, and after half a minute
 * that local answers take a few minutes (the same moment the assistant's
 * card says it, #208); or why it ended. Only an unfinished job can be
 * cancelled.
 */
export function aiJobView(job: Pick<AiJob, "status" | "error" | "ahead">, waitedMs: number): {
  key: string;
  values?: Record<string, number>;
  tone: "working" | "done" | "error";
  cancel: boolean;
} {
  switch (job.status) {
    case "queued":
      return job.ahead && job.ahead > 0
        ? { key: "queuedBehind", values: { n: job.ahead }, tone: "working", cancel: true }
        : { key: "queued", tone: "working", cancel: true };
    case "running":
      return { key: waitedMs >= 30_000 ? "runningSlow" : "running", tone: "working", cancel: true };
    case "done":
      return { key: "done", tone: "done", cancel: false };
    default:
      return { key: `errors.${job.error ?? (job.status === "expired" ? "expired" : job.status === "cancelled" ? "cancelled" : "unavailable")}`, tone: "error", cancel: false };
  }
}
