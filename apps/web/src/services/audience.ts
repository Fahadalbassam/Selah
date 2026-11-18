import "server-only";
import { and, eq, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from "@/db/client";
import { itemAudiences } from "@/db/schema";
import { assertAllowed, type Principal, type Resource, type ResourceAudience } from "@/authz";
import {
  AUDIENCE_LOCK_REASONS,
  AUDIENCE_MODES,
  type AudienceItemKind,
  type AudienceLockReason,
  type AudienceMode,
  type AudiencePerson,
  type AudienceSide,
  type SavedAudience,
} from "@/lib/audience";
import { BadRequestError } from "@/server/errors";
import { audit } from "./audit";
import { loadProject } from "./staffing";

// Who sees an item (decision of 17 Nov 2026, feature A): "everyone with
// access, except…" or "only these people…", on documents (never evidence)
// and meetings. It can only take people away: the database ANDs it onto
// every other rule (restrictive policies and app_audience_ok(), migration
// 0111), authorize() asks it as its sixth question, and the people who always
// see an item are worked out by the database, live, never sent by the page.

/** An item's audience as the picker gets it, for the people who may change it. */
export interface ItemAudience {
  kind: AudienceItemKind;
  /** Whose item it is: on the client's own, its admin leaves out its own people only. */
  owner: AudienceSide;
  mode: AudienceMode;
  /** Everyone who can already see the item (nobody else can be picked), firm first. */
  people: AudiencePerson[];
  /** Left out ("except"), or who sees it ("only": the locked people first). */
  selected: string[];
}

/** What a form sends: nothing (everyone with access), or a mode and people. */
export type AudienceInput = { mode: AudienceMode; people: string[] };

/** The request body for an audience, in every route that takes one. */
export const audienceInput = z.object({ mode: z.enum(AUDIENCE_MODES), people: z.array(z.uuid()).max(500) });

/** The same, sent as one text field of a multipart form (a file upload). */
export const audienceField = z
  .string()
  .max(40_000)
  .optional()
  .transform((s, ctx) => {
    if (!s) return undefined;
    try {
      const parsed = audienceInput.safeParse(JSON.parse(s));
      if (parsed.success) return parsed.data;
    } catch {
      // falls through to the issue below
    }
    ctx.addIssue({ code: "custom", message: "invalid audience" });
    return z.NEVER;
  });

const LOCKS = new Set<string>(AUDIENCE_LOCK_REASONS);

export const uuidArray = (ids: readonly string[]): SQL =>
  ids.length ? sql`ARRAY[${sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `)}]` : sql`'{}'::uuid[]`;

/**
 * The caller's own part of each narrowed item among `ids`: the mode, and
 * whether the list names them or they always see it. Enough for authorize()
 * (which asks only about the person asking) and for the "Limited audience"
 * marker; never who else is on the list. Items with no audience are absent.
 */
export async function audiencesForMe(tx: Tx, principal: Principal, kind: AudienceItemKind, ids: readonly string[]) {
  const out = new Map<string, ResourceAudience>();
  if (!ids.length) return out;
  const { rows } = await tx.execute<{ item_id: string; mode: "except" | "only"; listed: boolean; locked: boolean }>(
    sql`select item_id, mode, listed, locked from app_audience_mine(${kind}, ${uuidArray([...new Set(ids)])})`,
  );
  for (const r of rows) {
    out.set(r.item_id, { mode: r.mode, people: r.listed ? [principal.userId] : [], locked: r.locked ? [principal.userId] : [] });
  }
  return out;
}

export const audienceOf = async (tx: Tx, principal: Principal, kind: AudienceItemKind, id: string) =>
  (await audiencesForMe(tx, principal, kind, [id])).get(id);

/** Whose item it is, from its resource: the client's own when the client's side owns it (a client upload, a meeting a client person booked). */
export const audienceOwner = (r: Resource): AudienceSide =>
  r.projectKind === "client" && r.ownerOrgId !== undefined && r.ownerOrgId === r.orgId ? "client" : "firm";

const permissionOf = (kind: AudienceItemKind) => (kind === "document" ? "document.audience" : "meeting.audience");

type PeopleRow = { user_id: string; name: string; firm: boolean; locked: string | null; listed?: boolean };

const toPerson = (r: PeopleRow): AudiencePerson => ({
  id: r.user_id,
  name: { ar: r.name, en: r.name },
  side: r.firm ? "firm" : "client",
  ...(r.locked && LOCKS.has(r.locked) ? { locked: r.locked as AudienceLockReason } : {}),
});

/**
 * The audience of an item the caller may change (404 for anyone else: a
 * client manager, an action owner, an observer, someone left out, and on
 * evidence). `asShared` lists the people as if the file were shared with the
 * client, for the firm choosing them while it shares a deliverable.
 */
export async function readAudience(
  tx: Tx,
  principal: Principal,
  kind: AudienceItemKind,
  id: string,
  resource: Resource,
  opts: { asShared?: boolean } = {},
): Promise<ItemAudience> {
  assertAllowed(principal, permissionOf(kind), resource);
  const vis = opts.asShared ? sql`'shared'::visibility` : sql`NULL::visibility`;
  const { rows } = await tx.execute<PeopleRow & { listed: boolean }>(
    sql`select user_id, name, firm, locked, listed from app_audience_people(${kind}, ${id}::uuid, ${vis})`,
  );
  const [row] = await tx
    .select({ mode: itemAudiences.mode })
    .from(itemAudiences)
    .where(and(eq(itemAudiences.itemType, kind), eq(itemAudiences.itemId, id)));
  const mode = (row?.mode as "except" | "only" | undefined) ?? "everyone";
  const people = rows.map(toPerson);
  const listed = rows.filter((r) => r.listed).map((r) => r.user_id);
  const locked = people.filter((p) => p.locked).map((p) => p.id);
  return {
    kind,
    owner: audienceOwner(resource),
    mode,
    people,
    selected: mode === "only" ? [...new Set([...locked, ...listed])] : mode === "except" ? listed : [],
  };
}

/**
 * The people a new item would be seen by, for the picker in the upload and
 * booking forms: worked out by the database from what the form says (the
 * project, the label, the department, who is invited). Saving checks again on
 * the item itself. Only for those who get the picker.
 */
export async function audiencePeopleForNew(
  tx: Tx,
  principal: Principal,
  kind: AudienceItemKind,
  projectResource: Resource,
  input: { visibility: "shared" | "firm_private" | "client_private"; departmentId?: string | null; attendees?: string[]; requestId?: string | null },
): Promise<{ owner: AudienceSide; people: AudiencePerson[] }> {
  const owner: AudienceSide = principal.orgKind === "client" ? "client" : "firm";
  assertAllowed(principal, permissionOf(kind), { ...projectResource, type: kind, ownerOrgId: principal.orgId, visibility: input.visibility });
  const { rows } = await tx.execute<PeopleRow>(
    sql`select user_id, name, firm, locked from app_audience_people_new(${kind}, ${projectResource.projectId}::uuid, ${input.visibility}::visibility,
      ${input.departmentId ?? null}::uuid, ${uuidArray(input.attendees ?? [])}, ${input.requestId ?? null}::uuid)`,
  );
  return { owner, people: rows.map(toPerson) };
}

/** The same, from the project's id (the upload and booking forms ask before the item exists). */
export async function newItemAudiencePeople(
  tx: Tx,
  principal: Principal,
  projectId: string,
  kind: AudienceItemKind,
  input: Parameters<typeof audiencePeopleForNew>[4],
) {
  const { resource } = await loadProject(tx, principal, projectId);
  return audiencePeopleForNew(tx, principal, kind, resource, input);
}

/** What to store for a form's value: none (everyone with access) or a mode and people. */
export function savedValue(input: AudienceInput | null | undefined): SavedAudience {
  if (!input || input.mode === "everyone") return null;
  return { mode: input.mode, people: [...new Set(input.people)] };
}

/**
 * Set, change or clear an item's audience, and audit it. The caller has
 * loaded the item under row-level security and checked it is theirs to
 * change. The database refuses (400, its own sentence): an "only" list with
 * nobody, a person who could not see the item, one of the firm's people on a
 * client's own item, leaving out someone who always sees it, a closed
 * project; and anyone who may not change it (404). Nobody is told: not the
 * people left out, and not, when it is opened up again, the people who were.
 */
export async function writeAudience(
  tx: Tx,
  principal: Principal,
  kind: AudienceItemKind,
  id: string,
  resource: Resource,
  input: AudienceInput,
  meta: Record<string, string | number | boolean | null> = {},
) {
  assertAllowed(principal, permissionOf(kind), resource);
  const value = savedValue(input);
  if (value?.mode === "only" && value.people.length === 0) throw new BadRequestError('an "only" list needs at least one person');
  const before = (await audienceOf(tx, principal, kind, id))?.mode ?? "everyone";
  // How many queued meeting mails were withdrawn because their addressee is now left out (kept, never sent).
  const { rows } = await tx.execute<{ withdrawn: number }>(
    sql`select app_set_audience(${kind}, ${id}::uuid, ${value?.mode ?? "everyone"}, ${uuidArray(value?.people ?? [])}) as withdrawn`,
  );
  await audit(tx, {
    actorId: principal.userId,
    orgId: principal.orgId,
    action: permissionOf(kind),
    resourceType: kind,
    resourceId: id,
    outcome: "allow",
    // Counts only: who was left out stays out of the log's details too.
    meta: { ...meta, from: before, to: value?.mode ?? "everyone", people: value?.people.length ?? 0, withdrawnMails: Number(rows[0]?.withdrawn ?? 0) },
  });
  return { mode: value?.mode ?? ("everyone" as const) };
}
