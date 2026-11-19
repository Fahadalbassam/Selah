// What the page says while a slow AI call runs as a job (docs/assistant.md,
// "Slow calls as jobs"): waiting in line, working, still working after half
// a minute, and why it ended, in both languages, Arabic first; and how the
// runner names a refusal.
import { createTranslator } from "next-intl";
import { describe, expect, it } from "vitest";
import { AI_JOB_ERRORS, AI_JOB_STATUSES, aiJobView, isFinished, pollDelay, type AiJobStatus } from "@/lib/ai-jobs";
import ar from "../messages/ar.json";
import en from "../messages/en.json";

const say = (locale: "ar" | "en", key: string, values?: Record<string, number>) =>
  createTranslator({ locale, messages: locale === "ar" ? ar : en, namespace: "aiJob" })(key as never, values as never);

describe("a job's state on the page", () => {
  it("says it waits its turn, with how many are ahead, and offers Cancel", () => {
    expect(aiJobView({ status: "queued", error: null, ahead: 0 }, 0)).toEqual({ key: "queued", tone: "working", cancel: true });
    expect(aiJobView({ status: "queued", error: null, ahead: null }, 0)).toEqual({ key: "queued", tone: "working", cancel: true });
    expect(aiJobView({ status: "queued", error: null, ahead: 2 }, 0)).toEqual({ key: "queuedBehind", values: { n: 2 }, tone: "working", cancel: true });
    expect(say("ar", "queuedBehind", { n: 1 })).toBe("طلبك في الانتظار. قبله طلب واحد.");
    expect(say("ar", "queuedBehind", { n: 2 })).toBe("طلبك في الانتظار. قبله طلبان.");
    expect(say("ar", "queuedBehind", { n: 3 })).toBe("طلبك في الانتظار. قبله 3 طلبات.");
    expect(say("ar", "queuedBehind", { n: 11 })).toBe("طلبك في الانتظار. قبله 11 طلبًا.");
    expect(say("en", "queuedBehind", { n: 1 })).toBe("Your request is waiting: one request is ahead of it.");
    expect(say("en", "queuedBehind", { n: 4 })).toBe("Your request is waiting: 4 requests are ahead of it.");
  });

  it("says it is working, and after half a minute that local answers take a few minutes, as the assistant's card does", () => {
    expect(aiJobView({ status: "running", error: null, ahead: null }, 29_999)).toEqual({ key: "running", tone: "working", cancel: true });
    expect(aiJobView({ status: "running", error: null, ahead: null }, 30_000)).toEqual({ key: "runningSlow", tone: "working", cancel: true });
    expect(say("en", "runningSlow")).toBe(en.assistant.stillWorking);
  });

  it("says why it ended, with nothing to cancel, for every ending", () => {
    expect(aiJobView({ status: "done", error: null, ahead: null }, 0)).toEqual({ key: "done", tone: "done", cancel: false });
    for (const error of AI_JOB_ERRORS) {
      expect(aiJobView({ status: "refused", error, ahead: null }, 0)).toEqual({ key: `errors.${error}`, tone: "error", cancel: false });
    }
    // An ending with no reason recorded still has words.
    expect(aiJobView({ status: "expired", error: null, ahead: null }, 0).key).toBe("errors.expired");
    expect(aiJobView({ status: "cancelled", error: null, ahead: null }, 0).key).toBe("errors.cancelled");
    expect(aiJobView({ status: "failed", error: null, ahead: null }, 0).key).toBe("errors.unavailable");
  });

  it("has every sentence it can show in Arabic and English", () => {
    const keys = new Set<string>(["cancel"]);
    for (const status of AI_JOB_STATUSES) {
      for (const error of [null, ...AI_JOB_ERRORS]) {
        for (const waited of [0, 60_000]) {
          for (const ahead of [null, 0, 3]) keys.add(aiJobView({ status, error, ahead }, waited).key);
        }
      }
    }
    for (const key of keys) {
      for (const locale of ["ar", "en"] as const) {
        const text = say(locale, key, { n: 3 });
        expect(text, `${locale} ${key}`).not.toMatch(/aiJob\./);
        expect(text.length, `${locale} ${key}`).toBeGreaterThan(1);
      }
      // Arabic first: the Arabic sentence is Arabic.
      if (key !== "done") expect(say("ar", key, { n: 3 }), key).toMatch(/[؀-ۿ]/);
    }
    // The "busy" refusal on each page that files jobs.
    expect(ar.translation.busy).toMatch(/[؀-ۿ]/);
    expect(ar.fileSummary.errors.busy).toMatch(/[؀-ۿ]/);
    expect(ar.orgChartImport.errors.busy).toMatch(/[؀-ۿ]/);
    expect(en.translation.busy && en.fileSummary.errors.busy && en.orgChartImport.errors.busy).toBeTruthy();
  });

  it("asks soon at first, then every five seconds; and stops once the job has ended", () => {
    expect([0, 1, 2, 3, 9, 10, 100].map(pollDelay)).toEqual([1500, 1500, 1500, 3000, 3000, 5000, 5000]);
    const finished = AI_JOB_STATUSES.filter((s: AiJobStatus) => isFinished(s));
    expect(finished).toEqual(["done", "failed", "refused", "cancelled", "expired"]);
  });
});
