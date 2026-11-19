// D3, drawn (review S1, S6): the words as a reader sees them, rendered with
// the real message files, not read from the source. A client screen draws
// "Waiting for you" for its own side; the firm reads "Waiting for the
// client"; the meeting page says what the Meetings list says.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NextIntlClientProvider } from "next-intl";
import { createElement, type ComponentProps, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import ar from "../messages/ar.json";
import en from "../messages/en.json";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {}, push() {} }) }));

import { PlanActions } from "@/app/(app)/projects/[id]/plan-actions";
import { MeetingWord } from "@/components/status-badge";
import { meetingUnanswered } from "@/lib/status-words";

const html = (locale: "ar" | "en", node: ReactNode) => {
  const props = { locale, messages: locale === "ar" ? ar : en, timeZone: "Asia/Riyadh" } as unknown as ComponentProps<typeof NextIntlClientProvider>;
  return renderToStaticMarkup(createElement(NextIntlClientProvider, props, node));
};
const text = (s: string) => s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const source = (path: string) => readFileSync(join(__dirname, "../src", path), "utf8");

describe("an action sent back, on the project's Plan", () => {
  const row = { id: "a1", title: "Board charter", status: "revision_requested" as const, dueDate: null, ownerName: "Dana", overdue: false };
  const plan = (client: boolean, locale: "ar" | "en") => text(html(locale, createElement(PlanActions, { rows: [row], evidence: {}, client })));

  it("a client reader reads 'Waiting for you'", () => {
    expect(plan(true, "ar")).toContain("بانتظاركم");
    expect(plan(true, "en")).toContain("Waiting for you");
    expect(plan(true, "ar")).not.toContain("مطلوب تعديل");
  });

  it("the firm reads 'Waiting for the client'", () => {
    expect(plan(false, "ar")).toContain("بانتظار العميل");
    expect(plan(false, "en")).toContain("Waiting for the client");
  });

  it("the project page passes the client reader to Plan for a client", () => {
    expect(source("app/(app)/projects/[id]/page.tsx")).toMatch(/<PlanActions[\s\S]*?client=\{!firmStaff\}/);
  });
});

describe("a meeting's word, on its page as on its list (S1)", () => {
  const soon = new Date(Date.now() + 86_400_000);
  const past = new Date(Date.now() - 86_400_000);
  const invited = { role: "required", response: "needs_action" };

  it("waits for an invited reader who has not answered, while it is to come", () => {
    expect(meetingUnanswered({ status: "scheduled", endsAt: soon }, invited)).toBe(true);
    expect(meetingUnanswered({ status: "scheduled", endsAt: past }, invited)).toBe(false);
    expect(meetingUnanswered({ status: "scheduled", endsAt: soon }, { role: "organizer", response: "needs_action" })).toBe(false);
    expect(meetingUnanswered({ status: "scheduled", endsAt: soon }, { role: "required", response: "accepted" })).toBe(false);
    expect(meetingUnanswered({ status: "scheduled", endsAt: soon }, null)).toBe(false);
    expect(meetingUnanswered({ status: "held", endsAt: soon }, invited)).toBe(false);
  });

  it("draws the word, and the exact state beside it", () => {
    const out = text(html("ar", createElement(MeetingWord, { status: "scheduled", unanswered: true, reader: "client" })));
    expect(out).toContain("بانتظاركم");
    expect(out).toContain("مجدول");
    expect(text(html("en", createElement(MeetingWord, { status: "held", unanswered: false, reader: "client" })))).toContain("Held");
  });

  it("the meeting page draws it from the reader's own invitation", () => {
    const page = source("app/(app)/meetings/[id]/page.tsx");
    expect(page).toContain("<MeetingWord");
    expect(page).toContain("meetingUnanswered(meeting, mine)");
    expect(page).not.toMatch(/\{t\(`status\.\$\{meeting\.status\}`\)\}/);
  });
});
