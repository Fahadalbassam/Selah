// Readiness status and the alert job's decisions (R4).
import { describe, expect, it } from "vitest";
import {
  alertText,
  decideAlert,
  REMIND_MS,
  statusOf,
  type AlertState,
} from "@/lib/ops";

const check = (name: string, ok: boolean, critical = true) => ({
  name,
  ok,
  critical,
});

describe("readiness status", () => {
  it("is down when a critical check fails, degraded when only another one does", () => {
    expect(statusOf([check("database", true), check("pdf", true, false)])).toBe(
      "ok",
    );
    expect(
      statusOf([check("database", true), check("pdf", false, false)]),
    ).toBe("degraded");
    expect(
      statusOf([check("database", false), check("pdf", false, false)]),
    ).toBe("down");
    expect(statusOf([])).toBe("ok");
  });
});

describe("when the alert job alerts", () => {
  const quiet: AlertState = { failing: [], alertedAt: null };
  const t0 = Date.UTC(2026, 9, 24, 3);

  it("alerts when something starts failing, not again next round, again after six hours", () => {
    const a = decideAlert(quiet, ["scanner"], t0);
    expect(a.send).toBe("failing");
    const b = decideAlert(a.next, ["scanner"], t0 + 120_000);
    expect(b.send).toBeNull();
    expect(b.next.alertedAt).toBe(t0);
    expect(decideAlert(b.next, ["scanner"], t0 + REMIND_MS).send).toBe(
      "failing",
    );
  });

  it("alerts at once when another check fails, but not when one of several recovers", () => {
    const a = decideAlert(quiet, ["scanner"], t0).next;
    const b = decideAlert(a, ["scanner", "mail"], t0 + 60_000);
    expect(b.send).toBe("failing");
    expect(b.next.failing).toEqual(["mail", "scanner"]);
    expect(decideAlert(b.next, ["mail"], t0 + 120_000).send).toBeNull();
  });

  it("says once that everything recovered, then stays quiet", () => {
    const a = decideAlert(quiet, ["web app"], t0).next;
    const b = decideAlert(a, [], t0 + 60_000);
    expect(b.send).toBe("recovered");
    expect(decideAlert(b.next, [], t0 + 120_000).send).toBeNull();
    expect(decideAlert(quiet, [], t0).send).toBeNull();
  });
});

describe("alert text", () => {
  it("names each failing check with its reason, in Arabic and English", () => {
    const m = alertText(
      "failing",
      ["mail", "scanner"],
      { scanner: "no answer" },
      "https://selah.example",
    );
    expect(m.subject).toMatch(/2 checks failing/);
    expect(m.subject).toMatch(/صِلَة/);
    expect(m.text).toContain("- scanner: no answer");
    expect(m.text).toContain("- mail\n");
    expect(m.text).toContain("https://selah.example");
    expect(alertText("recovered", [], {}, "").text).toMatch(/working again/);
  });
});
