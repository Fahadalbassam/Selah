// What the page says while a slow AI call runs as a job (docs/assistant.md,
// "Slow calls as jobs"): waiting in line or next (never how many are ahead),
// working, still working after half a minute, and why it ended, in both
// languages, Arabic first.
import { createTranslator } from "next-intl";
import { describe, expect, it } from "vitest";
import { AI_JOB_ERRORS, AI_JOB_STATUSES, aiJobView, isFinished, pollDelay, type AiJobStatus } from "@/lib/ai-jobs";
import ar from "../messages/ar.json";
import en from "../messages/en.json";

const say = (locale: "ar" | "en", key: string) => createTranslator({ locale, messages: locale === "ar" ? ar : en, namespace: "aiJob" })(key as never);

describe("a job's state on the page", () => {
  it("says it waits its turn, or that it is next, never how many are ahead, and offers Cancel", () => {
    expect(aiJobView({ status: "queued", error: null, next: false }, 0)).toEqual({ key: "queued", tone: "working", cancel: true });
    expect(aiJobView({ status: "queued", error: null, next: null }, 0)).toEqual({ key: "queued", tone: "working", cancel: true });
    expect(aiJobView({ status: "queued", error: null, next: true }, 0)).toEqual({ key: "queuedNext", tone: "working", cancel: true });
    expect(say("ar", "queuedNext")).toBe("طلبك التالي في الدور.");
    expect(say("en", "queuedNext")).toBe("Your request is next.");
    for (const locale of ["ar", "en"] as const) expect(say(locale, "queued")).not.toMatch(/\d/);
  });

  it("says it is working, and after half a minute that local answers take a few minutes, as the assistant's card does", () => {
    expect(aiJobView({ status: "running", error: null, next: null }, 29_999)).toEqual({ key: "running", tone: "working", cancel: true });
    expect(aiJobView({ status: "running", error: null, next: null }, 30_000)).toEqual({ key: "runningSlow", tone: "working", cancel: true });
    expect(say("en", "runningSlow")).toBe(en.assistant.stillWorking);
  });

  it("says why it ended, with nothing to cancel, for every ending", () => {
    expect(aiJobView({ status: "done", error: null, next: null }, 0)).toEqual({ key: "done", tone: "done", cancel: false });
    for (const error of AI_JOB_ERRORS) {
      expect(aiJobView({ status: "refused", error, next: null }, 0)).toEqual({ key: `errors.${error}`, tone: "error", cancel: false });
    }
    // An ending with no reason recorded still has words.
    expect(aiJobView({ status: "expired", error: null, next: null }, 0).key).toBe("errors.expired");
    expect(aiJobView({ status: "cancelled", error: null, next: null }, 0).key).toBe("errors.cancelled");
    expect(aiJobView({ status: "failed", error: null, next: null }, 0).key).toBe("errors.unavailable");
  });

  it("has every sentence it can show in Arabic and English", () => {
    const keys = new Set<string>(["cancel"]);
    for (const status of AI_JOB_STATUSES) {
      for (const error of [null, ...AI_JOB_ERRORS]) {
        for (const waited of [0, 60_000]) {
          for (const next of [null, false, true]) keys.add(aiJobView({ status, error, next }, waited).key);
        }
      }
    }
    for (const key of keys) {
      for (const locale of ["ar", "en"] as const) {
        const text = say(locale, key);
        expect(text, `${locale} ${key}`).not.toMatch(/aiJob\./);
        expect(text.length, `${locale} ${key}`).toBeGreaterThan(1);
      }
      // Arabic first: the Arabic sentence is Arabic.
      expect(say("ar", key), key).toMatch(/[؀-ۿ]/);
    }
    // "Busy" (as many jobs at once as one may have) and the hourly limit are told apart on each page that files jobs.
    for (const m of [ar, en]) {
      expect(m.translation.busy).not.toBe(m.translation.limited);
      expect(m.fileSummary.errors.busy).not.toBe(m.fileSummary.errors.limit);
      expect(m.orgChartImport.errors.busy).not.toBe(m.orgChartImport.errors.rate);
    }
    expect(ar.translation.busy).toMatch(/[؀-ۿ]/);
  });

  it("asks soon at first, then every five seconds; and stops once the job has ended", () => {
    expect([0, 1, 2, 3, 9, 10, 100].map(pollDelay)).toEqual([1500, 1500, 1500, 3000, 3000, 5000, 5000]);
    const finished = AI_JOB_STATUSES.filter((s: AiJobStatus) => isFinished(s));
    expect(finished).toEqual(["done", "failed", "refused", "cancelled", "expired"]);
  });
});
