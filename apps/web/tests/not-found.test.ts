// The "Not found" page (screen re-check of batch 0, fault 1). A notFound()
// inside the signed-in app is drawn inside the app shell, whose top bar
// already has the language switch, so that page draws none of its own; the
// signed-out one (an unknown address, a dead link) has no top bar and keeps
// its corner switch.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NextIntlClientProvider } from "next-intl";
import { createElement, type ComponentProps, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import ar from "../messages/ar.json";
import en from "../messages/en.json";
import AppNotFound from "@/app/(app)/not-found";

const html = (locale: "ar" | "en", node: ReactNode) => {
  const props = { locale, messages: locale === "ar" ? ar : en, timeZone: "Asia/Riyadh" } as unknown as ComponentProps<typeof NextIntlClientProvider>;
  return renderToStaticMarkup(createElement(NextIntlClientProvider, props, node));
};

describe("Not found inside the app", () => {
  it("says so and offers the way back, with no language switch of its own (the top bar has one)", () => {
    for (const locale of ["ar", "en"] as const) {
      const m = locale === "ar" ? ar : en;
      const out = html(locale, createElement(AppNotFound));
      expect(out).toContain(`>${m.notFound.title}<`);
      expect(out).toContain(m.notFound.back);
      // The switch's label names the other language ("English" / "العربية").
      expect(out).not.toContain(m.header.language);
      expect(out).not.toContain(m.header.switchLanguage);
    }
  });
});

describe("Not found for someone signed out", () => {
  it("keeps the corner language switch: the root page has no top bar", () => {
    const root = readFileSync(join(__dirname, "../src/app/not-found.tsx"), "utf8");
    expect(root).toMatch(/<CornerLocaleToggle\s*\/>/);
    const app = readFileSync(join(__dirname, "../src/app/(app)/not-found.tsx"), "utf8");
    expect(app).not.toMatch(/CornerLocaleToggle|LocaleToggle/);
  });
});
