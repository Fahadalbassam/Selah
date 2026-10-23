import { describe, expect, it } from "vitest";
import { accountKey, createAttemptLimiter } from "@/auth/attempts";

describe("sign-in attempts per account", () => {
  it("allows max tries in the window, then says how long to wait", () => {
    const limit = createAttemptLimiter({ max: 3, windowSeconds: 60 });
    expect([0, 1, 2].map((s) => limit.take("a@x", s * 1000))).toEqual([null, null, null]);
    expect(limit.take("a@x", 10_000)).toBe(50);
  });

  it("uses a fixed window: refused tries don't push the reopening back", () => {
    const limit = createAttemptLimiter({ max: 1, windowSeconds: 60 });
    limit.take("a@x", 0);
    expect(limit.take("a@x", 30_000)).toBe(30);
    expect(limit.take("a@x", 59_000)).toBe(1);
    expect(limit.take("a@x", 60_000)).toBeNull();
  });

  it("counts each account on its own, whatever the case of the address", () => {
    const limit = createAttemptLimiter({ max: 1, windowSeconds: 60 });
    expect(limit.take(accountKey(" Sara@Mizan.example ")!, 0)).toBeNull();
    expect(limit.take(accountKey("sara@mizan.example")!, 1)).not.toBeNull();
    expect(limit.take(accountKey("khalid@mizan.example")!, 2)).toBeNull();
    expect(accountKey("")).toBeNull();
    expect(accountKey(undefined)).toBeNull();
  });

  it("reports a lockout once per window, so it can be recorded", () => {
    const locked: string[] = [];
    const limit = createAttemptLimiter({ max: 1, windowSeconds: 60, onLock: (k) => locked.push(k) });
    limit.take("a@x", 0);
    limit.take("a@x", 1);
    limit.take("a@x", 2);
    expect(locked).toEqual(["a@x"]);
    limit.take("a@x", 60_000); // a new window
    limit.take("a@x", 60_001);
    expect(locked).toEqual(["a@x", "a@x"]);
  });
});
