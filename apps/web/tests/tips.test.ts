// Phase 2, part A (big prompt 6.1): tooltips and in-app hints. Every tooltip
// is one short sentence in both languages, Arabic written for itself; status
// badges say the exact state behind the word; a tooltip opens on keyboard
// focus as well as hover; icon-only buttons are never left with a mouse-only
// title.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { NextIntlClientProvider } from "next-intl";
import { createElement, type ComponentProps, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import ar from "../messages/ar.json";
import en from "../messages/en.json";
import { Hint, ICON_TIPS } from "@/components/hint";
import { ROLE_TIPS } from "@/components/role-tip";
import { StatusBadge } from "@/components/status-badge";
import { VisibilityBadge } from "@/components/visibility-badge";
import { allStatusTipKeys, statusTipKey, ACTION_STATES, type Reader } from "@/lib/status-words";

type Tree = { [k: string]: string | Tree };
const at = (m: unknown, path: string): unknown => path.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], m);
const leaves = (t: Tree, p = ""): string[] => Object.entries(t).flatMap(([k, v]) => (typeof v === "string" ? [p + k] : leaves(v, `${p}${k}.`)));
const arabic = /[؀-ۿ]/;
// Hint with its children given as createElement's third argument.
const HintEl = Hint as unknown as (p: { tip: string; asChild?: boolean }) => ReactNode;

const html = (locale: "ar" | "en", node: ReactNode) => {
  const props = { locale, messages: locale === "ar" ? ar : en, timeZone: "Asia/Riyadh" } as unknown as ComponentProps<typeof NextIntlClientProvider>;
  return renderToStaticMarkup(createElement(NextIntlClientProvider, props, node));
};

describe("every tooltip, in both languages", () => {
  const tips = (m: unknown) => at(m, "tips") as Tree;

  it("has the same keys in Arabic and English", () => {
    expect(tips(ar)).toBeTruthy();
    expect(leaves(tips(ar)).sort()).toEqual(leaves(tips(en)).sort());
  });

  it("is one short sentence, the Arabic in Arabic and not the English copied", () => {
    for (const k of leaves(tips(en))) {
      const a = at(ar, `tips.${k}`) as string;
      const e = at(en, `tips.${k}`) as string;
      for (const s of [a, e]) {
        expect(s.trim().length, k).toBeGreaterThan(10);
        expect(s.length, k).toBeLessThanOrEqual(140);
        expect(s, k).toMatch(/[.؟?]$/);
        // One sentence: no full stop before its end.
        expect(s.slice(0, -1), k).not.toMatch(/[.؟?]\s/);
      }
      expect(a, k).toMatch(arabic);
      expect(e, k).not.toMatch(arabic);
    }
  });

  it("has a sentence for every stored state a status badge can draw, for each side that reads it", () => {
    const keys = allStatusTipKeys();
    expect(keys.length).toBeGreaterThan(50);
    for (const k of keys) {
      expect(at(ar, `tips.${k}`), k).toEqual(expect.any(String));
      expect(at(en, `tips.${k}`), k).toEqual(expect.any(String));
    }
  });

  it("names the exact state behind the word, so a tooltip is never the word again", () => {
    for (const s of ACTION_STATES.filter((x) => !["closed", "draft"].includes(x))) {
      for (const r of ["firm", "client"] as Reader[]) {
        const tip = at(en, `tips.${statusTipKey("action", s, r)}`) as string;
        expect(tip.startsWith(`${(en.status as Record<string, string>)[s]}:`), `${s} ${r}`).toBe(true);
        const tipAr = at(ar, `tips.${statusTipKey("action", s, r)}`) as string;
        expect(tipAr.startsWith(`${(ar.status as Record<string, string>)[s]}:`), `${s} ${r} ar`).toBe(true);
      }
    }
  });

  it("speaks to the client as 'your company', never about 'the client', on the client's side", () => {
    for (const k of allStatusTipKeys().filter((k) => k.endsWith(".client"))) {
      expect(at(en, `tips.${k}`) as string, k).not.toMatch(/\bthe client\b/i);
      expect(at(ar, `tips.${k}`) as string, k).not.toContain("العميل");
    }
  });

  it("covers the rest of the list in 6.1: roles, visibility, the assistant, second sign-off, closing, data modes, icon buttons", () => {
    const need = [
      ...ROLE_TIPS.map((r) => `roles.${r}`),
      ...["shared", "firm_private", "client_private", "user_private"].map((v) => `visibility.${v}`),
      "assistant.on",
      "assistant.off",
      "secondReview.signOff",
      "secondReview.verify",
      "status.outcome.risk_accepted.firm",
      "status.outcome.risk_accepted.client",
      "closing.start",
      "closing.cancel",
      "closing.close",
      ...["handed_over", "deferred", "withdrawn", "waived"].map((d) => `closing.dispositions.${d}`),
      ...["typed", "files", "connected"].map((m) => `dataMode.${m}`),
      ...ICON_TIPS.map((i) => `icons.${i}`),
    ];
    for (const k of need) {
      expect(at(ar, `tips.${k}`), k).toEqual(expect.any(String));
      expect(at(en, `tips.${k}`), k).toEqual(expect.any(String));
    }
  });
});

describe("a tooltip opens on keyboard focus as well as hover", () => {
  // Radix opens a tooltip when its trigger takes the focus; what can be
  // checked without a browser is that the trigger is the focusable element.
  it("wraps a badge in a focusable trigger", () => {
    const out = html("en", createElement(HintEl, { tip: "What it means." }, createElement("span", null, "Word")));
    // One element: focusable, and the tooltip's trigger (Radix marks its trigger with data-state).
    expect(out).toMatch(/<span(?=[^>]*tabindex="0")(?=[^>]*data-state="closed")(?=[^>]*data-slot="hint")[^>]*>/);
  });

  it("makes a button its own trigger, with no second tab stop", () => {
    const out = html("en", createElement(HintEl, { tip: "What it does.", asChild: true }, createElement("button", { type: "button", "aria-label": "More" }, "⋯")));
    expect(out).toMatch(/<button[^>]*data-state="closed"/);
    expect(out).not.toContain('tabindex="0"');
  });

  it("draws an action's word and a visibility label as focusable triggers, right to left too", () => {
    const word = html("ar", createElement(StatusBadge, { status: "revision_requested", reader: "client" }));
    expect(word).toContain('tabindex="0"');
    expect(word).toContain("بانتظاركم");
    const vis = html("ar", createElement(VisibilityBadge, { visibility: "firm_private", label: "خاص بالمكتب" }));
    expect(vis).toContain('tabindex="0"');
  });
});

describe("icon-only buttons", () => {
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((f) => {
      const p = join(dir, f);
      return statSync(p).isDirectory() ? files(p) : p.endsWith(".tsx") ? [p] : [];
    });

  it("never rely on a mouse-only title: each has a tooltip the keyboard opens", () => {
    const offenders: string[] = [];
    for (const f of files(join(__dirname, "../src")).filter((f) => !f.includes(`${join("components", "ui")}`))) {
      const src = readFileSync(f, "utf8");
      for (const m of src.matchAll(/<Button\b[^>]*?size="icon[^"]*"[^>]*?>/gs)) {
        if (/\stitle=\{/.test(m[0])) offenders.push(f);
      }
    }
    expect(offenders).toEqual([]);
  });
});
