// The daily reminder and escalation run. It must connect as the schema
// owner: app_follow_ups_due() and follow_up_log are not reachable from the
// app role. Logging first (ON CONFLICT DO NOTHING) makes a second run on the
// same day, or two runs at once, send nothing twice.
//
// Email delivery is a later step; for now each recipient gets an in-app
// notification ("follow_up.due_soon.0", "follow_up.overdue.2", ...).
interface Queryable {
  query(sql: string, params?: unknown[]): Promise<{ rows: { sent: string }[] }>;
}

export async function runFollowUps(db: Queryable, today: string): Promise<number> {
  const { rows } = await db.query(
    `WITH due AS (SELECT * FROM app_follow_ups_due($1::date)),
     logged AS (
       INSERT INTO follow_up_log (action_id, kind, level, due_date, recipients)
       SELECT action_id, kind, level, due_date, recipients FROM due
       ON CONFLICT DO NOTHING
       RETURNING action_id, kind, level, recipients
     ),
     sent AS (
       INSERT INTO notifications (user_id, kind, entity_type, entity_id)
       SELECT r, 'follow_up.' || l.kind || '.' || l.level, 'action', l.action_id FROM logged l, unnest(l.recipients) r
       RETURNING 1
     )
     SELECT count(*) AS sent FROM sent`,
    [today],
  );
  return Number(rows[0]!.sent);
}
