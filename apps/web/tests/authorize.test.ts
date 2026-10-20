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
import { ACME, ACME_PROJ_1, ACME_PROJ_2, BETA, BETA_PROJ, FIRM, acmeRecord, betaRecord, principal } from "./fixtures";

const ROLES: Role[] = ["firm_admin", "consultant", "client_admin", "client_manager", "action_owner"];

describe("deny by default", () => {
  it("a permission with no grant for a role denies it", () => {
    const owner = principal("action_owner", [ACME_PROJ_1]);
    expect(authorize(owner, "report.read", acmeRecord("report")).allowed).toBe(false);
    expect(authorize(owner, "organization.read", { ...acmeRecord("organization"), projectId: null }).allowed).toBe(false);
  });

  it("firm staff are denied when the record carries no firm link", () => {
    const lead = principal("firm_admin");
    const r: Resource = { type: "recommendation", orgId: ACME, projectId: ACME_PROJ_1 };
    expect(authorize(lead, "recommendation.read", r)).toEqual({ allowed: false, reason: "org:no-firm-link" });
  });
});

describe("scenario 5: tenant isolation", () => {
  const permissions = Object.keys(POLICY) as Permission[];

  it.each(["client_admin", "client_manager", "action_owner"] as Role[])(
    "%s of Acme gets nothing from Beta, for any permission, even with membership and assignment",
    (role) => {
      const p = principal(role, [BETA_PROJ], ACME);
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

  it("staff of another firm org get nothing", () => {
    const outsider = principal("firm_admin", [], "00000000-0000-4000-8000-00000000ffff");
    expect(authorize(outsider, "recommendation.read", acmeRecord("recommendation")).allowed).toBe(false);
  });
});

describe("scenario 6: project membership", () => {
  it("a client manager in project 1 cannot read project 2 of the same company", () => {
    const manager = principal("client_manager", [ACME_PROJ_1]);
    expect(authorize(manager, "document.read", acmeRecord("document")).allowed).toBe(true);
    expect(authorize(manager, "document.read", acmeRecord("document", { projectId: ACME_PROJ_2 })).allowed).toBe(false);
  });

  it("a consultant sees only projects they are a member of; the firm admin sees all", () => {
    const consultant = principal("consultant", [ACME_PROJ_1]);
    const lead = principal("firm_admin");
    const other = betaRecord("recommendation");
    expect(authorize(consultant, "recommendation.read", acmeRecord("recommendation")).allowed).toBe(true);
    expect(authorize(consultant, "recommendation.read", other).allowed).toBe(false);
    expect(authorize(lead, "recommendation.read", other).allowed).toBe(true);
  });

  it("a client admin sees every project of their own org without membership", () => {
    const admin = principal("client_admin");
    expect(authorize(admin, "project.read", acmeRecord("project", { projectId: ACME_PROJ_2 })).allowed).toBe(true);
  });
});

describe("scenario 7: private labels", () => {
  it("firm-private notes are hidden from every client role", () => {
    const note = acmeRecord("meeting_note", { visibility: "firm_private" });
    for (const role of ["client_admin", "client_manager", "action_owner"] as Role[]) {
      const p = principal(role, [ACME_PROJ_1]);
      expect(authorize(p, "meeting_note.read", { ...note, sharedWith: [p.userId] }).allowed, role).toBe(false);
    }
    expect(authorize(principal("consultant", [ACME_PROJ_1]), "meeting_note.read", note).allowed).toBe(true);
  });

  it("client-private documents are hidden from the firm, including the firm admin", () => {
    const doc = acmeRecord("document", { visibility: "client_private", ownerOrgId: ACME });
    expect(authorize(principal("firm_admin"), "document.read", doc).allowed).toBe(false);
    expect(authorize(principal("consultant", [ACME_PROJ_1]), "document.download", doc).allowed).toBe(false);
    expect(authorize(principal("client_manager", [ACME_PROJ_1]), "document.download", doc).allowed).toBe(true);
  });

  it("user-private records are visible only to their creator", () => {
    const me = principal("consultant", [ACME_PROJ_1]);
    const colleague = principal("consultant", [ACME_PROJ_1]);
    const draft = acmeRecord("report", { visibility: "user_private", createdBy: me.userId });
    expect(authorize(me, "report.read", draft).allowed).toBe(true);
    expect(authorize(colleague, "report.read", draft).allowed).toBe(false);
  });
});

describe("assignment and sharing", () => {
  it("action owners see only actions assigned to them", () => {
    const owner = principal("action_owner", [ACME_PROJ_1]);
    expect(authorize(owner, "action.read", acmeRecord("action", { assignees: [owner.userId] })).allowed).toBe(true);
    expect(authorize(owner, "action.read", acmeRecord("action", { assignees: ["someone-else"] })).allowed).toBe(false);
  });

  it("action owners see documents only when shared with them", () => {
    const owner = principal("action_owner", [ACME_PROJ_1]);
    expect(authorize(owner, "document.download", acmeRecord("document")).allowed).toBe(false);
    expect(authorize(owner, "document.download", acmeRecord("document", { sharedWith: [owner.userId] })).allowed).toBe(true);
  });

  it("only the controlling org may change a document's labels and AI flag", () => {
    const consultant = principal("consultant", [ACME_PROJ_1]);
    const manager = principal("client_manager", [ACME_PROJ_1]);
    const deliverable = acmeRecord("document", { ownerOrgId: FIRM });
    expect(authorize(consultant, "document.manage", deliverable).allowed).toBe(true);
    expect(authorize(manager, "document.manage", deliverable).allowed).toBe(false);
  });
});

describe("scenario 3: workflow, only a consultant verifies", () => {
  const owner = principal("action_owner", [ACME_PROJ_1]);
  const manager = principal("client_manager", [ACME_PROJ_1]);
  const consultant = principal("consultant", [ACME_PROJ_1]);
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
      const p = principal(role, [ACME_PROJ_1]);
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
  const project = acmeRecord("project") as Resource & { type: "project" };

  it("is null for anyone who could not open the project", () => {
    expect(retrievalScope(principal("consultant", [ACME_PROJ_2]), project)).toBeNull();
    expect(retrievalScope(principal("client_manager", [BETA_PROJ], BETA), project)).toBeNull();
  });

  it("is null for client roles until the open decision on client AI access is made", () => {
    for (const role of ["client_admin", "client_manager", "action_owner"] as Role[]) {
      expect(retrievalScope(principal(role, [ACME_PROJ_1]), project), role).toBeNull();
    }
  });

  it("never includes client-private labels for firm staff", () => {
    const scope = retrievalScope(principal("consultant", [ACME_PROJ_1]), project);
    expect(scope).not.toBeNull();
    expect(scope!.projectId).toBe(ACME_PROJ_1);
    expect(scope!.orgId).toBe(ACME);
    expect(scope!.labels).not.toContain("client_private");
  });

  it("always pins the query to one project and one tenant", () => {
    const scope = retrievalScope(principal("firm_admin"), betaRecord("project") as Resource & { type: "project" });
    expect(scope).toMatchObject({ projectId: BETA_PROJ, orgId: BETA });
  });
});

describe("hierarchy: consultants see only clients assigned to them", () => {
  it("an assigned consultant reaches every project of that client without membership", () => {
    const overseer = principal("consultant", [], undefined, [BETA]);
    expect(authorize(overseer, "recommendation.read", betaRecord("recommendation")).allowed).toBe(true);
    expect(authorize(overseer, "organization.read", { ...betaRecord("organization"), projectId: null }).allowed).toBe(true);
  });

  it("an unassigned consultant reaches neither the client nor its projects", () => {
    const other = principal("consultant", [ACME_PROJ_1]);
    expect(authorize(other, "recommendation.read", betaRecord("recommendation")).allowed).toBe(false);
    expect(authorize(other, "organization.read", { ...betaRecord("organization"), projectId: null })).toEqual({
      allowed: false,
      reason: "assignment:client-not-assigned",
    });
  });
});

describe("internal projects", () => {
  const INTERNAL = "00000000-0000-4000-8000-0000000000f1";
  const internal = (type: Resource["type"]): Resource => ({ type, orgId: FIRM, firmOrgId: FIRM, projectId: INTERNAL });

  it("are open to the firm admin and to member consultants", () => {
    expect(authorize(principal("firm_admin"), "recommendation.read", internal("recommendation")).allowed).toBe(true);
    expect(authorize(principal("consultant", [INTERNAL]), "recommendation.read", internal("recommendation")).allowed).toBe(true);
  });

  it("are closed to non-member consultants, even ones assigned to clients", () => {
    expect(authorize(principal("consultant", [], undefined, [ACME, BETA]), "recommendation.read", internal("recommendation")).allowed).toBe(
      false,
    );
  });

  it("are closed to every client role, whatever the membership", () => {
    for (const role of ["client_admin", "client_manager", "action_owner"] as Role[]) {
      const p = principal(role, [INTERNAL]);
      expect(authorize(p, "project.read", internal("project")).allowed, role).toBe(false);
    }
  });
});
