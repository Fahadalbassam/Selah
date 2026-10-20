import { describe, expect, it } from "vitest";
import {
  authorize,
  canTransition,
  POLICY,
  retrievalScope,
  type Permission,
  type Resource,
  type Role,
} from "@/authz";
import { ACME, ACME_ENG_1, ACME_ENG_2, BETA, BETA_ENG, MAAYISH, acmeRecord, betaRecord, principal } from "./fixtures";

const ROLES: Role[] = ["maayish_lead", "consultant", "client_admin", "client_manager", "action_owner"];

describe("deny by default", () => {
  it("a permission with no grant for a role denies it", () => {
    const owner = principal("action_owner", [ACME_ENG_1]);
    expect(authorize(owner, "report.read", acmeRecord("report")).allowed).toBe(false);
    expect(authorize(owner, "organization.read", { ...acmeRecord("organization"), engagementId: null }).allowed).toBe(false);
  });

  it("Maayish staff are denied when the record carries no Maayish link", () => {
    const lead = principal("maayish_lead");
    const r: Resource = { type: "recommendation", clientOrgId: ACME, engagementId: ACME_ENG_1 };
    expect(authorize(lead, "recommendation.read", r)).toEqual({ allowed: false, reason: "org:no-maayish-link" });
  });
});

describe("scenario 5: tenant isolation", () => {
  const permissions = Object.keys(POLICY) as Permission[];

  it.each(["client_admin", "client_manager", "action_owner"] as Role[])(
    "%s of Acme gets nothing from Beta, for any permission, even with membership and assignment",
    (role) => {
      const p = principal(role, [BETA_ENG], ACME);
      const beta = betaRecord("document", {
        assignees: [p.userId],
        sharedWith: [p.userId],
        createdBy: p.userId,
        ownerOrgId: ACME,
      });
      for (const perm of permissions) {
        expect(authorize(p, perm, beta).allowed, perm).toBe(false);
      }
    },
  );

  it("staff of another Maayish org get nothing", () => {
    const outsider = principal("maayish_lead", [], "00000000-0000-4000-8000-00000000ffff");
    expect(authorize(outsider, "recommendation.read", acmeRecord("recommendation")).allowed).toBe(false);
  });
});

describe("scenario 6: engagement membership", () => {
  it("a client manager in engagement 1 cannot read engagement 2 of the same company", () => {
    const manager = principal("client_manager", [ACME_ENG_1]);
    expect(authorize(manager, "document.read", acmeRecord("document")).allowed).toBe(true);
    expect(authorize(manager, "document.read", acmeRecord("document", { engagementId: ACME_ENG_2 })).allowed).toBe(false);
  });

  it("a consultant sees only engagements they are a member of; the lead sees all", () => {
    const consultant = principal("consultant", [ACME_ENG_1]);
    const lead = principal("maayish_lead");
    const other = betaRecord("recommendation");
    expect(authorize(consultant, "recommendation.read", acmeRecord("recommendation")).allowed).toBe(true);
    expect(authorize(consultant, "recommendation.read", other).allowed).toBe(false);
    expect(authorize(lead, "recommendation.read", other).allowed).toBe(true);
  });

  it("a client admin sees every engagement of their own org without membership", () => {
    const admin = principal("client_admin");
    expect(authorize(admin, "engagement.read", acmeRecord("engagement", { engagementId: ACME_ENG_2 })).allowed).toBe(true);
  });
});

describe("scenario 7: private labels", () => {
  it("Maayish-private notes are hidden from every client role", () => {
    const note = acmeRecord("meeting_note", { visibility: "maayish_private" });
    for (const role of ["client_admin", "client_manager", "action_owner"] as Role[]) {
      const p = principal(role, [ACME_ENG_1]);
      expect(authorize(p, "meeting_note.read", { ...note, sharedWith: [p.userId] }).allowed, role).toBe(false);
    }
    expect(authorize(principal("consultant", [ACME_ENG_1]), "meeting_note.read", note).allowed).toBe(true);
  });

  it("client-private documents are hidden from Maayish, including the lead", () => {
    const doc = acmeRecord("document", { visibility: "client_private", ownerOrgId: ACME });
    expect(authorize(principal("maayish_lead"), "document.read", doc).allowed).toBe(false);
    expect(authorize(principal("consultant", [ACME_ENG_1]), "document.download", doc).allowed).toBe(false);
    expect(authorize(principal("client_manager", [ACME_ENG_1]), "document.download", doc).allowed).toBe(true);
  });

  it("user-private records are visible only to their creator", () => {
    const me = principal("consultant", [ACME_ENG_1]);
    const colleague = principal("consultant", [ACME_ENG_1]);
    const draft = acmeRecord("report", { visibility: "user_private", createdBy: me.userId });
    expect(authorize(me, "report.read", draft).allowed).toBe(true);
    expect(authorize(colleague, "report.read", draft).allowed).toBe(false);
  });
});

