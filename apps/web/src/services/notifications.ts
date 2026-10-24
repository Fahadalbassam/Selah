import "server-only";
import { and, count, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { actions, inquiries, mailMutes, mailPreferences, notifications, organizations, projects } from "@/db/schema";
import type { Principal } from "@/authz";
import { MAIL_DEFAULTS, type MailChoices } from "@/lib/mail-choices";
import { BadRequestError, NotFoundError } from "@/server/errors";

// A person's own notifications. Row-level security already limits every
// query here to the caller's rows; the user_id filters say so explicitly.

export interface NotificationItem {
  id: string;
  kind: string;
  entityType: string;
  entityId: string;
  /** What it is about, when the caller can still see it. */
  title: string | null;
  titleAr: string | null;
  href: string | null;
  readAt: Date | null;
  createdAt: Date;
}

const ids = (rows: { entityType: string; entityId: string }[], type: string) => [
  ...new Set(rows.filter((r) => r.entityType === type).map((r) => r.entityId)),
];

/** The newest notifications with what each is about, and how many are unread. */
export async function listNotifications(tx: Tx, principal: Principal, limit = 30) {
  const rows = await tx
    .select({
      id: notifications.id,
      kind: notifications.kind,
      entityType: notifications.entityType,
      entityId: notifications.entityId,
      readAt: notifications.readAt,
      createdAt: notifications.createdAt,
    })
    .from(notifications)
    .where(eq(notifications.userId, principal.userId))
    .orderBy(desc(notifications.createdAt))
    .limit(limit);

  // Titles are read under the caller's rights, so something they can no longer see stays untitled.
  const titles = new Map<string, { title: string | null; titleAr: string | null }>();
  const actionIds = ids(rows, "action");
  if (actionIds.length) {
    for (const a of await tx
      .select({ id: actions.id, title: actions.title })
      .from(actions)
      .where(inArray(actions.id, actionIds))) {
      titles.set(a.id, { title: a.title, titleAr: null });
    }
  }
  const projectIds = ids(rows, "project");
  if (projectIds.length) {
    for (const p of await tx
      .select({ id: projects.id, title: projects.title })
      .from(projects)
      .where(inArray(projects.id, projectIds))) {
      titles.set(p.id, { title: p.title, titleAr: null });
    }
  }
  const orgIds = ids(rows, "organization");
  if (orgIds.length) {
    const orgs = await tx
      .select({ id: organizations.id, name: organizations.name, nameAr: organizations.nameAr })
      .from(organizations)
      .where(inArray(organizations.id, orgIds));
    for (const o of orgs) titles.set(o.id, { title: o.name, titleAr: o.nameAr });
  }
  const inquiryIds = principal.orgKind === "firm" ? ids(rows, "inquiry") : [];
  if (inquiryIds.length) {
    const found = await tx
      .select({ id: inquiries.id, name: inquiries.orgName, nameAr: inquiries.orgNameAr, ref: inquiries.publicRef })
      .from(inquiries)
      .where(inArray(inquiries.id, inquiryIds));
    for (const q of found) titles.set(q.id, { title: q.name ?? q.ref, titleAr: q.nameAr });
  }

  const items: NotificationItem[] = rows.map((r) => {
    const t = titles.get(r.entityId);
    return {
      ...r,
      title: t?.title ?? null,
      titleAr: t?.titleAr ?? null,
      href: t ? hrefFor(r.kind, r.entityType, r.entityId) : null,
    };
  });
  return { items, unread: await unreadCount(tx, principal) };
}

function hrefFor(kind: string, entityType: string, entityId: string) {
  if (kind === "access_review.due") return "/team";
  if (kind.startsWith("info_request.")) return `/projects/${entityId}?tab=requests`;
  // A client confirmed receiving its export pack: the firm admin sees it on the client page.
  if (kind === "client.pack_received") return `/clients/${entityId}`;
  // Archiving and restoring reach the client's admins, who have no client page.
  if (kind.startsWith("client.")) return "/";
  switch (entityType) {
    case "action":
      return `/actions/${entityId}`;
    case "project":
      return `/projects/${entityId}`;
    case "organization":
      return `/clients/${entityId}`;
    case "inquiry":
      return `/inquiries/${entityId}`;
    default:
      return null;
  }
}

export async function unreadCount(tx: Tx, principal: Principal) {
  const [row] = await tx
    .select({ n: count() })
    .from(notifications)
    .where(and(eq(notifications.userId, principal.userId), isNull(notifications.readAt)));
  return Number(row?.n ?? 0);
}

/** Mark some notifications read, or all of them when no ids are given. */
export async function markRead(tx: Tx, principal: Principal, only?: string[]) {
  const mine = and(eq(notifications.userId, principal.userId), isNull(notifications.readAt));
  await tx
    .update(notifications)
    .set({ readAt: new Date() })
    .where(only ? and(mine, inArray(notifications.id, only)) : mine);
  return { unread: await unreadCount(tx, principal) };
}

const hhmm = (t: string | null) => (t ? t.slice(0, 5) : null);

/**
 * The caller's mail choices (no row means the defaults), the actions they
 * muted, the firm's Ramadan, and when a work mail queued now would go out.
 */
export async function getMailPreferences(tx: Tx, principal: Principal) {
  const [row] = await tx.select().from(mailPreferences).where(eq(mailPreferences.userId, principal.userId));
  const choices: MailChoices = row
    ? {
        updates: row.updates,
        reminders: row.reminders,
        quietFrom: hhmm(row.quietFrom),
        quietTo: hhmm(row.quietTo),
        saturday: row.saturday,
        ramadan: row.ramadan,
      }
    : { ...MAIL_DEFAULTS };
  // Titles under the caller's rights: an action they can no longer see drops out.
  const muted = await tx
    .select({ actionId: mailMutes.actionId, title: actions.title, at: mailMutes.createdAt })
    .from(mailMutes)
    .innerJoin(actions, eq(actions.id, mailMutes.actionId))
    .where(eq(mailMutes.userId, principal.userId))
    .orderBy(desc(mailMutes.createdAt));
  const { rows } = await tx.execute<{ next: Date | string | null; starts: string | null; ends: string | null; mail_from: string | null; mail_to: string | null }>(sql`
    SELECT app_my_next_mail_at() AS next, r.starts, r.ends, r.mail_from, r.mail_to
    FROM (SELECT 1) x LEFT JOIN app_firm_ramadan() r ON true`);
  const r = rows[0];
  return {
    ...choices,
    muted,
    nextMailAt: r?.next ? new Date(r.next) : null,
    firmRamadan: r?.starts
      ? { starts: r.starts, ends: r.ends!, mailFrom: hhmm(r.mail_from)!, mailTo: hhmm(r.mail_to)! }
      : null,
  };
}

export async function setMailPreferences(tx: Tx, principal: Principal, input: Partial<MailChoices>) {
  const current = await getMailPreferences(tx, principal);
  const next: MailChoices = {
    updates: input.updates ?? current.updates,
    reminders: input.reminders ?? current.reminders,
    quietFrom: input.quietFrom !== undefined ? input.quietFrom : current.quietFrom,
    quietTo: input.quietTo !== undefined ? input.quietTo : current.quietTo,
    saturday: input.saturday ?? current.saturday,
    ramadan: input.ramadan ?? current.ramadan,
  };
  // The database refuses the same; saying so here gives the form a clear error.
  if ((next.quietFrom === null) !== (next.quietTo === null) || (next.quietFrom !== null && next.quietFrom === next.quietTo)) {
    throw new BadRequestError("quiet_hours");
  }
  await tx
    .insert(mailPreferences)
    .values({ userId: principal.userId, ...next })
    .onConflictDoUpdate({ target: mailPreferences.userId, set: { ...next, updatedAt: new Date() } });
  return getMailPreferences(tx, principal);
}

/** Stop or restart mail about one action. Only an action the caller can see can be muted. */
export async function setActionMuted(tx: Tx, principal: Principal, actionId: string, muted: boolean) {
  if (muted) {
    const [seen] = await tx.select({ id: actions.id }).from(actions).where(eq(actions.id, actionId));
    if (!seen) throw new NotFoundError("action");
    await tx.insert(mailMutes).values({ userId: principal.userId, actionId }).onConflictDoNothing();
  } else {
    await tx.delete(mailMutes).where(and(eq(mailMutes.userId, principal.userId), eq(mailMutes.actionId, actionId)));
  }
  return { muted };
}

/** Whether the caller muted mail about an action. */
export async function isActionMuted(tx: Tx, principal: Principal, actionId: string) {
  const [row] = await tx
    .select({ id: mailMutes.actionId })
    .from(mailMutes)
    .where(and(eq(mailMutes.userId, principal.userId), eq(mailMutes.actionId, actionId)));
  return !!row;
}
