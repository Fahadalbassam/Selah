// Who sees an item (decision of 17 Nov 2026, feature A): authorize()'s sixth
// question. The picker can only take people away. For random people, items
// and audiences:
//   - allowed with an audience always implies allowed without it (never widens);
//   - someone left out ("except" and named, "only" and not named) who does not
//     always see the item is refused (it does take people away);
//   - someone who always sees it (locked) gets exactly the answer they had
//     without the audience.
// The first holds trivially without the sixth question; the second fails
// without it, so the property pins both halves of the rule.
import { describe, expect, it } from "vitest";
import { authorize, POLICY, type Permission, type Principal, type Resource, type ResourceAudience, type Role } from "@/authz";
import { ACME, ACME_PROJ_1, ACME_PROJ_2, BETA, BETA_PROJ, FIRM } from "./fixtures";

// A small seeded generator, so a failure can be replayed.
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ROLES: Role[] = ["firm_admin", "consultant", "client_admin", "client_manager", "action_owner"];
const PROJECTS = [ACME_PROJ_1, ACME_PROJ_2, BETA_PROJ];
const DEPTS = ["00000000-0000-4000-8000-0000000000d1", "00000000-0000-4000-8000-0000000000d2"];
const PEOPLE = Array.from({ length: 6 }, (_, i) => `00000000-0000-4000-8000-0000000001${String(i).padStart(2, "0")}`);
// Every permission a document or a meeting resource is checked with.
const PERMISSIONS = (Object.keys(POLICY) as Permission[]).filter((p) => /^(document|meeting|schedule)\./.test(p));

function run(seed: number, samples: number) {
  const r = rng(seed);
  const pick = <T>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)]!;
  const some = <T>(xs: readonly T[]) => xs.filter(() => r() < 0.4);
  let leftOutRefused = 0;
  let lockedChecked = 0;
  for (let i = 0; i < samples; i++) {
    const role = pick(ROLES);
    const firm = role === "firm_admin" || role === "consultant";
    const userId = pick(PEOPLE);
    const p: Principal = {
      userId,
      orgId: firm ? FIRM : pick([ACME, BETA]),
      orgKind: firm ? "firm" : "client",
      role,
      projectIds: new Set(some(PROJECTS)),
      assignedClientIds: new Set(firm ? some([ACME, BETA]) : []),
      leadClientIds: new Set(role === "consultant" ? some([ACME, BETA]) : []),
      leadProjectIds: new Set(),
      departmentIds: new Set(firm ? [] : some(DEPTS)),
      observedProjectIds: new Set(r() < 0.15 ? some(PROJECTS) : []),
      readOnly: !firm && r() < 0.1,
    };
    const projectId = pick(PROJECTS);
    const orgId = projectId === BETA_PROJ ? BETA : ACME;
    const base: Resource = {
      type: pick(["document", "meeting"] as const),
      id: "00000000-0000-4000-8000-000000000999",
      orgId,
      firmOrgId: FIRM,
      projectId,
      projectKind: "client",
      projectState: pick(["active", "active", "closing", "closed"] as const),
      visibility: pick(["shared", "shared", "firm_private", "client_private", "user_private"] as const),
      createdBy: pick([...PEOPLE, null]),
      sharedWith: some(PEOPLE),
      ownerOrgId: pick([FIRM, orgId]),
      departmentId: pick([null, ...DEPTS]),
    };
    const audience: ResourceAudience = { mode: pick(["except", "only"] as const), people: some(PEOPLE), locked: some(PEOPLE) };
    const narrowed = { ...base, audience };
    const named = audience.people.includes(userId);
    const locked = audience.locked.includes(userId);
    const leftOut = !locked && (audience.mode === "except" ? named : !named);
    for (const perm of PERMISSIONS) {
      const without = authorize(p, perm, base).allowed;
      const withIt = authorize(p, perm, narrowed).allowed;
      const where = `seed ${seed} sample ${i} ${perm} ${role} ${audience.mode}`;
      // Never widens.
      if (withIt) expect(without, where).toBe(true);
      // Takes people away.
      if (leftOut) {
        expect(withIt, where).toBe(false);
        if (without) leftOutRefused++;
      } else {
        // Not left out (locked, or let in by the list): exactly the answer the other rules give.
        expect(withIt, where).toBe(without);
        if (locked) lockedChecked++;
      }
    }
  }
  return { leftOutRefused, lockedChecked };
}

