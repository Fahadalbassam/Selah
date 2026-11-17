// The invite warning (decision 1a; the lead's ruling on the review, 17 Nov 2026), drawn with the
// real messages in both languages, on both paths: booking a meeting of the whole project, and
// adding someone to one already booked. Someone in no department is not sent to "their
// department's meeting" (the review's note 9): no department's meeting would include them.
import { NextIntlClientProvider } from "next-intl";
import { createElement, type ComponentProps, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import ar from "../messages/ar.json";
import en from "../messages/en.json";
import { LeftOutWarning } from "@/components/meeting-left-out";

const html = (locale: "ar" | "en", node: ReactNode) => {
  const props = { locale, messages: locale === "ar" ? ar : en, timeZone: "Asia/Riyadh" } as unknown as ComponentProps<typeof NextIntlClientProvider>;
  return renderToStaticMarkup(createElement(NextIntlClientProvider, props, node));
};
const text = (s: string) =>
  s
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");
const reem = { name: "Reem", departmentIds: ["board"] };
const sara = { name: "Sara", departmentIds: [] };

describe("the invite warning while booking a meeting of the whole project", () => {
  it("names the person and offers her department's meeting", () => {
    for (const locale of ["en", "ar"] as const) {
      const out = html(locale, createElement(LeftOutWarning, { people: [reem], offers: [{ id: "board", label: "Board secretariat" }] }));
      expect(out).toContain("Reem");
      const words = (locale === "en" ? en : ar).meeting.form;
      expect(text(out)).toContain(words.makeDepartmentMeeting.replace("{department}", "Board secretariat"));
      expect(text(out)).not.toContain(words.leftOutNoOffer);
    }
  });

  it("for someone in no department, says no department's meeting would include her, not 'book their department's'", () => {
    for (const locale of ["en", "ar"] as const) {
      const words = (locale === "en" ? en : ar).meeting.form;
      const out = text(html(locale, createElement(LeftOutWarning, { people: [sara], offers: [] })));
      expect(out).toContain("Sara");
      expect(out).not.toContain(words.leftOutNoOffer);
      expect(out).toMatch(locale === "en" ? /no department/ : /أي إدارة/);
    }
  });
});

describe("the invite warning when adding someone to a meeting already booked", () => {
  it("says the meeting keeps its department, or that she is in none", () => {
    for (const locale of ["en", "ar"] as const) {
      const words = (locale === "en" ? en : ar).meeting.form;
      const inOne = text(html(locale, createElement(LeftOutWarning, { people: [reem], booked: true })));
      expect(inOne).toContain(words.leftOutKeepsDepartment);
      const inNone = text(html(locale, createElement(LeftOutWarning, { people: [sara], booked: true })));
      expect(inNone).not.toContain(words.leftOutKeepsDepartment);
      expect(inNone).toMatch(locale === "en" ? /no department/ : /أي إدارة/);
    }
  });

  it("draws nothing when nobody is left out", () => {
    expect(html("en", createElement(LeftOutWarning, { people: [] }))).toBe("");
  });
});
