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

describe("counts on the Projects cards (page audit 3.8)", () => {
  const count = (locale: "ar" | "en", n: number) =>
    createTranslator({ locale, messages: locale === "ar" ? ar : en, namespace: "projects" })("actions", { n });

  it("uses plural forms: 1 action, not 1 actions", () => {
    expect(count("en", 1)).toBe("1 action");
    expect(count("en", 9)).toBe("9 actions");
    expect(count("ar", 1)).toBe("إجراء واحد");
    expect(count("ar", 2)).toBe("إجراءان");
    expect(count("ar", 4)).toBe("4 إجراءات");
    expect(count("ar", 11)).toBe("11 إجراءً");
  });
});

describe("history lines name a person without a gendered verb (page audit 3.8)", () => {
  const line = (locale: "ar" | "en", event: string, name: string) =>
    String(createTranslator({ locale, messages: locale === "ar" ? ar : en, namespace: "common" }).rich("byLine", { event, name, who: (c) => `[${c}]` }));

  it("reads 'evidence submitted, by Salma' in Arabic, 'Salma submitted evidence' in English", () => {
    expect(line("ar", ar.action.entry.evidence, "سلمى الشهري")).toBe("دليل مُقدَّم، بواسطة [سلمى الشهري]");
    expect(line("en", en.action.entry.evidence, "Salma Al-Shehri")).toBe("[Salma Al-Shehri] submitted evidence");
  });

  it("names the person who did it, never someone the event came from (review finding 1)", () => {
    // With "{event} من {name}" these read the wrong way round: Sara as the old owner, a review of Omar's request.
    expect(line("ar", ar.inbox.events.owner_changed, "سارة")).toBe("تغيير المسؤول، بواسطة [سارة]");
    expect(line("ar", ar.project.events.info_request_reviewed, "عمر")).toBe("مراجعة طلب، بواسطة [عمر]");
    expect(line("ar", ar.action.entry.signoff, "عمر")).toBe("الاعتماد الأول من اعتمادَين، بواسطة [عمر]");
  });

  it("reads right for every event kind, in both languages", () => {
    const values = { from: "«أ»", to: "«ب»", name: "خالد", status: "لا تعارض", date: "12 Nov" };
    const all = (locale: "ar" | "en") => {
      const m = locale === "ar" ? ar : en;
      // Every key of the namespace, with whatever values its messages take; typed loosely on purpose.
      const t = (ns: string) => createTranslator({ locale, messages: m, namespace: ns as never }) as unknown as (key: string, v: typeof values) => string;
      return [
        ...Object.keys(m.action.entry).map((k) => t("action.entry")(k, values)),
        ...Object.keys(m.project.events).map((k) => t("project.events")(k, values)),
        ...Object.keys(m.inbox.events).map((k) => t("inbox.events")(k, values)),
        t("project")("changed", values),
      ];
    };
    for (const event of all("ar")) {
      const out = line("ar", event, "سلمى");
      // The doer comes once, after a comma, with the one word that can only mean "by".
      expect(out, out).toMatch(/^[^[]+، بواسطة \[سلمى\]$/);
      expect(out.match(/بواسطة/g), out).toHaveLength(1);
      expect(out, out).not.toMatch(/من،/);
    }
    for (const event of all("en")) {
      expect(line("en", event, "Salma")).toMatch(/^\[Salma\] \S/);
    }
  });

  it("puts every Arabic history event in a form that fits a man or a woman", () => {
    // The old lines began with a masculine past verb ("قدّم دليلاً", "أضاف إجراءً"...): none does now. Nouns
    // spelled like a verb ("نشر تحديث", "طلب تعديل") are verbal nouns: no object in the accusative follows.
    const masculine = /^(قدّم|قبِل|أضاف|عدّل|أرسل|أزال|راجع|أعاد|شارك|بدأ|استلم|علّق|لم يقبل|أعفى|سجّل|وافق|ردّ|أكّد|أجاب|أجرى|غيّر|حوّل|أسند|أدخل|اعتمد |نقله|طلبه)|^\S+ \S+(ًا|اً|ءً)(\s|$)/;
    const events = [...Object.values(ar.action.entry), ...Object.values(ar.project.events), ...Object.values(ar.inbox.events), ar.project.changed];
    for (const e of events) expect(e, e).not.toMatch(masculine);
  });
});

describe("the product's Arabic name (page audit 3.8)", () => {
  it('is spelled "صلة" everywhere but in the accepted, versioned legal texts', () => {
    // Changing those would ask everyone to accept them again (src/lib/legal.ts LEGAL_VERSIONS); they keep "صِلَة" until their next version.
    const versioned = ["legal.terms", "legal.privacy", "legal.ai_notice"];
    const other: string[] = [];
    const walk = (o: object, path: string) => {
      for (const [k, v] of Object.entries(o)) {
        const p = path ? `${path}.${k}` : k;
        if (typeof v === "string") {
          if (v.includes("صِلَة") && !versioned.some((x) => p.startsWith(`${x}.`))) other.push(p);
        } else walk(v as object, p);
      }
    };
    walk(ar, "");
    expect(other).toEqual([]);
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
