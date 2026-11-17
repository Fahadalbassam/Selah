// Screen texts from the page audit (batch 0) that must say what the rules
// do, in both languages, checked against the real message catalogues.
import { createTranslator } from "next-intl";
import { describe, expect, it } from "vitest";
import ar from "../messages/ar.json";
import en from "../messages/en.json";
import { panelVoice } from "@/lib/engagement";

describe("Today: who decides a date change (N27)", () => {
  // The rule (app_can_extend()): any consultant on the project decides the first
  // two moves; a third move later needs the client's lead, an internal project's
  // lead or a firm admin. The text said only "the lead or the firm admin".
  it("says any consultant on the project decides, and who decides a third move later", () => {
    const enText = en.todayPage.decisions.description;
    expect(enText).toMatch(/any consultant on the project/i);
    expect(enText).toMatch(/third time/);
    expect(enText).toMatch(/internal project's lead/);
    const arText = ar.todayPage.decisions.description;
    expect(arText).toContain("أي مستشار في المشروع");
    expect(arText).toContain("للمرة الثالثة");
    expect(arText).toContain("قائد المشروع الداخلي");
  });
});

describe("an action on a client the firm runs (N24)", () => {
  const firmRunTexts = (m: typeof en | typeof ar) => [
    m.action.items.hintFirmRun,
    m.action.items.addHintFirmRun,
    m.action.items.rejectHintFirmRun,
    m.action.items.waiveHintFirmRun,
    m.action.thread.hintFirmRun,
    m.engagement.recordsForClient,
  ];

  it("picks the firm-run wording only for firm staff on such a client", () => {
    expect(panelVoice(true, true)).toBe("FirmRun");
    expect(panelVoice(true, false)).toBe("Firm");
    expect(panelVoice(false, false)).toBe("Client");
  });

  it("never assumes the client signs in, sends or reads anything in Selah", () => {
    for (const text of firmRunTexts(en)) {
      expect(text).toBeTruthy();
      expect(text).not.toMatch(/talk with the client|the client should send|client sees|they're told/i);
    }
    for (const text of firmRunTexts(ar)) {
      expect(text).toBeTruthy();
      expect(text).not.toMatch(/تحدّث مع العميل|يجب أن يرسله العميل|سيرى العميل|وسيتم إبلاغه/);
    }
    // The wording for a client that signs in is the one that did (and still does) say so.
    expect(en.action.thread.hintFirm).toMatch(/Talk with the client/);
  });

  it("says how and when the client sent a recorded piece, in both languages", () => {
    const say = (locale: "ar" | "en") =>
      createTranslator({ locale, messages: locale === "ar" ? ar : en, namespace: "action" })("received", { via: "email", date: "12 Nov 2026" });
    expect(say("en")).toBe("Received from the client by email on 12 Nov 2026");
    expect(say("ar")).toBe("استُلم من العميل بالبريد الإلكتروني في 12 Nov 2026");
  });
});
