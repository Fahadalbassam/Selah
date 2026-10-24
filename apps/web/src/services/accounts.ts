import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { accessReviews, clientContacts, invitations, orgMemberships, organizations, user } from "@/db/schema";
import { assertAllowed, authorize, ForbiddenError, type Principal, type Resource } from "@/authz";
import { isPersonalEmail } from "@/lib/email";
import { BadRequestError, ConflictError, NotFoundError } from "@/server/errors";
import { audit } from "./audit";

// Accounts (baseline: Accounts): who belongs to an
// organisation, how they are invited, switched off, re-addressed and
// reviewed. The database enforces every rule; these checks give clear
// errors and keep the audit trail. Mail is queued by database functions
// with links only.

type Role = (typeof orgMemberships.$inferSelect)["role"];

const peopleOf = (principal: Principal, orgId: string): Resource => ({
  type: "org_user",
  orgId,
  firmOrgId: principal.orgKind === "firm" ? principal.orgId : undefined,
  projectId: null,
});

const contactsOf = (principal: Principal, clientOrgId: string): Resource => ({
  type: "client_contact",
  orgId: clientOrgId,
  firmOrgId: principal.orgKind === "firm" ? principal.orgId : undefined,
  projectId: null,
});

/** A random link token; only its hash is stored. */
function newToken() {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: tokenHash(token) };
}

export const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");

async function membershipOf(tx: Tx, userId: string) {
  const [m] = await tx
    .select({ orgId: orgMemberships.orgId, role: orgMemberships.role, active: orgMemberships.active })
    .from(orgMemberships)
    .where(eq(orgMemberships.userId, userId))
    .limit(1);
  if (!m) throw new NotFoundError("person");
  return m;
}

/** An organisation's people and open invitations, for its admins. */
export async function listPeople(tx: Tx, principal: Principal, orgId: string) {
  assertAllowed(principal, "org_user.manage", peopleOf(principal, orgId));
  const [org] = await tx
    .select({
      id: organizations.id,
      name: organizations.name,
      nameAr: organizations.nameAr,
      kind: organizations.kind,
      engagementMode: organizations.engagementMode,
      allowedEmailDomains: organizations.allowedEmailDomains,
    })
    .from(organizations)
    .where(eq(organizations.id, orgId));
  if (!org) throw new NotFoundError("organization");
  const people = await tx
    .select({
      userId: user.id,
      name: user.name,
      nameAlt: user.nameAlt,
      email: user.email,
      role: orgMemberships.role,
      active: orgMemberships.active,
      deactivatedAt: orgMemberships.deactivatedAt,
      deactivationReason: orgMemberships.deactivationReason,
    })
    .from(orgMemberships)
    .innerJoin(user, eq(user.id, orgMemberships.userId))
    .where(eq(orgMemberships.orgId, orgId))
    .orderBy(desc(orgMemberships.active), asc(user.name));
  const open = await tx
    .select({
      id: invitations.id,
      email: invitations.email,
      name: invitations.name,
      role: invitations.role,
      expiresAt: invitations.expiresAt,
    })
    .from(invitations)
    .where(and(eq(invitations.orgId, orgId), isNull(invitations.acceptedAt), isNull(invitations.revokedAt)))
    .orderBy(asc(invitations.createdAt));
  const [lastReview] = await tx
    .select({ at: accessReviews.createdAt })
    .from(accessReviews)
    .where(eq(accessReviews.orgId, orgId))
    .orderBy(desc(accessReviews.createdAt))
    .limit(1);
  // Who has two-factor sign-in on; the database decides who may ask.
  const { rows: twoFactor } = await tx.execute<{ user_id: string; enabled: boolean }>(
    sql`select user_id, enabled from app_two_factor_status(${orgId})`,
  );
  const on = new Map(twoFactor.map((r) => [r.user_id, r.enabled]));
  return {
    organization: org,
    people: people.map((p) => ({ ...p, personalEmail: isPersonalEmail(p.email), twoFactor: on.get(p.userId) ?? false })),
    invitations: open,
    lastAccessReview: lastReview?.at ?? null,
    can: { erase: authorize(principal, "org_user.erase", peopleOf(principal, orgId)).allowed },
  };
}

