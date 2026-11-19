// The report's Send dialog and the buttons under a progress draft in the
// assistant (migration 0110). Opening the dialog only reads (GET); the one
// POST that sends is behind its own Send button, with { confirmed: true }.
// The buttons under a draft only link to the report page or open the dialog.
import { NextIntlClientProvider } from "next-intl";
import { createElement, type ComponentProps, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import ar from "../messages/ar.json";
import en from "../messages/en.json";
import { DraftActions } from "@/components/assistant/assistant-chat";
import { previewUrl, ReportSendDialog, sendState, type SendPreview } from "@/components/reports/report-send-dialog";
import { DRAFT_MARK, withDraftMark, withoutDraftMark } from "@/lib/client-ai";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {}, refresh: () => {} }) }));

const html = (locale: "ar" | "en", node: ReactNode) => {
  const props = { locale, messages: locale === "ar" ? ar : en, timeZone: "Asia/Riyadh" } as unknown as ComponentProps<typeof NextIntlClientProvider>;
  return renderToStaticMarkup(createElement(NextIntlClientProvider, props, node));
};

const preview = (over: Partial<SendPreview> = {}): SendPreview => ({
  id: "r1",
  title: "Monthly",
  kind: "report",
  projectId: "p1",
  client: { en: "Acme", ar: "أكمي" },
  issued: true,
  approval: { at: null, by: null },
  sentAt: null,
  approver: "lead_or_deputy",
  can: { send: false, approve: false },
  ...over,
});

afterEach(() => vi.unstubAllGlobals());

describe("what the Send dialog says", () => {
  it("in order: no report yet, sent, not issued, waiting for approval, ready", () => {
    expect(sendState(null)).toBe("none");
    expect(sendState(preview({ sentAt: "2026-11-19T10:00:00Z", approval: { at: "2026-11-18T10:00:00Z", by: "Dana" } }))).toBe("sent");
    expect(sendState(preview({ issued: false }))).toBe("notIssued");
    expect(sendState(preview())).toBe("waiting");
    // Approved, but this person may not send: no Send button.
    expect(sendState(preview({ approval: { at: "2026-11-18T10:00:00Z", by: "Dana" } }))).toBe("cantSend");
    expect(sendState(preview({ approval: { at: "2026-11-18T10:00:00Z", by: "Dana" }, can: { send: true, approve: false } }))).toBe("ready");
    // A report shared before approval existed has a stamp and no approver: it was sent already.
    expect(sendState(preview({ approval: { at: "2026-01-01T00:00:00Z", by: null }, sentAt: "2026-01-01T00:00:00Z" }))).toBe("sent");
  });

  it("reads from the report, or from the assistant's draft answer: never the address that sends", () => {
    expect(previewUrl({ reportId: "r1" })).toBe("/api/reports/r1/share");
    expect(previewUrl({ messageId: "m1" })).toBe("/api/assistant/messages/m1/report");
  });
});

describe("the buttons under a firm person's progress draft", () => {
  it("link to the report page and open the Send dialog, and nothing is fetched or sent by drawing them", () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    for (const locale of ["en", "ar"] as const) {
      const words = (locale === "en" ? en : ar).reportSend;
      const out = html(locale, createElement(DraftActions, { messageId: "m1" }));
      expect(out).toContain('href="/assistant/draft/m1"');
      expect(out).toContain(words.useDraft);
      expect(out).toContain(words.send);
      // The dialog is closed: none of its words, and no Send-confirm button.
      expect(out).not.toContain(words.sendTitle);
      expect(out).not.toContain(`>${words.confirm}<`);
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it("the report page's Send button is the same dialog, closed until pressed", () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const out = html("en", createElement(ReportSendDialog, { source: { reportId: "r1" }, trigger: createElement("button", null, "Send to the client") }));
    expect(out).toContain("Send to the client");
    expect(out).not.toContain(en.reportSend.sendTitle);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("the draft's text on the report page", () => {
  it("loses its draft mark, in either language and however the model wrote it", () => {
    expect(withoutDraftMark(withDraftMark("One action is verified.", "en"))).toBe("One action is verified.");
    expect(withoutDraftMark(`${DRAFT_MARK.ar}\n\nأُنجز إجراء.`)).toBe("أُنجز إجراء.");
    expect(withoutDraftMark("**Draft — check it before sending.**\nDone.")).toBe("Done.");
    expect(withoutDraftMark("No mark here.")).toBe("No mark here.");
  });
});

describe("the words", () => {
  it("exist in both languages, with the same placeholders", () => {
    const keys = (o: Record<string, string>) => Object.keys(o).sort();
    expect(keys(ar.reportSend)).toEqual(keys(en.reportSend));
    for (const k of keys(en.reportSend)) {
      const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort();
      expect(ph((ar.reportSend as Record<string, string>)[k]!), k).toEqual(ph((en.reportSend as Record<string, string>)[k]!));
    }
  });
});
