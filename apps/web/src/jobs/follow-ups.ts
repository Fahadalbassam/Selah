// The daily reminder and escalation run. It must connect as the schema
// owner: app_follow_ups_due(), app_queue_digests() and follow_up_log are not
// reachable from the app role. Logging first (ON CONFLICT DO NOTHING) makes a
// second run on the same day, or two runs at once, send nothing twice.
//
// Each recipient gets an in-app notification ("follow_up.due_soon.0",
// "follow_up.overdue.2", ...). Information requests still waiting on the
// client are reminded the same way (app_info_requests_due(),
// info_request_reminders): one notification per person, project and kind
// ("info_request.overdue"), however many items.
//
// Then app_queue_digests() (migration 0019) queues the summary mail, which
// only says there is something new and links to the notifications page:
// daily or on Sunday by each person's choice, for reminders and for updates
// they batch, never about a muted action, at most one a day (the firm's real
// day, even when the job is run for another date). It skips anyone switched
// off or erased. The mail itself waits for the person's next sending time
// (quiet hours, Friday, Ramadan hours).
interface Queryable {
  query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}

export async function runFollowUps(db: Queryable, today: string): Promise<{ sent: number; mailed: number }> {
  const { rows } = await db.query(
    `WITH due AS (SELECT * FROM app_follow_ups_due($1::date)),
     logged AS (
       INSERT INTO follow_up_log (action_id, kind, level, due_date, recipients)
       SELECT action_id, kind, level, due_date, recipients FROM due
       ON CONFLICT DO NOTHING
       RETURNING action_id, kind, level, recipients
     ),
     -- One about an action the recipient can't see is dropped by the database (0006).
     sent AS (
       INSERT INTO notifications (user_id, kind, entity_type, entity_id)
       SELECT r, 'follow_up.' || l.kind || '.' || l.level, 'action', l.action_id FROM logged l, unnest(l.recipients) r
       RETURNING user_id
     ),
     ir_due AS (SELECT * FROM app_info_requests_due($1::date)),
     ir_logged AS (
       INSERT INTO info_request_reminders (request_id, kind, level, due_date, recipients)
       SELECT request_id, kind, level, due_date, recipients FROM ir_due
       ON CONFLICT DO NOTHING
       RETURNING request_id, kind, recipients
     ),
     ir_sent AS (
       INSERT INTO notifications (user_id, kind, entity_type, entity_id)
       SELECT DISTINCT r, 'info_request.' || l.kind, 'project', q.project_id
       FROM ir_logged l JOIN info_requests q ON q.id = l.request_id, unnest(l.recipients) r
       RETURNING user_id
     )
     SELECT (SELECT count(*) FROM sent) + (SELECT count(*) FROM ir_sent) AS sent`,
    [today],
  );
  const mailed = await db.query(`SELECT app_queue_digests($1::date) AS mailed`, [today]);
  return { sent: Number(rows[0]!.sent), mailed: Number(mailed.rows[0]!.mailed) };
}