/** The domains an organisation's addresses must use; empty means any (clients only). */
export async function setEmailDomains(tx: Tx, principal: Principal, orgId: string, domains: string[]) {
  assertAllowed(principal, "org_user.manage", peopleOf(principal, orgId));
  const updated = await tx
    .update(organizations)
    .set({ allowedEmailDomains: domains.length ? domains : null })
    .where(eq(organizations.id, orgId))
    .returning({ id: organizations.id, allowedEmailDomains: organizations.allowedEmailDomains });
  if (!updated.length) throw new NotFoundError("organization");
  await audit(tx, {
    actorId: principal.userId,
    orgId,
    action: "organization.email_domains",
    resourceType: "organization",
    resourceId: orgId,
    outcome: "allow",
    meta: { domains: domains.join(",") },
  });
  return updated[0];
}

export async function invite(tx: Tx, principal: Principal, input: { orgId: string; email: string; name: string; role: Role }) {
  assertAllowed(principal, "org_user.manage", peopleOf(principal, input.orgId));
  const { token, hash } = newToken();
  const [row] = await tx
    .insert(invitations)
    .values({
      orgId: input.orgId,
      email: input.email,
      name: input.name,
      role: input.role,
      tokenHash: hash,
      invitedBy: principal.userId,
      expiresAt: new Date(), // the database sets the real expiry
    })
    .returning({ id: invitations.id, email: invitations.email, expiresAt: invitations.expiresAt });
  await tx.execute(sql`select app_send_invitation(${row!.id}, ${token})`);
  await audit(tx, {
    actorId: principal.userId,
    orgId: input.orgId,
    action: "invitation.create",
    resourceType: "invitation",
    resourceId: row!.id,
    outcome: "allow",
    meta: { role: input.role },
  });
  return row!;
}

export async function revokeInvitation(tx: Tx, principal: Principal, id: string) {
  const [inv] = await tx.select({ orgId: invitations.orgId }).from(invitations).where(eq(invitations.id, id));
  if (!inv) throw new NotFoundError("invitation");
  assertAllowed(principal, "org_user.manage", peopleOf(principal, inv.orgId));
  await tx.update(invitations).set({ revokedAt: new Date() }).where(eq(invitations.id, id));
  await audit(tx, {
    actorId: principal.userId,
    orgId: inv.orgId,
    action: "invitation.revoke",
    resourceType: "invitation",
    resourceId: id,
    outcome: "allow",
  });
  return { ok: true };
}

/** Switch an account off (its sessions end at once) or back on. Nothing is deleted. */
export async function setActive(tx: Tx, principal: Principal, userId: string, input: { active: boolean; reason?: string }) {
  const m = await membershipOf(tx, userId);
  assertAllowed(principal, "org_user.manage", peopleOf(principal, m.orgId));
  if (userId === principal.userId) throw new BadRequestError("you cannot switch off your own account");
  if (!input.active && !input.reason) throw new BadRequestError("say why the account is switched off");
  // The database refuses the same (check_departure); saying so first keeps the message plain.
  if (!input.active && m.active) {
    const { blocking } = await personHoldings(tx, principal, userId);
    if (blocking > 0) throw new ConflictError("hand over what this person still holds before switching the account off");
  }
  const changed = await tx
    .update(orgMemberships)
    .set(input.active ? { active: true } : { active: false, deactivationReason: input.reason })
    .where(and(eq(orgMemberships.userId, userId), eq(orgMemberships.active, !input.active)))
    .returning({ userId: orgMemberships.userId });
  return { changed: changed.length > 0 };
}

export const HAND_OVER_KINDS = ["action", "client_lead", "project_lead", "review", "client_role"] as const;
export type HandOverKind = (typeof HAND_OVER_KINDS)[number];

export interface Holding {
  kind: HandOverKind | "department_head";
  entityId: string;
  projectId: string | null;
  orgId: string;
  title: string;
  detail: string | null;
  blocking: boolean;
}

/**
 * What a person still holds (migration 0027): open actions, clients and
 * projects they lead, reviews only they can do (these stop the account being
 * switched off), and client roles and departments they head (an interim is
 * named). For the admins who may switch them off.
 */
