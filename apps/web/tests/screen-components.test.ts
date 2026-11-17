// Small screen faults from the page audit (batch 0), checked by rendering the
// component to HTML with the real messages: the departments switch for
// readers (B4).
import { NextIntlClientProvider } from "next-intl";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import ar from "../messages/ar.json";
import en from "../messages/en.json";
import { DepartmentsSwitch } from "@/components/departments-switch";

const html = (locale: "ar" | "en", node: ReactNode) =>
  renderToStaticMarkup(createElement(NextIntlClientProvider, { locale, messages: locale === "ar" ? ar : en, timeZone: "Asia/Riyadh" }, node));

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
