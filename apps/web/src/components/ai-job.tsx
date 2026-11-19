"use client";

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { BrandLoader } from "@/components/brand";
import { aiJobView, isFinished, pollDelay, type AiJob } from "@/lib/ai-jobs";
import { cn } from "@/lib/utils";

// Slow AI calls as jobs (docs/assistant.md, "Slow calls as jobs"): a page
// that asked for a summary, a translation or an org chart draft gets a job
// back (HTTP 202) and follows it here until it ends, saying meanwhile what
// is happening (lib/ai-jobs.ts aiJobView) with a way to cancel it.

const pause = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(signal.reason);
    });
  });

/**
 * Follow one job at a time: `follow(job)` resolves with the job as it ended
 * (with its rows, for an org chart draft), or rejects if the page moved on
 * (another follow, or the component went away). A lost connection is asked
 * again; a 404 means the person can no longer see it.
 */
export function useAiJob<T extends AiJob = AiJob>() {
  const [job, setJob] = useState<T | null>(null);
  const [waitedMs, setWaitedMs] = useState(0);
  const stopRef = useRef<AbortController | null>(null);
  useEffect(() => () => stopRef.current?.abort(), []);

  const follow = useCallback(async (first: T): Promise<T> => {
    stopRef.current?.abort();
    const stop = new AbortController();
    stopRef.current = stop;
    const since = Date.now();
    let current = first;
    setJob(first);
    setWaitedMs(0);
    for (let asked = 0; !isFinished(current.status); asked++) {
      await pause(pollDelay(asked), stop.signal);
      const res = await fetch(`/api/ai-jobs/${first.id}`, { signal: stop.signal }).catch(() => null);
      if (stop.signal.aborted) throw stop.signal.reason;
      if (res?.ok) current = (await res.json()) as T;
      else if (res?.status === 404) current = { ...current, status: "refused", error: "access" };
      setJob(current);
      setWaitedMs(Date.now() - since);
    }
    return current;
  }, []);

  const cancel = useCallback(async () => {
    if (!job || isFinished(job.status)) return;
    await fetch(`/api/ai-jobs/${job.id}`, { method: "DELETE" }).catch(() => null);
  }, [job]);

  const clear = useCallback(() => {
    stopRef.current?.abort();
    setJob(null);
  }, []);

  return { job, waitedMs, follow, cancel, clear };
}

/** What is happening to a job, in words, with Cancel while it waits or runs. */
export function AiJobState({ job, waitedMs, onCancel, className }: { job: AiJob; waitedMs: number; onCancel?: () => void; className?: string }) {
  const t = useTranslations("aiJob");
  const v = aiJobView(job, waitedMs);
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn("flex flex-wrap items-center gap-x-2 gap-y-1 text-sm", v.tone === "error" ? "text-destructive" : "text-muted-foreground", className)}
    >
      {v.tone === "working" ? <BrandLoader tone="current" className="size-4" /> : null}
      <span>{t(v.key, v.values)}</span>
      {v.cancel && onCancel ? (
        <button type="button" className="text-xs underline-offset-4 hover:text-foreground hover:underline" onClick={onCancel}>
          {t("cancel")}
        </button>
      ) : null}
    </div>
  );
}
