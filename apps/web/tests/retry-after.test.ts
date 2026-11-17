// "Too many tries" says how long to wait. The server sends the seconds left
// (X-Retry-After) from both limits: the per-account cap of 10 tries per 15
// minutes (src/auth/auth.ts) and Better Auth's per-address limit, whose
// windows are 60 seconds. The sign-in page turns that into whole minutes.
import { createTranslator } from "next-intl";
import { describe, expect, it } from "vitest";
import { createAttemptLimiter } from "@/auth/attempts";
import { retryAfterProbe, waitMinutes } from "@/lib/retry-after";
import ar from "../messages/ar.json";
import en from "../messages/en.json";

describe("minutes to wait", () => {
  it("rounds the server's seconds up to whole minutes, never less than one", () => {
    expect(waitMinutes("1")).toBe(1);
    expect(waitMinutes("59")).toBe(1);
    expect(waitMinutes("60")).toBe(1);
    expect(waitMinutes("61")).toBe(2);
    expect(waitMinutes("690")).toBe(12);
    expect(waitMinutes("900")).toBe(15);
  });

  it("gives no number when the server sent no usable time", () => {
    for (const v of [null, undefined, "", " ", "soon", "0", "-5", "NaN"]) expect(waitMinutes(v)).toBeNull();
  });

  it("is up to 15 minutes for the per-account cap and one minute for the per-address limit", () => {
    // The account cap as auth.ts sets it: locked on the 11th try, for what is left of 15 minutes.
    const perAccount = createAttemptLimiter({ max: 10, windowSeconds: 15 * 60 });
    for (let i = 0; i < 10; i++) expect(perAccount.take("a@x", i * 1000)).toBeNull();
    expect(waitMinutes(String(perAccount.take("a@x", 10_000)))).toBe(15);
    expect(waitMinutes(String(perAccount.take("a@x", 3 * 60_000 + 10_000)))).toBe(12);
    expect(waitMinutes(String(perAccount.take("a@x", 15 * 60_000 - 1000)))).toBe(1);
    // Better Auth's per-address windows are 60 seconds, so its answer is never more than 60.
    expect(waitMinutes("60")).toBe(1);
  });

  it("reads the time from a 429 answer only", () => {
    const limited = retryAfterProbe();
    limited.options.onError({ response: new Response(null, { status: 429, headers: { "X-Retry-After": "700" } }) });
    expect(limited.minutes()).toBe(12);
    const wrong = retryAfterProbe();
    wrong.options.onError({ response: new Response(null, { status: 401, headers: { "X-Retry-After": "700" } }) });
    expect(wrong.minutes()).toBeNull();
    const bare = retryAfterProbe();
    bare.options.onError({ response: new Response(null, { status: 429 }) });
    expect(bare.minutes()).toBeNull();
  });
});

describe("the message on the sign-in page", () => {
  const say = (locale: "ar" | "en", minutes: number) =>
    createTranslator({ locale, messages: locale === "ar" ? ar : en, namespace: "signIn" })("limited", { minutes });

  it("names the minutes in Arabic with the right plural form", () => {
    expect(say("ar", 1)).toBe("محاولات كثيرة. حاول مجدداً بعد دقيقة واحدة.");
    expect(say("ar", 2)).toBe("محاولات كثيرة. حاول مجدداً بعد دقيقتين.");
    expect(say("ar", 3)).toBe("محاولات كثيرة. حاول مجدداً بعد 3 دقائق.");
    expect(say("ar", 10)).toBe("محاولات كثيرة. حاول مجدداً بعد 10 دقائق.");
    expect(say("ar", 12)).toBe("محاولات كثيرة. حاول مجدداً بعد 12 دقيقة.");
    expect(say("ar", 15)).toBe("محاولات كثيرة. حاول مجدداً بعد 15 دقيقة.");
  });

  it("names the minutes in English", () => {
    expect(say("en", 1)).toBe("Too many tries. Try again in 1 minute.");
    expect(say("en", 12)).toBe("Too many tries. Try again in 12 minutes.");
  });

  it("no longer promises one minute for a lock that can last fifteen", () => {
    for (const messages of [ar, en]) {
      expect(messages.signIn.limited).toContain("{minutes, plural,");
      expect(messages.signIn.limitedNoTime).not.toMatch(/دقيقة|minute/);
    }
  });
});
