// Batch 1, part A (page audit section 5): the firm's machinery is not drawn on
// the client's pages, the meeting page shows its record once the meeting is
// held, and the client's screens speak to the reader. Checked against the
// real message catalogues and, where a component decides, by drawing it.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NextIntlClientProvider } from "next-intl";
import { createElement, type ComponentProps, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import ar from "../messages/ar.json";
import en from "../messages/en.json";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {}, push() {} }) }));

import { ActionPanel } from "@/app/(app)/actions/[id]/action-panel";
import { PlainDateLines } from "@/app/(app)/actions/[id]/client-view";
import { RespondButtons } from "@/app/(app)/meetings/[id]/record-panels";
import { actionPageCards, plainDateLines, type LadderStepLike } from "@/lib/action-plain";
import { meetingSections } from "@/lib/meetings";
import { progressParts } from "@/lib/progress-parts";

const html = (locale: "ar" | "en", node: ReactNode) => {
  const props = { locale, messages: locale === "ar" ? ar : en, timeZone: "Asia/Riyadh" } as unknown as ComponentProps<typeof NextIntlClientProvider>;
  return renderToStaticMarkup(createElement(NextIntlClientProvider, props, node));
};
const text = (s: string) => s.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/\s+/g, " ");
const source = (path: string) => readFileSync(join(__dirname, "../src", path), "utf8");
const get = (m: object, key: string) => key.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], m);

/** Every string of a catalogue under a key, with its full key. */
function strings(m: object, key: string): [string, string][] {
  const v = get(m, key);
  if (typeof v === "string") return [[key, v]];
  if (!v || typeof v !== "object") throw new Error(`no message ${key}`);
  return Object.keys(v).flatMap((k) => strings(m, `${key}.${k}`));
}

// The reminder ladder's and the date card's own words, which a client reader no longer meets.
const MACHINERY_AR = /تصعيد|التذكيرات|سجل المواعيد|طُلب بعد موعد الاستحقاق|اعتماد واحد من اثنين|اعتمادين|الموعد الأصلي/;
const MACHINERY_EN = /escalation|Reminders|Date history|Asked after the due date|sign-off|original date/i;

