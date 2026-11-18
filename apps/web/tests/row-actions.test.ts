// Dense rows (page audit U15, batch 1): one main button per row, the rest in
// a row menu (⋯). The menu is built only from what the server allows, so
// moving a button into it never offers it to someone new and never takes it
// from someone who had it.
import { readFileSync } from "node:fs";
import { NextIntlClientProvider } from "next-intl";
import { createElement, type ComponentProps, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import ar from "../messages/ar.json";
import en from "../messages/en.json";
import { RowMenu } from "@/components/row-menu";
import {
  DEPARTMENT_CARD,
  departmentCardPlan,
  MEMBER_ROW,
  memberRowPlan,
  REQUEST_ROW,
  requestRowPlan,
  rowPlan,
  RULE_ACTION_ROW,
  ruleActionRowPlan,
  TEAM_ROW,
  teamRowPlan,
  VALUE_ROW,
  valueRowPlan,
} from "@/lib/row-actions";

const html = (locale: "ar" | "en", node: ReactNode) => {
  const props = { locale, messages: locale === "ar" ? ar : en, timeZone: "Asia/Riyadh" } as unknown as ComponentProps<typeof NextIntlClientProvider>;
  return renderToStaticMarkup(createElement(NextIntlClientProvider, props, node));
};

/** Every combination of true and false for these keys. */
function combinations<K extends string>(keys: readonly K[]): Record<K, boolean>[] {
  return Array.from({ length: 2 ** keys.length }, (_, n) => Object.fromEntries(keys.map((k, i) => [k, Boolean(n & (1 << i))])) as Record<K, boolean>);
}

/** The main button and the menu together hold exactly the allowed items, each once. */
function holdsExactlyTheAllowed<K extends string>(can: Record<K, boolean>, plan: { main: K | null; menu: K[] }) {
  const shown = [...(plan.main ? [plan.main] : []), ...plan.menu];
  expect(new Set(shown).size, JSON.stringify(can)).toBe(shown.length);
  expect(shown.sort(), JSON.stringify(can)).toEqual(
    (Object.keys(can) as K[]).filter((k) => can[k]).sort(),
  );
}

describe("a row's main button and its menu", () => {
  it("offer only what is allowed, and everything that is", () => {
    const keys = ["a", "b", "c"] as const;
    for (const can of combinations(keys)) holdsExactlyTheAllowed(can, rowPlan(can, { main: ["a", "b"], menu: ["a", "b", "c"] }));
  });

  it("make the first allowed of the main choices the one button", () => {
    expect(rowPlan({ a: true, b: true, c: true }, { main: ["a", "b"], menu: ["a", "b", "c"] })).toEqual({ main: "a", menu: ["b", "c"] });
    expect(rowPlan({ a: false, b: true, c: true }, { main: ["a", "b"], menu: ["a", "b", "c"] })).toEqual({ main: "b", menu: ["c"] });
    expect(rowPlan({ a: false, b: false, c: true }, { main: ["a", "b"], menu: ["a", "b", "c"] })).toEqual({ main: null, menu: ["c"] });
  });
});

describe("a document request row", () => {
  const keys = ["answer", "notApplicable", "review", "returnIt", "reopen", "edit", "remove", "sendLink", "revokeLink"] as const;

  it("keeps each item's permission: the menu holds exactly what the server allows", () => {
    for (const can of combinations(keys)) holdsExactlyTheAllowed(can, requestRowPlan(can));
  });

  it("has one main button: accepting the file for the firm, sending one for the client", () => {
    const none = Object.fromEntries(keys.map((k) => [k, false])) as Record<(typeof keys)[number], boolean>;
    expect(requestRowPlan({ ...none, review: true, answer: true, returnIt: true, edit: true }).main).toBe("review");
    expect(requestRowPlan({ ...none, answer: true, notApplicable: true }).main).toBe("answer");
    expect(requestRowPlan({ ...none, answer: true, notApplicable: true }).menu).toEqual(["notApplicable"]);
    expect(requestRowPlan({ ...none, edit: true, remove: true, sendLink: true }).main).toBeNull();
  });

  it("lists every item the row offered before, in the menu or as its button", () => {
    expect(new Set([...REQUEST_ROW.main, ...REQUEST_ROW.menu])).toEqual(new Set(keys));
  });
});

describe("a department card and its members", () => {
  it("keeps each item's permission", () => {
    for (const can of combinations(["addPerson", "rename", "moveWork", "switchOff", "switchOn"] as const)) holdsExactlyTheAllowed(can, departmentCardPlan(can));
    for (const can of combinations(["makeHead", "notHead", "remove"] as const)) holdsExactlyTheAllowed(can, memberRowPlan(can));
  });

  it("shows adding a person as the card's one button; the rest are in menus", () => {
    expect(departmentCardPlan({ addPerson: true, rename: true, moveWork: true, switchOff: true, switchOn: false })).toEqual({
      main: "addPerson",
      menu: ["rename", "moveWork", "switchOff"],
    });
    expect(memberRowPlan({ makeHead: true, notHead: false, remove: true }).main).toBeNull();
    expect(new Set([...DEPARTMENT_CARD.main, ...DEPARTMENT_CARD.menu]).size).toBe(5);
    expect(MEMBER_ROW.main).toEqual([]);
  });
});

describe("an indicator value row", () => {
  it("keeps each item's permission", () => {
    for (const can of combinations(["check", "correct"] as const)) holdsExactlyTheAllowed(can, valueRowPlan(can));
  });

  it("shows no button of its own: marking a value checked and correcting it are both in the menu", () => {
    expect(valueRowPlan({ check: true, correct: true })).toEqual({ main: null, menu: ["check", "correct"] });
    expect(valueRowPlan({ check: false, correct: true })).toEqual({ main: null, menu: ["correct"] });
    expect(VALUE_ROW.main).toEqual([]);
  });
});

describe("a consultant row on the firm's client page", () => {
  it("keeps each item's permission", () => {
    for (const can of combinations(["makeLead", "makeDeputy", "removeDeputy", "remove"] as const)) holdsExactlyTheAllowed(can, teamRowPlan(can));
  });

  it("has no visible button: lead, deputy and removal are all in the menu", () => {
    expect(TEAM_ROW.main).toEqual([]);
    expect(teamRowPlan({ makeLead: true, makeDeputy: true, removeDeputy: false, remove: true })).toEqual({
      main: null,
      menu: ["makeLead", "makeDeputy", "remove"],
    });
  });
});

describe("an action on a rule list of the Actions page", () => {
  it("shows no button of its own: reminding the owner is in the menu, only when the server allows it", () => {
    expect(RULE_ACTION_ROW.main).toEqual([]);
    expect(ruleActionRowPlan({ remind: true })).toEqual({ main: null, menu: ["remind"] });
    expect(ruleActionRowPlan({ remind: false })).toEqual({ main: null, menu: [] });
  });
});

describe("the screens draw their rows from these plans", () => {
  // The server's own flags go in; nothing on the screen decides on its own.
  const read = (p: string) => readFileSync(p, "utf8");
  it("on requests, departments, indicator values and the client's team", () => {
    expect(read("src/app/(app)/projects/[id]/info-requests-tab.tsx")).toContain("requestRowPlan(i.can)");
    expect(read("src/components/departments-manager.tsx")).toMatch(/departmentCardPlan\(/);
    expect(read("src/components/departments-manager.tsx")).toMatch(/memberRowPlan\(/);
    expect(read("src/components/indicators/value-row-actions.tsx")).toMatch(/valueRowPlan\(/);
    expect(read("src/components/client-team-row.tsx")).toMatch(/teamRowPlan\(/);
    expect(read("src/components/action-board-table.tsx")).toMatch(/ruleActionRowPlan\(/);
  });
});

describe("the row menu itself", () => {
  const item = (key: string, allowed: boolean) => ({ key, label: key, allowed, onSelect: () => undefined });

  it("draws nothing when nothing in it is allowed", () => {
    expect(html("ar", createElement(RowMenu, { label: "x", items: [item("edit", false), item("remove", false)] }))).toBe("");
  });

  it("is one button that names what it is for, in the reader's language, and opens a menu", () => {
    for (const locale of ["ar", "en"] as const) {
      const label = (locale === "ar" ? ar : en).common.moreFor.replace("{name}", "Board charter");
      const out = html(locale, createElement(RowMenu, { label, items: [item("edit", true), item("remove", false)] }));
      expect(out.match(/<button/g)).toHaveLength(1);
      expect(out).toContain(`aria-label="${label}"`);
      expect(out).toContain('aria-haspopup="menu"');
    }
  });
});