export async function personHoldings(tx: Tx, principal: Principal, userId: string) {
  const m = await membershipOf(tx, userId);
  assertAllowed(principal, "org_user.manage", peopleOf(principal, m.orgId));
  const { rows } = await tx.execute<{
    kind: Holding["kind"];
    entity_id: string;
    project_id: string | null;
    org_id: string;
    title: string;
    detail: string | null;
    blocking: boolean;
  }>(sql`select * from app_person_holdings(${userId})`);
  const items: Holding[] = rows.map((r) => ({
    kind: r.kind,
    entityId: r.entity_id,
    projectId: r.project_id,
    orgId: r.org_id,
    title: r.title,
    detail: r.detail,
    blocking: r.blocking,
  }));
  return { items, blocking: items.filter((i) => i.blocking).length };
}

/**
 * Hand a person's work to an active colleague in the same organisation, in
 * one step. The database checks who may, who may receive, and every
 * record's own rules, and writes the audit log.
 */
export async function handOver(tx: Tx, principal: Principal, userId: string, input: { to: string; kinds: HandOverKind[] }) {
  const m = await membershipOf(tx, userId);
  assertAllowed(principal, "org_user.manage", peopleOf(principal, m.orgId));
  if (input.to === userId) throw new BadRequestError("hand over to someone else");
  const { rows } = await tx.execute<{ n: number }>(
    sql`select app_hand_over(${userId}, ${input.to}, ${`{${input.kinds.join(",")}}`}::text[]) as n`,
  );
  return { moved: Number(rows[0]!.n), ...(await personHoldings(tx, principal, userId)) };
}

/**
 * The person's name in the other language ("Reem Al-Harbi" for "ريم الحربي"),
 * so it is masked in files written in either before a hosted model sees them.
 * The same admins as an address change; the database checks it and logs it.
 */
export async function setNameAlt(tx: Tx, principal: Principal, userId: string, nameAlt: string) {
  const m = await membershipOf(tx, userId);
  assertAllowed(principal, "org_user.manage", peopleOf(principal, m.orgId));
  await tx.execute(sql`select app_set_name_alt(${userId}, ${nameAlt})`);
  return { ok: true };
}

/** Start an address change; the new address confirms it from a link. */
export async function requestEmailChange(tx: Tx, principal: Principal, userId: string, newEmail: string) {
  const m = await membershipOf(tx, userId);
  assertAllowed(principal, "org_user.manage", peopleOf(principal, m.orgId));
  if (userId === principal.userId) throw new BadRequestError("another admin changes your address");
  const { token, hash } = newToken();
  const { rows } = await tx.execute<{ id: string }>(sql`
    insert into email_changes (user_id, new_email, token_hash, requested_by, old_email, expires_at)
    values (${userId}, ${newEmail}, ${hash}, ${principal.userId}, '', now())
    returning id`);
  await tx.execute(sql`select app_send_email_change(${rows[0]!.id}, ${token})`);
  return { ok: true };
}

/**
 * "Are these people still with you?" Switches off the ones named, then
 * records the review over everyone else, who stay. The database checks
 * that the review covers every active member.
 */
export async function submitAccessReview(
  tx: Tx,
  principal: Principal,
  orgId: string,
  input: { deactivate: { userId: string; reason: string }[] },
) {
  assertAllowed(principal, "org_user.manage", peopleOf(principal, orgId));
  for (const d of input.deactivate) {
    const m = await membershipOf(tx, d.userId);
    if (m.orgId !== orgId) throw new BadRequestError("that person is not in this organization");
    if (m.active) await setActive(tx, principal, d.userId, { active: false, reason: d.reason });
  }
  const kept = await tx
    .select({ userId: orgMemberships.userId })
    .from(orgMemberships)
    .where(and(eq(orgMemberships.orgId, orgId), eq(orgMemberships.active, true)));
  const [review] = await tx
    .insert(accessReviews)
    .values({
      orgId,
      reviewedBy: principal.userId,
      kept: kept.map((k) => k.userId),
      deactivated: input.deactivate.map((d) => d.userId),
    })
    .returning({ id: accessReviews.id });
  await audit(tx, {
    actorId: principal.userId,
    orgId,
    action: "access_review.submit",
    resourceType: "organization",
    resourceId: orgId,
    outcome: "allow",
    meta: { kept: kept.length, deactivated: input.deactivate.length },
  });
  return review!;
}

/**
 * Reset someone's two-factor sign-in (a lost phone). Their sessions end, they
 * are mailed, and they set it up again at the next sign-in. The database
 * decides who may (app_reset_two_factor) and writes the audit log.
 */
