// Small screen faults from the page audit (batch 0), checked by rendering the
// component to HTML with the real messages: the departments switch for
// readers (B4) and the notification count's direction (N12).
import { NextIntlClientProvider } from "next-intl";
import { createElement, type ComponentProps, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import ar from "../messages/ar.json";
import en from "../messages/en.json";
import { DepartmentsSwitch } from "@/components/departments-switch";
import { SlidingCount } from "@/components/sliding-count";
import { typedDir } from "@/lib/utils";

const html = (locale: "ar" | "en", node: ReactNode) => {
  // The provider's props type asks for children; they go in as createElement's third argument.
  const props = { locale, messages: locale === "ar" ? ar : en, timeZone: "Asia/Riyadh" } as unknown as ComponentProps<typeof NextIntlClientProvider>;
  return renderToStaticMarkup(createElement(NextIntlClientProvider, props, node));
};

describe("the departments switch (B4)", () => {
  it("is a switch for an admin, drawn on while departments are on", () => {
    const out = html("ar", createElement(DepartmentsSwitch, { on: true, manage: true }));
    expect(out).toContain('role="switch"');
    expect(out).toContain('aria-checked="true"');
    expect(out).not.toMatch(/\sdisabled(=""|[\s>])/);
  });

  it("is words for a reader who cannot change it, in both languages", () => {
    const on = html("ar", createElement(DepartmentsSwitch, { on: true, manage: false }));
    expect(on).not.toContain('role="switch"');
    expect(on).toContain(`>${ar.engagement.on}<`);
    expect(html("en", createElement(DepartmentsSwitch, { on: true, manage: false }))).toContain(">On<");
    expect(html("en", createElement(DepartmentsSwitch, { on: false, manage: false }))).toContain(">Off<");
  });
});

describe("a text box people type into (page audit 3.8)", () => {
  it("follows the page while empty, so an Arabic box starts on the right, and the text once typed", () => {
    expect(typedDir("")).toBeUndefined();
    expect(typedDir("  \n")).toBeUndefined();
    expect(typedDir("Hello")).toBe("auto");
    expect(typedDir("مرحبا")).toBe("auto");
  });
});

describe("a rolling count (N12)", () => {
  it("lays its digits out left to right on an Arabic page too", () => {
    const out = html("ar", createElement("div", { dir: "rtl" }, createElement(SlidingCount, { number: 17, initiallyStable: true })));
    // The count is a row of one box per digit; without its own direction it follows the page's, and 17 reads 71.
    expect(out).toMatch(/data-slot="sliding-number"[^>]*dir="ltr"|dir="ltr"[^>]*data-slot="sliding-number"/);
    expect(out).toContain(">17<");
  });
});
