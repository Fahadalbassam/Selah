import { describe, expect, it } from "vitest";
import { firmToday } from "@/lib/dates";

describe("firmToday", () => {
  it("uses Riyadh's date, not UTC's, around midnight", () => {
    // 22:30 UTC on Oct 20 is 01:30 on Oct 21 in Riyadh (UTC+3).
    expect(firmToday(new Date("2026-10-20T22:30:00Z"))).toBe("2026-10-21");
    expect(firmToday(new Date("2026-10-20T20:59:00Z"))).toBe("2026-10-20");
  });
});