export async function resetTwoFactor(tx: Tx, principal: Principal, userId: string, reason: string) {
  const m = await membershipOf(tx, userId);
  assertAllowed(principal, "org_user.manage", peopleOf(principal, m.orgId));
  if (userId === principal.userId) throw new BadRequestError("another admin resets your two-factor sign-in");
  await tx.execute(sql`select app_reset_two_factor(${userId}, ${reason})`);
  return { ok: true };
}

/** A PDPL erasure request: details and sign-in removed, ids and history kept. */
export async function eraseUser(tx: Tx, principal: Principal, userId: string, reason: string) {
  const m = await membershipOf(tx, userId);
  assertAllowed(principal, "org_user.erase", peopleOf(principal, m.orgId));
  const { rows } = await tx.execute<{ n: number }>(sql`select app_erase_user(${userId}, ${reason}) as n`);
  return { label: `Former user #${rows[0]!.n}` };
}

// ------------------------------------------------------------ contacts

export async function listContacts(tx: Tx, principal: Principal, clientOrgId: string) {
  assertAllowed(principal, "client_contact.read", contactsOf(principal, clientOrgId));
  return tx
    .select({
      id: clientContacts.id,
      name: clientContacts.name,
      nameAlt: clientContacts.nameAlt,
      title: clientContacts.title,
      email: clientContacts.email,
      phone: clientContacts.phone,
    })
    .from(clientContacts)
    .where(eq(clientContacts.orgId, clientOrgId))
    .orderBy(asc(clientContacts.name));
}

/**
 * Whether this user may add, edit or remove the client's contacts: firm staff
 * on the client, except a consultant who only observes its projects (review
 * M05). An observer writes nothing; staffed on any of the client's projects,
 * or on its team without a project yet, they keep the contacts up to date.
 */
export async function canWriteContacts(tx: Tx, principal: Principal, clientOrgId: string) {
  if (!authorize(principal, "client_contact.write", contactsOf(principal, clientOrgId)).allowed) return false;
  if (principal.role !== "consultant" || !principal.observedProjectIds?.size) return true;
  const rows = await tx.execute<{ observes: boolean; works: boolean }>(sql`
    select
      exists (select 1 from project_members pm join projects p on p.id = pm.project_id
              where p.org_id = ${clientOrgId} and pm.user_id = ${principal.userId} and pm.observer) as observes,
      exists (select 1 from project_members pm join projects p on p.id = pm.project_id
              where p.org_id = ${clientOrgId} and pm.user_id = ${principal.userId} and not pm.observer) as works`);
  const r = rows.rows[0];
  return !r?.observes || !!r.works;
}

async function assertContactWriter(tx: Tx, principal: Principal, clientOrgId: string) {
  const resource = contactsOf(principal, clientOrgId);
  assertAllowed(principal, "client_contact.write", resource);
  if (!(await canWriteContacts(tx, principal, clientOrgId))) throw new ForbiddenError("client_contact.write", resource, "project:observer");
}

export interface ContactInput {
  name: string;
  /** The name in the other language, for masking. */
  nameAlt?: string | null;
  title?: string | null;
  email?: string | null;
  phone?: string | null;
}

export async function createContact(tx: Tx, principal: Principal, clientOrgId: string, input: ContactInput) {
  await assertContactWriter(tx, principal, clientOrgId);
  const [row] = await tx
    .insert(clientContacts)
    .values({ orgId: clientOrgId, ...input, createdBy: principal.userId })
    .returning({ id: clientContacts.id });
  return row!;
}

async function contactOrg(tx: Tx, id: string) {
  const [c] = await tx.select({ orgId: clientContacts.orgId }).from(clientContacts).where(eq(clientContacts.id, id));
  if (!c) throw new NotFoundError("contact");
  return c.orgId;
}

export async function updateContact(tx: Tx, principal: Principal, id: string, input: Partial<ContactInput>) {
  await assertContactWriter(tx, principal, await contactOrg(tx, id));
  await tx.update(clientContacts).set(input).where(eq(clientContacts.id, id));
  return { ok: true };
}

export async function deleteContact(tx: Tx, principal: Principal, id: string) {
  await assertContactWriter(tx, principal, await contactOrg(tx, id));
  await tx.delete(clientContacts).where(eq(clientContacts.id, id));
  return { ok: true };
}
