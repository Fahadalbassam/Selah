import "server-only";
import { and, count, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import {
  actions,
  clientKpis,
  clientKpiValues,
  engagementDeliverables,
  inquiries,
  mailKpiMutes,
  mailMutes,
  mailPreferences,
  notifications,
  organizations,
  projects,
  recommendations,
  supportRequests,
} from "@/db/schema";
import type { Principal } from "@/authz";
import { firmToday } from "@/lib/dates";
import type { MovedAwayFacts } from "@/lib/indicator-notice";
import type { IndicatorDirection, IndicatorFrequency } from "@/lib/indicators";
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
  /** An indicator that moved away (indicator.moved_away): the figures its line states. */
  facts: MovedAwayFacts | null;
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
  const recIds = ids(rows, "recommendation");
  if (recIds.length) {
    for (const r of await tx
      .select({ id: recommendations.id, title: recommendations.title })
      .from(recommendations)
      .where(inArray(recommendations.id, recIds))) {
      titles.set(r.id, { title: r.title, titleAr: null });
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

  // A business indicator a firm member filled in for the client (KPI layer B).
  const kpiIds = ids(rows, "kpi");
  if (kpiIds.length) {
    for (const k of await tx
      .select({ id: clientKpis.id, nameEn: clientKpis.nameEn, nameAr: clientKpis.nameAr })
      .from(clientKpis)
      .where(inArray(clientKpis.id, kpiIds))) {
      titles.set(k.id, { title: k.nameEn ?? k.nameAr, titleAr: k.nameAr });
    }
  }

  // A deliverable handed over (F21): titled under the reader's rights, so a client person reads it
  // only while they answer for it; the firm's notice opens its engagement, the client's the deliverables page.
  const deliverableIds = ids(rows, "deliverable");
  const deliverableLinks = new Map<string, string>();
  if (deliverableIds.length) {
    for (const d of await tx
      .select({ id: engagementDeliverables.id, title: engagementDeliverables.title, engagementId: engagementDeliverables.engagementId })
      .from(engagementDeliverables)
      .where(inArray(engagementDeliverables.id, deliverableIds))) {
      titles.set(d.id, { title: d.title, titleAr: null });
      deliverableLinks.set(d.id, principal.orgKind === "firm" ? `/engagements/${d.engagementId}` : "/deliverables");
    }
  }

  // A period whose indicator moved away (migration 0090): the period's
  // current figure, so a correction since is what the line states (one that
  // brought it back hides the notice altogether, in the database). Read under
  // the caller's rights, so an indicator they can no longer open stays
  // untitled and unstated.
  const facts = new Map<string, MovedAwayFacts>();
  const valueIds = ids(rows, "kpi_value");
  if (valueIds.length) {
    const found = await tx
      .select({
        id: clientKpiValues.id,
        kpiId: clientKpiValues.kpiId,
        period: clientKpiValues.period,
        value: sql<string>`(select c.value::text from client_kpi_values c
          where c.kpi_id = ${clientKpiValues.kpiId} and c.period = ${clientKpiValues.period}
            and not exists (select 1 from client_kpi_values s where s.supersedes_id = c.id)
          order by c.entered_at desc, c.id desc limit 1)`,
        nameEn: clientKpis.nameEn,
        nameAr: clientKpis.nameAr,
        unit: clientKpis.unit,
        direction: clientKpis.direction,
        frequency: clientKpis.frequency,
        baseline: clientKpis.baseline,
        target: clientKpis.target,
        targetDate: clientKpis.targetDate,
      })
      .from(clientKpiValues)
      .innerJoin(clientKpis, eq(clientKpis.id, clientKpiValues.kpiId))
      .where(inArray(clientKpiValues.id, valueIds));
    for (const v of found) {
      titles.set(v.id, { title: v.nameEn ?? v.nameAr, titleAr: v.nameAr });
      facts.set(v.id, {
        kpiId: v.kpiId,
        value: Number(v.value),
        period: v.period,
        frequency: v.frequency as IndicatorFrequency,
        unit: v.unit,
        baseline: Number(v.baseline),
        direction: v.direction as IndicatorDirection,
        target: v.target === null ? null : Number(v.target),
        targetDate: v.targetDate,
        // Set per notice below: the day the period was judged is the day the notice was written.
        targetPassed: false,
        reader: principal.orgKind === "firm" ? "firm" : "client",
      });
    }
  }

  // A reported problem (F13) is titled with its client: the firm admin reads which one, the reporter their own.
  const supportIds = ids(rows, "support_request");
  if (supportIds.length) {
    const found = await tx
      .select({ id: supportRequests.id, name: organizations.name, nameAr: organizations.nameAr })
      .from(supportRequests)
      .innerJoin(organizations, eq(organizations.id, supportRequests.orgId))
      .where(inArray(supportRequests.id, supportIds));
    for (const s of found) titles.set(s.id, { title: s.name, titleAr: s.nameAr });
  }

  const items: NotificationItem[] = rows.map((r) => {
    const t = titles.get(r.entityId);
    const found = r.entityType === "kpi_value" ? facts.get(r.entityId) : undefined;
    const f = found ? { ...found, targetPassed: found.targetDate !== null && firmToday(r.createdAt) > found.targetDate } : null;
    return {
      ...r,
      title: t?.title ?? null,
      titleAr: t?.titleAr ?? null,
      href: !t
        ? null
        : f
          ? `/indicators/${f.kpiId}`
          : r.entityType === "deliverable"
            ? (deliverableLinks.get(r.entityId) ?? null)
            : hrefFor(r.kind, r.entityType, r.entityId, principal.orgKind),
      facts: f,
    };
  });
  return { items, unread: await unreadCount(tx, principal) };
}

function hrefFor(kind: string, entityType: string, entityId: string, orgKind: Principal["orgKind"]) {
  if (kind === "access_review.due") return "/team";
  // An invitation's person was not placed in the position chosen (org chart, part 3): People in positions, where they are placed.
  if (kind === "org_chart.invite_not_placed") return orgKind === "client" ? "/departments/structure?view=people" : `/clients/${entityId}/structure?view=people`;
  if (kind.startsWith("info_request.")) return `/projects/${entityId}?tab=requests`;
  // A drafted status pack waits on the project's progress tab; a quiet client shows on the oversight page.
  if (kind === "report.pack_drafted") return `/projects/${entityId}?tab=progress`;
  if (kind === "project.client_quiet") return "/oversight";
  // Reported problems: the firm admin reads them below the notifications, the reporter on the help page.
  if (kind === "support.requested") return "/notifications#support";
  if (kind === "support.handled") return "/help";
  // The client assistant (F39): the client's admin reads the notice; the firm sees the client page's card.
  if (kind === "client_ai.offered") return "/assistant";
  if (kind.startsWith("client_ai.")) return `/clients/${entityId}`;
  // The closing pulse is answered, and read, on the project's closing tab.
  if (kind.startsWith("pulse.") || kind.startsWith("case_study.")) return `/projects/${entityId}?tab=closing`;
  // A client confirmed receiving its export pack: the firm admin sees it on the client page.
  if (kind === "client.pack_received") return `/clients/${entityId}`;
  // Archiving and restoring reach the client's admins, who have no client page.
  if (kind.startsWith("client.")) return "/";
  // Indicators waiting for this period's values are listed on the client's overview.
  if (kind === "indicator.due") return "/";
  // How a client's figures arrive, and what came in, live on its indicator data page.
  if (kind.startsWith("indicator.data_") || kind === "indicator.imported_for_you" || kind === "indicator.feed_failing") return `/indicators/data?client=${entityId}`;
  switch (entityType) {
    case "action":
      return `/actions/${entityId}`;
    case "recommendation":
      return `/recommendations/${entityId}`;
    case "project":
      return `/projects/${entityId}`;
    case "organization":
      return `/clients/${entityId}`;
    case "inquiry":
      return `/inquiries/${entityId}`;
    case "kpi":
      return `/indicators/${entityId}`;
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
  // And the indicators they muted (migration 0090), named under their rights the same way.
  const mutedIndicators = await tx
    .select({ kpiId: mailKpiMutes.kpiId, nameAr: clientKpis.nameAr, nameEn: clientKpis.nameEn, at: mailKpiMutes.createdAt })
    .from(mailKpiMutes)
    .innerJoin(clientKpis, eq(clientKpis.id, mailKpiMutes.kpiId))
    .where(eq(mailKpiMutes.userId, principal.userId))
    .orderBy(desc(mailKpiMutes.createdAt));
  const { rows } = await tx.execute<{ next: Date | string | null; starts: string | null; ends: string | null; mail_from: string | null; mail_to: string | null }>(sql`
    SELECT app_my_next_mail_at() AS next, r.starts, r.ends, r.mail_from, r.mail_to
    FROM (SELECT 1) x LEFT JOIN app_firm_ramadan() r ON true`);
  const r = rows[0];
  return {
    ...choices,
    muted,
    mutedIndicators,
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

/**
 * Stop or restart mail about one business indicator (indicator.moved_away,
 * migration 0090), beside the action mutes. Only an indicator the caller can
 * read can be muted; the database refuses the same.
 */
export async function setIndicatorMuted(tx: Tx, principal: Principal, kpiId: string, muted: boolean) {
  if (muted) {
    const [seen] = await tx.select({ id: clientKpis.id }).from(clientKpis).where(eq(clientKpis.id, kpiId));
    if (!seen) throw new NotFoundError("indicator");
    await tx.insert(mailKpiMutes).values({ userId: principal.userId, kpiId }).onConflictDoNothing();
  } else {
    await tx.delete(mailKpiMutes).where(and(eq(mailKpiMutes.userId, principal.userId), eq(mailKpiMutes.kpiId, kpiId)));
  }
  return { muted };
}

/**
 * Whether the caller is among the people told when this indicator moves away
 * (the client's lead and deputy, the client's admins: app_kpi_tells_me()),
 * and whether they muted its mail. The indicator page offers the mute to them only.
 */
export async function indicatorMail(tx: Tx, principal: Principal, kpiId: string) {
  const { rows } = await tx.execute<{ told: boolean; muted: boolean }>(sql`
    select app_kpi_tells_me(${kpiId}::uuid) as told,
      exists (select 1 from mail_kpi_mutes m where m.user_id = ${principal.userId}::uuid and m.kpi_id = ${kpiId}::uuid) as muted`);
  return { told: !!rows[0]?.told, muted: !!rows[0]?.muted };
}
