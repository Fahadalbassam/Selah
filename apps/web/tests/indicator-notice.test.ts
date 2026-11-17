// The line an indicator.moved_away notice shows (decision 4b, migration
// 0120): the figures and the direction the client chose, followed by
// "reported by the client, not verified impact", in Arabic and English, and
// never a word that judges ("worse", "off track", "at risk", a colour).
import { createTranslator } from "next-intl";
import { describe, expect, it } from "vitest";
import ar from "../messages/ar.json";
import en from "../messages/en.json";
import { movedAwayValues, type MovedAwayFacts } from "@/lib/indicator-notice";
import { formatValue, periodLabel } from "@/lib/indicators";

const messages = { ar, en };
const line = (locale: "ar" | "en", title: string, f: MovedAwayFacts) =>
  createTranslator({ locale, messages: messages[locale], namespace: "notifications" })("kinds.indicator_moved_away", {
    title,
    ...movedAwayValues(f, locale),
  });

const complaints: MovedAwayFacts = {
  kpiId: "k",
  value: 42,
  period: "2026-10-01",
  frequency: "monthly",
  unit: "شكوى",
  baseline: 30,
  direction: "lower_better",
  target: null,
  targetDate: null,
  targetPassed: false,
};
const onTime: MovedAwayFacts = {
  kpiId: "k2",
  value: 61.5,
  period: "2026-07-01",
  frequency: "quarterly",
  unit: "%",
  baseline: 55,
  direction: "higher_better",
  target: 80,
  targetDate: "2026-09-30",
  targetPassed: true,
};
const cases = [
  { title: { ar: "الشكاوى", en: "Complaints" }, facts: complaints },
  { title: { ar: "الطلبات في موعدها", en: "Orders on time" }, facts: onTime },
  { title: { ar: "الطلبات في موعدها", en: "Orders on time" }, facts: { ...onTime, targetPassed: false } },
  { title: { ar: "الشكاوى", en: "Complaints" }, facts: { ...complaints, direction: "higher_better" as const, value: 20 } },
];

// Words that judge, grade, colour or predict. "better" only ever appears in the client's own direction.
const JUDGING = {
  en: [/worse/i, /off.?track/i, /on.?track/i, /at.?risk/i, /\brisk/i, /\bbad\b/i, /\bpoor/i, /fail/i, /behind/i, /declin/i, /deteriorat/i, /\bred\b/i, /amber/i, /green/i, /warning/i, /alert/i, /concern/i, /problem/i, /miss/i, /\bdrop/i, /\bfell\b/i, /\bgood\b/i],
  ar: [/أسوأ/, /سيئ/, /متأخر/, /تأخر/, /خطر/, /مخاطر/, /تراجع/, /ضعيف/, /أحمر/, /أصفر/, /أخضر/, /تحذير/, /إنذار/, /انحراف/, /منحرف/, /فشل/, /سلبي/, /قلق/, /مشكلة/, /جيد/],
};
const DIRECTION = { en: /(lower|higher) is better/g, ar: /(الأقل|الأعلى) أفضل/g };

describe("the moved-away notice", () => {
  it("says the figures, the baseline and the direction, then that the figures are the client's", () => {
    const expected = {
      ar: `الشكاوى: ${formatValue(42, "ar")} شكوى في ${periodLabel("2026-10-01", "monthly", "ar")}، خط الأساس ${formatValue(30, "ar")} شكوى، الأقل أفضل. أرقام يبلّغ عنها العميل، وليست أثرًا موثّقًا.`,
      en: "Complaints: 42 شكوى in Oct 2026, baseline 30 شكوى, lower is better. Figures reported by the client, not verified impact.",
    };
    expect(line("ar", "الشكاوى", complaints)).toBe(expected.ar);
    expect(line("en", "Complaints", complaints)).toBe(expected.en);
  });

  it("names the target, with its date, once the target date had passed", () => {
    const withTarget = line("en", "Orders on time", onTime);
    expect(withTarget).toContain("Orders on time: 61.5 % in Jul–Sep 2026, baseline 55 %, target 80 % by ");
    expect(withTarget).toContain("higher is better.");
    expect(line("ar", "الطلبات في موعدها", onTime)).toContain(`والمستهدف ${formatValue(80, "ar")} %`);
    // Before the target date only the baseline is stated.
    expect(line("en", "Orders on time", { ...onTime, targetPassed: false })).not.toContain("target");
    expect(line("ar", "الطلبات في موعدها", { ...onTime, targetPassed: false })).not.toContain("المستهدف");
  });

  for (const locale of ["ar", "en"] as const) {
    it(`has no judging word in ${locale === "ar" ? "Arabic" : "English"}`, () => {
      for (const c of cases) {
        const text = line(locale, c.title[locale], c.facts);
        expect(text).toMatch(DIRECTION[locale]);
        expect(text).toMatch(locale === "ar" ? /وليست أثرًا موثّقًا/ : /not verified impact/);
        const rest = text.replace(DIRECTION[locale], "");
        expect(rest).not.toMatch(locale === "ar" ? /أفضل/ : /better/i);
        for (const word of JUDGING[locale]) expect(rest, `${word} in: ${text}`).not.toMatch(word);
      }
    });
  }

  it("the words around the notice judge nothing either", () => {
    for (const locale of ["ar", "en"] as const) {
      const mail = messages[locale].notifications.mail;
      // (The reminders hint is left out: it is about late actions too, which the reminders are for.)
      for (const text of [mail.indicatorMuteHint, mail.indicatorMutedDone, mail.indicatorUnmuted, mail.muted, mail.mutedHint]) {
        const rest = text.replace(DIRECTION[locale], "");
        for (const word of JUDGING[locale]) expect(rest, `${word} in: ${text}`).not.toMatch(word);
      }
    }
  });
});