describe("authorize(): who sees an item never widens access", () => {
  it.each([1, 7, 42, 2026, 1117])("random people, items and audiences (seed %i)", (seed) => {
    const { leftOutRefused, lockedChecked } = run(seed, 400);
    // The samples did reach both halves: people the other rules let in and the audience took away,
    // and people who always see the item.
    expect(leftOutRefused).toBeGreaterThan(0);
    expect(lockedChecked).toBeGreaterThan(0);
  });

  it("a denial reads like any other (the route answers Not found)", () => {
    const p: Principal = {
      userId: PEOPLE[0]!,
      orgId: ACME,
      orgKind: "client",
      role: "client_manager",
      projectIds: new Set([ACME_PROJ_1]),
      assignedClientIds: new Set(),
      leadClientIds: new Set(),
      leadProjectIds: new Set(),
      departmentIds: new Set(),
    };
    const file: Resource = { type: "document", orgId: ACME, firmOrgId: FIRM, projectId: ACME_PROJ_1, visibility: "shared" };
    expect(authorize(p, "document.read", file).allowed).toBe(true);
    expect(authorize(p, "document.read", { ...file, audience: { mode: "except", people: [p.userId], locked: [] } })).toEqual({
      allowed: false,
      reason: "audience:left-out",
    });
    expect(authorize(p, "document.read", { ...file, audience: { mode: "only", people: [PEOPLE[1]!], locked: [] } })).toEqual({
      allowed: false,
      reason: "audience:not-listed",
    });
    // Always sees it: the list does not matter.
    expect(authorize(p, "document.read", { ...file, audience: { mode: "only", people: [], locked: [p.userId] } }).allowed).toBe(true);
  });

  it("the picker is for firm staff on the firm's items and the client's admin on the client's own, never managers or owners", () => {
    const mk = (role: Role, orgId: string): Principal => ({
      userId: PEOPLE[2]!,
      orgId,
      orgKind: role === "firm_admin" || role === "consultant" ? "firm" : "client",
      role,
      projectIds: new Set([ACME_PROJ_1]),
      assignedClientIds: new Set([ACME]),
      leadClientIds: new Set(),
      leadProjectIds: new Set(),
      departmentIds: new Set(),
    });
    const firmFile: Resource = { type: "document", orgId: ACME, firmOrgId: FIRM, projectId: ACME_PROJ_1, visibility: "shared", ownerOrgId: FIRM };
    const clientFile: Resource = { ...firmFile, ownerOrgId: ACME };
    for (const kind of ["document.audience", "meeting.audience"] as const) {
      const firmItem = { ...firmFile, type: kind === "document.audience" ? ("document" as const) : ("meeting" as const) };
      const clientItem = { ...clientFile, type: firmItem.type };
      expect(authorize(mk("consultant", FIRM), kind, firmItem).allowed, kind).toBe(true);
      expect(authorize(mk("firm_admin", FIRM), kind, firmItem).allowed, kind).toBe(true);
      expect(authorize(mk("consultant", FIRM), kind, clientItem).allowed, kind).toBe(false);
      expect(authorize(mk("client_admin", ACME), kind, clientItem).allowed, kind).toBe(true);
      expect(authorize(mk("client_admin", ACME), kind, firmItem).allowed, kind).toBe(false);
      expect(authorize(mk("client_manager", ACME), kind, clientItem).allowed, kind).toBe(false);
      expect(authorize(mk("action_owner", ACME), kind, clientItem).allowed, kind).toBe(false);
      // An observer changes nothing.
      expect(authorize({ ...mk("consultant", FIRM), observedProjectIds: new Set([ACME_PROJ_1]) }, kind, firmItem).allowed, kind).toBe(false);
    }
  });
});
