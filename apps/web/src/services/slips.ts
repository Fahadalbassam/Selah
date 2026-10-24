import "server-only";
import { alias } from "drizzle-orm/pg-core";
import { asc, eq, sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { actionDueChanges, user } from "@/db/schema";
import type { AgingBucket } from "@/lib/slips";

// Deadline slips and aging (F17). The database keeps every move of a
// released action's due date (migration action_due_changes) and decides who
// may move it later once it has moved twice (app_can_extend); these calls
// read it for the action's page.

/** Whether the caller may move the action's due date later now (the third extension needs the lead). */
export async function canExtend(tx: Tx, actionId: string) {
  const { rows } = await tx.execute<{ ok: boolean }>(sql`select app_can_extend(${actionId}::uuid) as ok`);
  return rows[0]?.ok === true;
}

/** Where an action stands against the date agreed at release, and every move of its date. */
export async function actionSlip(tx: Tx, projectId: string, actionId: string) {
  const { rows } = await tx.execute<{
    baseline_due_date: string | null;
    due_date: string | null;
    extensions: number;
    slip_days: number;
    days_late: number | null;
    bucket: AgingBucket | null;
  }>(sql`select baseline_due_date, due_date, extensions, slip_days, days_late, bucket from app_action_slips(${projectId}::uuid) where action_id = ${actionId}::uuid`);
  const changer = alias(user, "changer");
  const history = await tx
    .select({
      id: actionDueChanges.id,
      from: actionDueChanges.fromDate,
      to: actionDueChanges.toDate,
      by: changer.name,
      viaRequest: sql<boolean>`${actionDueChanges.requestId} is not null`,
      at: actionDueChanges.createdAt,
    })
    .from(actionDueChanges)
    .leftJoin(changer, eq(changer.id, actionDueChanges.changedBy))
    .where(eq(actionDueChanges.actionId, actionId))
    .orderBy(asc(actionDueChanges.createdAt));
  const r = rows[0];
  return {
    baseline: r?.baseline_due_date ?? null,
    extensions: Number(r?.extensions ?? 0),
    slipDays: Number(r?.slip_days ?? 0),
    daysLate: r?.days_late === null || r?.days_late === undefined ? null : Number(r.days_late),
    bucket: r?.bucket ?? null,
    history,
    canExtend: await canExtend(tx, actionId),
  };
}
