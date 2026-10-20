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
      expect(canTransition(p, action, "verified_complete", "awaiting_review").allowed, role).toBe(false);
      expect(canTransition(p, action, "draft", "closed").allowed, role).toBe(false);
      expect(canTransition(p, action, "closed", "verified_complete").allowed, role).toBe(false);
    }
  });

  it("only the firm closes an open action or reopens a finished one", () => {
    const lead = principal("firm_admin");
    for (const p of [consultant, lead]) {
      expect(canTransition(p, action, "in_progress", "closed").allowed).toBe(true);
      expect(canTransition(p, action, "awaiting_review", "closed").allowed).toBe(true);
      expect(canTransition(p, action, "closed", "in_progress").allowed).toBe(true);
      expect(canTransition(p, action, "verified_complete", "in_progress").allowed).toBe(true);
    }
    for (const p of [owner, manager, principal("client_admin")]) {
      expect(canTransition(p, action, "in_progress", "closed").allowed).toBe(false);
      expect(canTransition(p, action, "closed", "in_progress").allowed).toBe(false);
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
  it("a consultant on a client's team sees the client, but only the projects they are staffed on", () => {
    const member = principal("consultant", [], undefined, [BETA]);
    expect(authorize(member, "organization.read", { ...betaRecord("organization"), projectId: null }).allowed).toBe(true);
    expect(authorize(member, "recommendation.read", betaRecord("recommendation"))).toEqual({
      allowed: false,
      reason: "membership:not-member",
    });
    const staffed = principal("consultant", [BETA_PROJ], undefined, [BETA]);
    expect(authorize(staffed, "recommendation.read", betaRecord("recommendation")).allowed).toBe(true);
  });

  it("the client's lead sees every project of that client without being staffed", () => {
    const lead = principal("consultant", [], undefined, [], { clients: [BETA] });
    expect(authorize(lead, "recommendation.read", betaRecord("recommendation")).allowed).toBe(true);
    expect(authorize(lead, "project.manage_members", betaRecord("project")).allowed).toBe(true);
  });

  it("only the firm admin may watch a client or project", () => {
    expect(authorize(principal("firm_admin"), "project.watch", betaRecord("project")).allowed).toBe(true);
    const lead = principal("consultant", [], undefined, [], { clients: [BETA] });
    expect(authorize(lead, "project.watch", betaRecord("project")).allowed).toBe(false);
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

describe("staffing: admins, client leads and join requests", () => {
  const assignment = (client: string): Resource => ({
    type: "client_assignment",
    orgId: client,
    firmOrgId: FIRM,
    projectId: null,
    clientOrgId: client,
  });
  const joinRequest = (client: string): Resource => ({
    type: "join_request",
    orgId: FIRM,
    firmOrgId: FIRM,
    projectId: null,
    clientOrgId: client,
  });

  it("only the firm admin adds clients and names a lead", () => {
    const org = { type: "organization", orgId: FIRM, firmOrgId: FIRM, projectId: null } as Resource;
    expect(authorize(principal("firm_admin"), "organization.create", org).allowed).toBe(true);
    expect(authorize(principal("consultant", [], undefined, [], { clients: [ACME] }), "organization.create", org).allowed).toBe(false);
    expect(authorize(principal("firm_admin"), "client_assignment.set_lead", assignment(ACME)).allowed).toBe(true);
    expect(
      authorize(principal("consultant", [], undefined, [], { clients: [ACME] }), "client_assignment.set_lead", assignment(ACME)).allowed,
    ).toBe(false);
  });

  it("a lead staffs their own client and no other", () => {
    const lead = principal("consultant", [], undefined, [BETA], { clients: [ACME] });
    expect(authorize(lead, "client_assignment.manage", assignment(ACME)).allowed).toBe(true);
    expect(authorize(lead, "client_assignment.manage", assignment(BETA)).allowed).toBe(false);
    expect(authorize(principal("consultant", [], undefined, [ACME]), "client_assignment.manage", assignment(ACME)).allowed).toBe(false);
  });

  it("a lead or the admin decides join requests; a plain consultant cannot", () => {
    expect(authorize(principal("firm_admin"), "join_request.decide", joinRequest(ACME)).allowed).toBe(true);
    expect(
      authorize(principal("consultant", [], undefined, [], { clients: [ACME] }), "join_request.decide", joinRequest(ACME)).allowed,
    ).toBe(true);
    expect(
      authorize(principal("consultant", [], undefined, [], { clients: [BETA] }), "join_request.decide", joinRequest(ACME)).allowed,
    ).toBe(false);
  });

  it("any consultant may ask to join a client they are not on; client users may not", () => {
    expect(authorize(principal("consultant"), "join_request.create", joinRequest(ACME)).allowed).toBe(true);
    expect(authorize(principal("client_admin"), "join_request.create", joinRequest(ACME)).allowed).toBe(false);
    expect(authorize(principal("consultant"), "client_directory.read", { type: "client_directory", orgId: FIRM, firmOrgId: FIRM, projectId: null }).allowed).toBe(true);
  });
});

describe("internal project work", () => {
  const INTERNAL = "00000000-0000-4000-8000-0000000000f2";
  const me = principal("consultant", [INTERNAL]);
  const colleague = principal("consultant", [INTERNAL]);
  const action = { type: "action", orgId: FIRM, firmOrgId: FIRM, projectId: INTERNAL, projectKind: "internal", assignees: [me.userId] } as Resource & {
    type: "action";
  };

  it("the owning consultant works the action; a colleague does not", () => {
    expect(canTransition(me, action, "assigned", "in_progress").allowed).toBe(true);
    expect(authorize(me, "evidence.submit", action).allowed).toBe(true);
    expect(canTransition(colleague, action, "assigned", "in_progress").allowed).toBe(false);
  });

  it("nobody verifies their own work; a colleague or the admin does", () => {
    expect(canTransition(me, action, "awaiting_review", "verified_complete")).toEqual({ allowed: false, reason: "workflow:self-review" });
    expect(canTransition(colleague, action, "awaiting_review", "verified_complete").allowed).toBe(true);
    expect(canTransition(principal("firm_admin"), action, "awaiting_review", "verified_complete").allowed).toBe(true);
  });

  it("whoever submitted evidence in this round cannot review it either", () => {
    const admin = principal("firm_admin");
    expect(canTransition(colleague, action, "awaiting_review", "verified_complete", [colleague.userId])).toEqual({
      allowed: false,
      reason: "workflow:self-review",
    });
    expect(canTransition(admin, action, "awaiting_review", "revision_requested", [admin.userId]).allowed).toBe(false);
    expect(canTransition(admin, action, "awaiting_review", "verified_complete", [colleague.userId]).allowed).toBe(true);
  });

  it("on client projects consultants still never do the client's work", () => {
    const clientAction = acmeRecord("action", { projectKind: "client", assignees: [me.userId] }) as Resource & { type: "action" };
    const c = principal("consultant", [ACME_PROJ_1]);
    expect(canTransition(c, { ...clientAction, assignees: [c.userId] }, "assigned", "in_progress").allowed).toBe(false);
  });

  it("a member creates internal projects; the lead manages its members", () => {
    const project = { type: "project", orgId: FIRM, firmOrgId: FIRM, projectId: INTERNAL, projectKind: "internal" } as Resource;
    expect(authorize(me, "project.create_internal", { ...project, projectId: null }).allowed).toBe(true);
    const lead = principal("consultant", [INTERNAL], undefined, [], { projects: [INTERNAL] });
    expect(authorize(lead, "project.manage_members", project).allowed).toBe(true);
    expect(authorize(me, "project.manage_members", project).allowed).toBe(false);
  });
});

describe("follow-through after the report", () => {
  const owner = principal("action_owner", [ACME_PROJ_1]);
  const manager = principal("client_manager", [ACME_PROJ_1]);
  const consultant = principal("consultant", [ACME_PROJ_1]);
  const INTERNAL_PROJ = "00000000-0000-4000-8000-0000000000f3";
  const action = (type: Resource["type"], extra: Partial<Resource> = {}) => acmeRecord(type, { assignees: [owner.userId], ...extra });

  it("only a named client admin or manager accepts a risk", () => {
    expect(authorize(manager, "risk.accept", action("risk_acceptance")).allowed).toBe(true);
    expect(authorize(principal("client_admin"), "risk.accept", action("risk_acceptance")).allowed).toBe(true);
    for (const p of [owner, consultant, principal("firm_admin")]) {
      expect(authorize(p, "risk.accept", action("risk_acceptance")).allowed).toBe(false);
    }
  });

  it("the firm's notes on an action never reach the client", () => {
    expect(authorize(consultant, "action_note.read", action("action_note")).allowed).toBe(true);
    for (const p of [owner, manager, principal("client_admin")]) {
      expect(authorize(p, "action_note.read", action("action_note")).allowed).toBe(false);
    }
  });

  it("the client reads the evidence list but only the firm writes it", () => {
    expect(authorize(owner, "evidence_request.read", action("evidence_request")).allowed).toBe(true);
    expect(authorize(owner, "evidence_request.manage", action("evidence_request")).allowed).toBe(false);
    expect(authorize(manager, "evidence_request.manage", action("evidence_request")).allowed).toBe(false);
    expect(authorize(consultant, "evidence_request.manage", action("evidence_request")).allowed).toBe(true);
  });

  it("owners ask for a new deadline and the firm decides", () => {
    expect(authorize(owner, "deadline_request.create", action("deadline_request")).allowed).toBe(true);
    expect(authorize(owner, "deadline_request.decide", action("deadline_request")).allowed).toBe(false);
    expect(authorize(consultant, "deadline_request.decide", action("deadline_request")).allowed).toBe(true);
  });

  it("nobody closes an action they own (internal projects)", () => {
    const staff = principal("consultant", [INTERNAL_PROJ]);
    const own = { ...action("action"), orgId: FIRM, projectId: INTERNAL_PROJ, projectKind: "internal" as const, assignees: [staff.userId] };
    expect(canTransition(staff, own as Resource & { type: "action" }, "in_progress", "closed").allowed).toBe(false);
    const colleague = principal("consultant", [INTERNAL_PROJ]);
    expect(canTransition(colleague, own as Resource & { type: "action" }, "in_progress", "closed").allowed).toBe(true);
  });
});

describe("metrics", () => {
  it("project metrics are for the firm and the client's admins and managers; team metrics for the firm admin", () => {
    const project = acmeRecord("project");
    expect(authorize(principal("client_manager", [ACME_PROJ_1]), "metrics.read", project).allowed).toBe(true);
    expect(authorize(principal("action_owner", [ACME_PROJ_1]), "metrics.read", project).allowed).toBe(false);
    const team: Resource = { type: "org_user", orgId: FIRM, firmOrgId: FIRM, projectId: null };
    expect(authorize(principal("firm_admin"), "team_metrics.read", team).allowed).toBe(true);
    for (const role of ["consultant", "client_admin", "client_manager", "action_owner"] as const) {
      expect(authorize(principal(role), "team_metrics.read", { ...team, orgId: principal(role).orgId, firmOrgId: FIRM }).allowed, role).toBe(false);
    }
  });
});

describe("intake and expertise", () => {
  const firmOrg = (r: Partial<Resource>): Resource => ({ type: "inquiry", orgId: FIRM, firmOrgId: FIRM, projectId: null, ...r });
  const admin = principal("firm_admin", [], FIRM);
  const cons = principal("consultant", [], FIRM);

  it("a consultant reads and works only the inquiries handed to them; the admin decides", () => {
    const theirs = firmOrg({ assignees: [cons.userId] });
    const other = firmOrg({ assignees: [] });
    expect(authorize(cons, "inquiry.read", theirs).allowed).toBe(true);
    expect(authorize(cons, "inquiry.work", theirs).allowed).toBe(true);
    expect(authorize(cons, "inquiry.read", other).allowed).toBe(false);
    expect(authorize(cons, "inquiry.decide", theirs).allowed).toBe(false);
    expect(authorize(cons, "lead_suggestion.read", theirs).allowed).toBe(false);
    expect(authorize(admin, "inquiry.decide", other).allowed).toBe(true);
    expect(authorize(principal("client_admin", [], ACME), "inquiry.read", firmOrg({ orgId: ACME })).allowed).toBe(false);
  });

  it("a consultant updates only their own profile, and never their expertise", () => {
    const own = firmOrg({ type: "consultant_profile", createdBy: cons.userId });
    const someone = firmOrg({ type: "consultant_profile", createdBy: admin.userId });
    expect(authorize(cons, "consultant_profile.update_own", own).allowed).toBe(true);
    expect(authorize(cons, "consultant_profile.update_own", someone).allowed).toBe(false);
    expect(authorize(cons, "consultant_profile.manage", own).allowed).toBe(false);
    expect(authorize(admin, "consultant_profile.manage", own).allowed).toBe(true);
  });
});