describe("assignment and sharing", () => {
  it("action owners see only actions assigned to them", () => {
    const owner = principal("action_owner", [ACME_ENG_1]);
    expect(authorize(owner, "action.read", acmeRecord("action", { assignees: [owner.userId] })).allowed).toBe(true);
    expect(authorize(owner, "action.read", acmeRecord("action", { assignees: ["someone-else"] })).allowed).toBe(false);
  });

  it("action owners see documents only when shared with them", () => {
    const owner = principal("action_owner", [ACME_ENG_1]);
    expect(authorize(owner, "document.download", acmeRecord("document")).allowed).toBe(false);
    expect(authorize(owner, "document.download", acmeRecord("document", { sharedWith: [owner.userId] })).allowed).toBe(true);
  });

  it("only the controlling org may change a document's labels and AI flag", () => {
    const consultant = principal("consultant", [ACME_ENG_1]);
    const manager = principal("client_manager", [ACME_ENG_1]);
    const deliverable = acmeRecord("document", { ownerOrgId: MAAYISH });
    expect(authorize(consultant, "document.manage", deliverable).allowed).toBe(true);
    expect(authorize(manager, "document.manage", deliverable).allowed).toBe(false);
  });
});

describe("scenario 3: workflow, only a consultant verifies", () => {
  const owner = principal("action_owner", [ACME_ENG_1]);
  const manager = principal("client_manager", [ACME_ENG_1]);
  const consultant = principal("consultant", [ACME_ENG_1]);
  const action = acmeRecord("action", { assignees: [owner.userId] }) as Resource & { type: "action" };

  it("the owner walks the action to Awaiting Review", () => {
    expect(canTransition(owner, action, "assigned", "in_progress").allowed).toBe(true);
    expect(canTransition(owner, action, "in_progress", "blocked").allowed).toBe(true);
    expect(canTransition(owner, action, "blocked", "in_progress").allowed).toBe(true);
    expect(canTransition(owner, action, "in_progress", "awaiting_review").allowed).toBe(true);
    expect(canTransition(owner, action, "revision_requested", "in_progress").allowed).toBe(true);
  });

  it("no client role can leave Awaiting Review", () => {
    for (const p of [owner, manager, principal("client_admin")]) {
      expect(canTransition(p, action, "awaiting_review", "verified_complete").allowed).toBe(false);
      expect(canTransition(p, action, "awaiting_review", "revision_requested").allowed).toBe(false);
    }
  });

  it("a consultant accepts or requests a revision, but does not do the client's work", () => {
    expect(canTransition(consultant, action, "awaiting_review", "verified_complete").allowed).toBe(true);
    expect(canTransition(consultant, action, "awaiting_review", "revision_requested").allowed).toBe(true);
    expect(canTransition(consultant, action, "in_progress", "awaiting_review").allowed).toBe(false);
  });

  it("moves that are not in the diagram are refused for everyone", () => {
    for (const role of ROLES) {
      const p = principal(role, [ACME_ENG_1]);
      expect(canTransition(p, action, "in_progress", "verified_complete").allowed, role).toBe(false);
      expect(canTransition(p, action, "draft", "verified_complete").allowed, role).toBe(false);
      expect(canTransition(p, action, "verified_complete", "in_progress").allowed, role).toBe(false);
    }
  });

  it("an owner cannot move someone else's action", () => {
    const other = acmeRecord("action", { assignees: ["someone-else"] }) as Resource & { type: "action" };
    expect(canTransition(owner, other, "assigned", "in_progress").allowed).toBe(false);
    expect(canTransition(manager, other, "assigned", "in_progress").allowed).toBe(true);
  });
});

describe("AI retrieval scope (scenarios 5, 7, 8)", () => {
  const engagement = acmeRecord("engagement") as Resource & { type: "engagement" };

  it("is null for anyone who could not open the engagement", () => {
    expect(retrievalScope(principal("consultant", [ACME_ENG_2]), engagement)).toBeNull();
    expect(retrievalScope(principal("client_manager", [BETA_ENG], BETA), engagement)).toBeNull();
  });

  it("is null for client roles until the open decision on client AI access is made", () => {
    for (const role of ["client_admin", "client_manager", "action_owner"] as Role[]) {
      expect(retrievalScope(principal(role, [ACME_ENG_1]), engagement), role).toBeNull();
    }
  });

  it("never includes client-private labels for Maayish staff", () => {
    const scope = retrievalScope(principal("consultant", [ACME_ENG_1]), engagement);
    expect(scope).not.toBeNull();
    expect(scope!.engagementId).toBe(ACME_ENG_1);
    expect(scope!.clientOrgId).toBe(ACME);
    expect(scope!.labels).not.toContain("client_private");
  });

  it("always pins the query to one engagement and one tenant", () => {
    const scope = retrievalScope(principal("maayish_lead"), betaRecord("engagement") as Resource & { type: "engagement" });
    expect(scope).toMatchObject({ engagementId: BETA_ENG, clientOrgId: BETA });
  });
});
