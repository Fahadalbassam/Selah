// Recording for a client the firm runs, from the action page (follow-up to
// page audit N24): the progress-note form and the file dialogs ask how and
// when the client sent it, send both, and say so when the server still finds
// something missing. Before, they sent neither and the server refused every
// note and file the consultant recorded.
import { NextIntlClientProvider } from "next-intl";
import { createElement, type ComponentProps, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import ar from "../messages/ar.json";
import en from "../messages/en.json";
import { send, UpdateForm } from "@/app/(app)/actions/[id]/action-panel";
import { firmToday } from "@/lib/dates";
import { receivedPayload } from "@/lib/engagement";

const html = (locale: "ar" | "en", node: ReactNode) => {
  const props = { locale, messages: locale === "ar" ? ar : en, timeZone: "Asia/Riyadh" } as unknown as ComponentProps<typeof NextIntlClientProvider>;
  return renderToStaticMarkup(createElement(NextIntlClientProvider, props, node));
};

afterEach(() => vi.unstubAllGlobals());

describe("the progress-note form on a client the firm runs", () => {
  it("asks how and when the client sent it, the day defaulting to the firm's today", () => {
    const out = html("ar", createElement(UpdateForm, { actionId: "a", onDone: () => undefined, recordFor: true }));
    expect(out).toContain(ar.action.recordFor.via);
    expect(out).toContain(ar.action.recordFor.on);
    expect(out).toMatch(new RegExp(`name="receivedOn"[^>]*value="${firmToday()}"|value="${firmToday()}"[^>]*name="receivedOn"`));
  });

  it("asks nothing of the kind anywhere else", () => {
    const out = html("ar", createElement(UpdateForm, { actionId: "a", onDone: () => undefined }));
    expect(out).not.toContain(ar.action.recordFor.via);
    expect(out).not.toContain('name="receivedOn"');
  });
});

describe("what a note or a file sends", () => {
  it("carries the way and the day on a client the firm runs, and nothing elsewhere", () => {
    expect(receivedPayload(true, "email", "2026-11-12")).toEqual({ receivedVia: "email", receivedOn: "2026-11-12" });
    // Left out when missing, so the server names what is missing.
    expect(receivedPayload(true, "", "2026-11-12")).toEqual({ receivedOn: "2026-11-12" });
    expect(receivedPayload(false, "email", "2026-11-12")).toEqual({});
  });
});

describe("the server's refusal, shown in the dialog", () => {
  const refuse = (status: number, message: string) =>
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ error: status === 400 ? "bad_request" : "conflict", message }), { status }));

  it("says what is missing rather than 'something went wrong'", async () => {
    refuse(400, "say how and when the client told you (receivedVia, receivedOn)");
    expect(await send("/api/actions/a/updates", { method: "POST" })).toEqual({ ok: false, error: "received" });
    refuse(409, "received_on cannot be in the future");
    expect(await send("/api/actions/a/evidence", { method: "POST" })).toEqual({ ok: false, error: "receivedFuture" });
    for (const key of ["received", "receivedFuture"] as const) {
      expect(ar.action.errors[key]).toBeTruthy();
      expect(en.action.errors[key]).toBeTruthy();
    }
  });
});
