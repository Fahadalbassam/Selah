import "server-only";
import { and, count, desc, eq, inArray, isNull } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { actions, inquiries, mailPreferences, notifications, organizations, projects } from "@/db/schema";
import type { Principal } from "@/authz";

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

/** The caller's mail choices; no row means the defaults. */
export async function getMailPreferences(tx: Tx, principal: Principal) {
  const [row] = await tx
    .select({ followUpDigest: mailPreferences.followUpDigest })
    .from(mailPreferences)
    .where(eq(mailPreferences.userId, principal.userId));
  return { followUpDigest: row?.followUpDigest ?? true };
}

export async function setMailPreferences(tx: Tx, principal: Principal, input: { followUpDigest: boolean }) {
  await tx
    .insert(mailPreferences)
    .values({ userId: principal.userId, followUpDigest: input.followUpDigest })
    .onConflictDoUpdate({
      target: mailPreferences.userId,
      set: { followUpDigest: input.followUpDigest, updatedAt: new Date() },
    });
  return getMailPreferences(tx, principal);
}