describe("a client reader's action page (page audit 4.5)", () => {
  it("draws no reminder ladder, no date history and no sign-off count; the firm keeps all three", () => {
    expect(actionPageCards(false)).toEqual({ ladder: false, dateHistory: false, signOffs: false, riskCard: false, muteButton: false });
    expect(actionPageCards(true)).toEqual({ ladder: true, dateHistory: true, signOffs: true, riskCard: true, muteButton: true });
  });

  it("the page follows that rule for every card, and leaves the first sign-off out of a client's history", () => {
    const page = source("app/(app)/actions/[id]/page.tsx");
    expect(page).toMatch(/cards\.ladder \? <ReminderLadder/);
    expect(page).toMatch(/cards\.dateHistory \? \(\s*<DeadlineRequests/);
    expect(page).toMatch(/cards\.signOffs \? <SecondReviewCard/);
    expect(page).toMatch(/second=\{cards\.signOffs \? second : undefined\}/);
    expect(page).toMatch(/cards\.muteButton \? <MuteButton/);
    expect(page).toMatch(/data\.timeline\.filter\(\(e\) => e\.kind !== "signoff"\)/);
    // Risk acceptance and a new date stay reachable: the menu and the quiet link, where the role may use them.
    expect(page).toMatch(/<ActionMenu actionId=\{action\.id\} muted=\{muted\} canSign=\{closing\.can\.sign\} \/>/);
    expect(page).toMatch(/follow\.can\.requestDeadline \? \{ actionId: action\.id/);
    // The risk card is a record only: drawn once something is signed, never as a standing button.
    expect(source("app/(app)/actions/[id]/closure-panels.tsx")).toMatch(/if \(!items\.length\) return null;/);
  });

  it("draws the sign-off count under the next step for the firm only", () => {
    const second = {
      required: true,
      reason: "all" as const,
      rule: "all" as const,
      flagged: false,
      revisions: 0,
      signoff: { name: "Khalid", at: new Date("2026-11-10T09:00:00Z") },
      candidates: [{ id: "u2", name: "Noura", fallback: false }],
      can: { signOff: false, verify: false, flag: false },
    };
    const props = { actionId: "a1", status: "awaiting_review" as const, moves: [], can: { addUpdate: false, submitEvidence: false }, second };
    for (const locale of ["ar", "en"] as const) {
      const m = locale === "ar" ? ar : en;
      const client = text(html(locale, createElement(ActionPanel, { ...props, firmView: false })));
      expect(client).toContain(m.action.awaitingNote);
      expect(client).not.toContain(m.action.secondReview.halfDone);
      expect(client).not.toContain(m.action.secondReview.signedClient);
      expect(client).not.toMatch(locale === "ar" ? MACHINERY_AR : MACHINERY_EN);
      const firm = text(html(locale, createElement(ActionPanel, { ...props, firmView: true })));
      expect(firm).toContain(m.action.secondReview.halfDone);
    }
  });

  const ladder = (steps: Partial<LadderStepLike>[], running = true) => ({
    running,
    steps: steps.map((s, i) => ({ level: i, onDate: "2026-12-01", audience: ["owner" as const], sentAt: null, ...s })),
  });
  const base = { status: "in_progress" as const, dueDate: "2026-12-05", overdue: false, ladder: ladder([]), requests: [], moves: [], readerId: "me" };

  it("says what is expected next and by when, without the ladder", () => {
    // Nothing is expected of the client on finished work, a draft, or while the consultant reviews it.
    for (const status of ["verified_complete", "closed", "draft", "awaiting_review"] as const) expect(plainDateLines({ ...base, status }).next).toBeNull();
    expect(plainDateLines({ ...base, dueDate: null }).next).toBeNull();
    // The next step reaches only the owner: a reminder.
    expect(plainDateLines({ ...base, ladder: ladder([{ onDate: "2026-12-03" }]) }).next).toEqual({
      kind: "due",
      due: "2026-12-05",
      reminderOn: "2026-12-03",
      tellOn: null,
      who: [],
    });
    // Late, and the next step reaches others: who is told, and when, in plain words; a step already sent is passed.
    const late = plainDateLines({
      ...base,
      overdue: true,
      ladder: ladder([
        { sentAt: new Date("2026-11-20T06:00:00Z") },
        { onDate: "2026-12-12", audience: ["owner", "client_managers", "client_admins", "client_admins_for_head", "sponsor"] },
      ]),
    }).next;
    expect(late).toEqual({ kind: "late", due: "2026-12-05", tellOn: "2026-12-12", who: ["managers", "admins", "sponsor"] });
    // Reminders paused (the project is not active): only the date.
    expect(plainDateLines({ ...base, ladder: ladder([{ onDate: "2026-12-03" }], false) }).next).toEqual({
      kind: "due",
      due: "2026-12-05",
      reminderOn: null,
      tellOn: null,
      who: [],
    });
  });

  it("says what happened last to the date: a proposal waiting, else the latest move or refusal", () => {
    const at = (d: string) => new Date(`${d}T09:00:00Z`);
    const moves = [
      { to: "2026-11-26", by: "Khalid", viaRequest: true, at: at("2026-11-16") },
      { to: "2026-12-05", by: "Khalid", viaRequest: false, at: at("2026-11-18") },
    ];
    const declined = { status: "rejected" as const, proposedDueDate: "2026-12-20", requestedBy: "Sara", requestedById: "me", decidedBy: "Omar", decidedAt: at("2026-11-17"), createdAt: at("2026-11-15") };
    const pending = { status: "pending" as const, proposedDueDate: "2026-12-30", requestedBy: "Sara", requestedById: "me", createdAt: at("2026-11-19") };
    expect(plainDateLines({ ...base }).last).toBeNull();
    expect(plainDateLines({ ...base, moves, requests: [declined] }).last).toEqual({ kind: "moved", date: "2026-12-05", by: "Khalid", agreed: false, at: at("2026-11-18") });
    expect(plainDateLines({ ...base, moves: moves.slice(0, 1), requests: [declined] }).last).toEqual({ kind: "declined", date: "2026-12-20", by: "Omar", at: at("2026-11-17") });
    expect(plainDateLines({ ...base, moves, requests: [declined, pending] }).last).toEqual({ kind: "proposed", date: "2026-12-30", by: "Sara", mine: true });
    expect(plainDateLines({ ...base, requests: [pending], readerId: "someone-else" }).last).toMatchObject({ kind: "proposed", mine: false });
    // Finished work: its date no longer matters.
    expect(plainDateLines({ ...base, status: "verified_complete", moves }).last).toBeNull();
  });

  it("puts both lines in words the client reads, Arabic first, with no ladder words and no 'the client'", () => {
    const next = { kind: "late" as const, due: "2026-12-05", tellOn: "2026-12-12", who: ["managers" as const, "sponsor" as const] };
    const last = { kind: "moved" as const, date: "2026-12-05", by: "خالد الشمري", agreed: true, at: new Date("2026-11-16T09:00:00Z") };
    const ask = { actionId: "a1", dueDate: "2026-12-05" };
    const arOut = text(html("ar", createElement(PlainDateLines, { next, last, ask })));
    expect(arOut).toContain("مديرو شركتكم وراعي المشروع");
    expect(arOut).toContain("بموافقة خالد الشمري");
    expect(arOut).toContain(ar.action.plain.ask);
    expect(arOut).not.toMatch(MACHINERY_AR);
    expect(arOut).not.toMatch(/العميل/);
    const enOut = text(html("en", createElement(PlainDateLines, { next, last, ask })));
    expect(enOut).toContain("your company's managers and the project's sponsor will be told too");
    expect(enOut).toContain("New date Dec 5, 2026, agreed by خالد الشمري");
    expect(enOut).toContain("I need more time");
    expect(enOut).not.toMatch(MACHINERY_EN);
    expect(enOut).not.toMatch(/\bthe client\b/i);
  });
});

describe("the meeting page before and after it is held (U14)", () => {
  it("shows what a person needs to attend before the meeting, and its record once it is held", () => {
    const none = { summary: false, decisions: false, transcript: false, followUps: false, record: false };
    expect(meetingSections("scheduled", 0)).toEqual(none);
    expect(meetingSections("cancelled", 0)).toEqual(none);
    expect(meetingSections("held", 0)).toEqual({ summary: true, decisions: true, transcript: true, followUps: true, record: true });
    // A follow-up already written stays listed, with nothing new to add until the meeting is held.
    expect(meetingSections("scheduled", 2)).toEqual({ ...none, followUps: true });
  });

  it("the page draws the summary, the decisions, the follow-ups and the transcript only by that rule, for both sides", () => {
    const page = source("app/(app)/meetings/[id]/page.tsx");
    expect(page).toMatch(/const show = meetingSections\(meeting\.status, followUps\.length\)/);
    expect(page).toMatch(/\{show\.summary \? \(\s*<Card/);
    expect(page).toMatch(/\{show\.decisions \? \(\s*<Card/);
    expect(page).toMatch(/\{show\.followUps && /);
    expect(page).toMatch(/firm && canRun && show\.transcript \? \(\s*<TranscriptPanel/);
    // Who sees it is the firm's word: no "Shared with the client" badge for a client reader.
    expect(page).toMatch(/\{firm \? <Badge variant="outline">\{tVis\(meeting\.visibility\)\}<\/Badge> : null\}/);
  });

  it("lets the reader answer in their own voice, with no second solid button beside the call link", () => {
    for (const locale of ["ar", "en"] as const) {
      const m = locale === "ar" ? ar : en;
      const out = html(locale, createElement(RespondButtons, { meetingId: "m1", current: "accepted" }));
      for (const r of ["accepted", "tentative", "declined"] as const) expect(text(out)).toContain(m.meeting.reply[r]);
      expect(out).toContain('aria-pressed="true"');
      expect(out).not.toMatch(/bg-primary /);
    }
    expect(ar.meeting.reply.accepted).toBe("سأحضر");
    expect(ar.meeting.reply.declined).toBe("أعتذر");
  });
});

describe("the client's Progress tab", () => {
  it("is the share verified, how the actions ended and the shared reports: no firm measures, no handover card", () => {
    expect(progressParts(false)).toEqual({ implemented: true, outcomes: true, reports: true, measures: false, lateAgainstOriginal: false, history: false, handover: false });
    expect(Object.values(progressParts(true)).every(Boolean)).toBe(true);
    const page = source("app/(app)/projects/[id]/page.tsx");
    expect(page).toMatch(/handover: principal\.orgKind === "firm" \? await getHandover/);
    expect(page).toMatch(/\{handover \? <HandoverCard/);
    expect(source("app/(app)/projects/[id]/progress-tab.tsx")).toMatch(/if \(!parts\.measures\)\s*return \(\s*<div className="space-y-6">\s*<p className="text-sm text-muted-foreground">\{t\("hintClient"\)\}<\/p>/);
  });

  it("says plainly what the tab shows the client", () => {
    expect(ar.metrics.hintClient).toMatch(/مستشاركم.*وكيف انتهت الإجراءات.*التقارير التي شاركها المكتب معكم/);
    expect(en.metrics.hintClient).toMatch(/your consultant has verified, how the actions ended, and the reports the firm has shared with you/);
  });
});

// The strings a client reader meets on the screens this batch touches.
const CLIENT_KEYS = [
  "action.plain",
  "action.menu",
  "action.risk.hintRead",
  "action.risk.hintClient",
  "action.risk.sign",
  "action.risk.signHint",
  "action.risk.statementPlaceholder",
  "action.risk.agree",
  "action.items.titleClient",
  "action.items.hintClient",
  "action.items.answer",
  "action.items.answerTitle",
  "action.thread.hintClient",
  "action.thread.sides.yours",
  "action.owner",
  "action.due",
  "action.requiredEvidence",
  "action.verifiedNote",
  "action.awaitingNote",
  "action.noMoves",
  "action.move.in_progress",
  "action.move.awaiting_review",
  "action.move.blocked",
  "action.resume",
  "action.uploadOnly",
  "action.evidenceTitle",
  "action.evidenceHint",
  "action.upload",
  "action.sendForReview",
  "action.errors.notShared",
  "action.errors.needEvidence",
  "action.errors.narrowed",
  "action.entry",
  "action.deadline.ask",
  "action.deadline.askHint",
  "metrics.hintClient",
  "metrics.implementedOf",
  "metrics.outcome",
  "metrics.reportsHintClient",
  "meeting.reply",
  "meeting.response",
  "meeting.agendaOwn",
  "meeting.agendaReadable",
  "meeting.noSummary",
  "meeting.form.yourPeople",
  "meeting.record.followUps",
  "meeting.record.confirmedBy",
  "home.title",
  "home.nothingWaits",
  "home.showAll",
  "home.steps",
  "home.mine",
  "home.client",
  "home.owner",
  "indicators.hintClient",
  "indicators.emptyManageClient",
  "indicators.linkedHintClient",
  "response.titleClient",
  "response.whoRespondsClient",
  "response.hintClient",
  "recommendationPage.requiredEvidence",
  "projectPeople.titleClient",
  "projectPeople.hintClient",
  "projectPeople.noCandidatesClient",
  "projectPeople.noneClient",
  "projectPeople.removeConfirmClient",
  "clientRoles.titleClient",
  "clientRoles.hintClient",
  "clientRoles.about",
  "project.eventsClient",
  "project.requiredEvidence",
  "plan.findings.titleClient",
  "plan.findings.hintClient",
  "infoRequests.title",
  "infoRequests.hintClient",
  "infoRequests.ownedBy",
  "infoRequests.sharedHint",
  "infoRequests.naHint",
  "closure.caseStudy.hint",
  "closure.caseStudy.levelHints",
  "closure.caseStudy.defaultNone",
  "engagement.departments.listHintOn",
  "clientGroups.pooledNote",
  "help.faq.dueDate.a",
  "roleClient",
  "notifications.kinds.action_assigned",
];

describe("client wording (page audit 4.7)", () => {
  it("never speaks about 'the client' to the client, in either language", () => {
    for (const key of CLIENT_KEYS) {
      for (const [k, v] of strings(ar, key)) expect(v, k).not.toMatch(/العميل|عميل/);
      for (const [k, v] of strings(en, key)) expect(v, k).not.toMatch(/\bclients?\b|client's/i);
    }
  });

  it("uses none of the firm's working words on those screens", () => {
    for (const key of CLIENT_KEYS) {
      for (const [k, v] of strings(en, key)) expect(v, k).not.toMatch(/triage|staffing|review queue|firm notes|escalat|released to you/i);
      for (const [k, v] of strings(ar, key)) expect(v, k).not.toMatch(/تصعيد|ملاحظات المكتب|التوزيع/);
    }
  });

  it("calls the firm «المكتب», never «الشركة»: «الشركة» is the client's own company", () => {
    const firmMeant = [
      "action.verifiedNote",
      "action.notes.title",
      "action.notes.hint",
      "action.ladder.paused",
      "visibility.firm_private",
      "fileActions.shareWithFirm",
      "fileActions.shareWithFirmConfirm",
      "infoRequests.hintClient",
      "infoRequests.sharedHint",
      "infoRequests.naHint",
      "plan.rec.addHint",
      "plan.action.evidenceHint",
      "plan.action.ownerNameHint",
      "projects.internalNote",
      "clientGroups.notes",
    ];
    for (const key of firmMeant) {
      expect(get(ar, key), key).toMatch(/المكتب|للمكتب|بالمكتب/);
      expect(get(ar, key), key).not.toMatch(/الشركة/);
    }
  });

  it("keeps «متعثر» for a blocked action only: the project label is another word", () => {
    expect(ar.oversight.signals.off_track).not.toMatch(/متعثر/);
    expect(ar.oversight.health.hint).not.toMatch(/متعثر/);
    expect(ar.status.blocked).toBe("متعثر");
  });

  it("calls an action's owner «المكلَّف», and keeps «مسؤول» for administrators", () => {
    for (const key of ["action.owner", "table.owner", "plan.action.owner", "meeting.record.assignee", "action.ladder.audience.owner", "reportPdf.colOwner", "statusPack.owner"])
      expect(get(ar, key), key).toBe("المكلَّف");
    expect(ar.role.action_owner).toBe("مكلَّف بالتنفيذ");
    expect(ar.action.move.assigned).toBe("إسناد إلى المكلَّف");
    expect(ar.action.plain.who.admins).toMatch(/مسؤولو النظام/);
  });

  it("names sending a file two ways only: «إرسال ملف» and «إرسال للمراجعة»", () => {
    expect(ar.action.uploadOnly).toBe("إرسال ملف");
    expect(ar.action.evidenceTitle).toBe("إرسال ملف");
    expect(ar.action.items.answer).toBe("إرسال ملف");
    expect(ar.action.move.awaiting_review).toBe("إرسال للمراجعة");
    expect(ar.action.sendForReview).toBe("إرسال للمراجعة");
    expect(en.action.uploadOnly).toBe("Send a file");
    expect(en.action.move.awaiting_review).toBe("Send for review");
    expect(en.action.sendForReview).toBe("Send for review");
    for (const [k, v] of [...strings(ar, "action"), ...strings(ar, "welcome.steps.action_owner"), ...strings(ar, "project.events")])
      expect(v, k).not.toMatch(/إرفاق دليل|تقديم دليل|ارفع الدليل|أرفق الملف|دليل مُقدَّم/);
  });

  it("does not use «طلب» for a new date on the client's page: the client proposes one", () => {
    for (const [k, v] of [...strings(ar, "action.plain"), ["action.deadline.ask", ar.action.deadline.ask] as [string, string]]) expect(v, k).not.toMatch(/طلب/);
    expect(ar.infoRequests.title).not.toMatch(/طلب/);
  });
});
