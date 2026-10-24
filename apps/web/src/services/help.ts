import "server-only";
import { desc, eq, sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { organizations, supportRequests, user } from "@/db/schema";
import { assertAllowed, authorize, OPEN_STATUSES, type Principal, type Resource } from "@/authz";
import { ConflictError, NotFoundError, RateLimitError } from "@/server/errors";
import { audit, auditDetached } from "./audit";
import { isOverdue, listActions, listProjects } from "./queries";

// Help for client people (F13, migration 0058_help). Two doors: a question
// about the work goes in the action's thread, a technical problem goes to
// the firm's admins. The database decides who the consultants are
// (app_my_consultants) and holds the support rules (app_report_problem,
// app_handle_support_request, RLS on support_requests); these calls check
// the same permissions first and keep the audit trail. Report text is never
// put in the audit meta.

const helpOf = (p: Principal): Resource => ({ type: "organization", orgId: p.orgId, projectId: null });

const requestOf = (r: { id: string; orgId: string; firmOrgId: string; userId: string }): Resource => ({
  type: "support_request",
  id: r.id,
  orgId: r.orgId,
  firmOrgId: r.firmOrgId,
  projectId: null,
  createdBy: r.userId,
});

function pgCode(err: unknown): string | undefined {
  for (let e = err; e instanceof Error; e = e.cause) {
    const code = (e as { code?: unknown }).code;
    if (typeof code === "string") return code;
  }
  return undefined;
}

interface Consultant {
  userId: string;
  name: string;
  email: string;
  isLead: boolean;
  isDeputy: boolean;
}

/** The help page: the person's consultants, their open actions and their own reports. Client people only. */
export async function getHelp(tx: Tx, principal: Principal) {
  if (principal.orgKind !== "client" || !authorize(principal, "help.read", helpOf(principal)).allowed) throw new NotFoundError("help");

  const { rows } = await tx.execute<{ project_id: string | null; user_id: string; name: string; email: string; is_lead: boolean; is_deputy: boolean }>(
    sql`select * from app_my_consultants() order by is_lead desc, is_deputy desc, name`,
  );
  const person = (r: (typeof rows)[number]): Consultant => ({ userId: r.user_id, name: r.name, email: r.email, isLead: r.is_lead, isDeputy: r.is_deputy });
  const lead = rows.find((r) => r.project_id === null && r.is_lead);
  const deputy = rows.find((r) => r.project_id === null && r.is_deputy);

  // Projects as the rest of the app shows them to this person; the function's rows only fill them in.
  const projects = (await listProjects(tx, principal))
    .filter((p) => p.kind === "client")
    .map((p) => ({ id: p.id, title: p.title, state: p.state, consultants: rows.filter((r) => r.project_id === p.id).map(person) }));

  const [org] = await tx
    .select({ engagementMode: organizations.engagementMode })
    .from(organizations)
    .where(eq(organizations.id, principal.orgId))
    .limit(1);

  const open = await listActions(tx, principal, { mineOnly: true, status: [...OPEN_STATUSES], limit: 5 });
  const mine = await tx
    .select({ id: supportRequests.id, body: supportRequests.body, createdAt: supportRequests.createdAt, handledAt: supportRequests.handledAt })
    .from(supportRequests)
    .where(eq(supportRequests.userId, principal.userId))
    .orderBy(desc(supportRequests.createdAt))
    .limit(10);

  const report = { type: "support_request", orgId: principal.orgId, projectId: null, createdBy: principal.userId } as Resource;
  return {
    lead: lead ? person(lead) : null,
    deputy: deputy ? person(deputy) : null,
    projects,
    engagementMode: org?.engagementMode ?? "full",
    readOnly: principal.readOnly === true,
    openActions: open.map((a) => ({ ...a, overdue: isOverdue(a) })),
    reports: mine,
    can: { report: authorize(principal, "support_request.create", report).allowed },
  };
}

/** Whom "Ask your consultant" may mention on a client's action page: the client's lead, then the deputy. Null for firm staff. */
export async function askMentionFor(tx: Tx, principal: Principal) {
  if (principal.orgKind !== "client" || !authorize(principal, "help.read", helpOf(principal)).allowed) return null;
  const { rows } = await tx.execute<{ user_id: string; is_lead: boolean }>(
    sql`select user_id, is_lead from app_my_consultants() where project_id is null order by is_lead desc`,
  );
  return rows.map((r) => r.user_id);
}

/** A client person reports a technical problem; the firm's admins are told. */
export async function reportProblem(tx: Tx, principal: Principal, input: { body: string }) {
  if (principal.orgKind !== "client") throw new NotFoundError("help");
  assertAllowed(principal, "support_request.create", { type: "support_request", orgId: principal.orgId, projectId: null, createdBy: principal.userId });
  let id: string;
  try {
    const { rows } = await tx.execute<{ id: string }>(sql`select app_report_problem(${input.body}) as id`);
    id = rows[0]!.id;
  } catch (err) {
    // Over the day's limit: kept in the trail, though the request rolls back.
    if (pgCode(err) === "SL429") {
      await auditDetached({
        actorId: principal.userId,
        orgId: principal.orgId,
        action: "support_request.create",
        resourceType: "support_request",
        outcome: "deny",
        reason: "rate_limited",
      });
      throw new RateLimitError("too many problem reports today");
    }
    throw err;
  }
  await audit(tx, {
    actorId: principal.userId,
    orgId: principal.orgId,
    action: "support_request.create",
    resourceType: "support_request",
    resourceId: id,
    outcome: "allow",
  });
  return { id };
}

/** Problems reported to the firm, newest first, for its admins. Null for everyone else. */
export async function listSupportRequests(tx: Tx, principal: Principal) {
  if (principal.orgKind !== "firm" || principal.role !== "firm_admin") return null;
  const reporter = user;
  const rows = await tx
    .select({
      id: supportRequests.id,
      orgId: supportRequests.orgId,
      firmOrgId: supportRequests.firmOrgId,
      userId: supportRequests.userId,
      body: supportRequests.body,
      createdAt: supportRequests.createdAt,
      handledAt: supportRequests.handledAt,
      name: reporter.name,
      email: reporter.email,
      orgName: organizations.name,
      orgNameAr: organizations.nameAr,
    })
    .from(supportRequests)
    .innerJoin(reporter, eq(reporter.id, supportRequests.userId))
    .innerJoin(organizations, eq(organizations.id, supportRequests.orgId))
    .where(eq(supportRequests.firmOrgId, principal.orgId))
    .orderBy(sql`${supportRequests.handledAt} is not null`, desc(supportRequests.createdAt))
    .limit(50);
  return rows
    .filter((r) => authorize(principal, "support_request.read", requestOf(r)).allowed)
    .map((r) => ({ ...r, can: { handle: !r.handledAt && authorize(principal, "support_request.handle", requestOf(r)).allowed } }));
}

/** The firm admin marks a report handled; its author is told in Selah. */
export async function handleSupportRequest(tx: Tx, principal: Principal, id: string) {
  const [r] = await tx
    .select({
      id: supportRequests.id,
      orgId: supportRequests.orgId,
      firmOrgId: supportRequests.firmOrgId,
      userId: supportRequests.userId,
      handledAt: supportRequests.handledAt,
    })
    .from(supportRequests)
    .where(eq(supportRequests.id, id))
    .limit(1);
  if (!r) throw new NotFoundError("support request");
  assertAllowed(principal, "support_request.handle", requestOf(r));
  if (r.handledAt) throw new ConflictError("this request was already handled");
  await tx.execute(sql`select app_handle_support_request(${id}::uuid)`);
  await audit(tx, {
    actorId: principal.userId,
    orgId: principal.orgId,
    action: "support_request.handle",
    resourceType: "support_request",
    resourceId: id,
    outcome: "allow",
    meta: { clientOrgId: r.orgId },
  });
  return { id };
}
