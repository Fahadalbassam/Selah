// The daily reminder and escalation run. It must connect as the schema
// owner: app_follow_ups_due() and follow_up_log are not reachable from the
// app role. Logging first (ON CONFLICT DO NOTHING) makes a second run on the
// same day, or two runs at once, send nothing twice.
//
// Each recipient gets an in-app notification ("follow_up.due_soon.0",
// "follow_up.overdue.2", ...), and one summary mail a day that only says there
// are reminders and links to the notifications page. "A day" is the firm's
// real day, even when the job is run for another date, so a re-run never mails
// twice. The mail skips anyone switched off or erased, and anyone who turned
// it off (mail_preferences).
//
// Information requests still waiting on the client are reminded the same way
// (app_info_requests_due(), info_request_reminders): one notification per
// person, project and kind ("info_request.overdue"), however many items, and
// the same single summary mail.
interface Queryable {
  query(sql: string, params?: unknown[]): Promise<{ rows: { sent: string; mailed: string }[] }>;
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
     ),
     -- Only people who got a notification: one about an action they can't
     -- see is dropped by the database (0006), and so is its mail.
     mailed AS (
       INSERT INTO outbound_emails (to_email, kind, link)
       SELECT u.email, 'follow_up.digest', '/notifications'
       FROM (SELECT user_id AS r FROM sent UNION SELECT user_id FROM ir_sent) x
       JOIN "user" u ON u.id = x.r
       WHERE app_can_reset_password(x.r)
         AND coalesce((SELECT p.follow_up_digest FROM mail_preferences p WHERE p.user_id = x.r), true)
         AND NOT EXISTS (
           SELECT 1 FROM outbound_emails o
           WHERE o.kind = 'follow_up.digest' AND lower(o.to_email) = lower(u.email) AND app_firm_date(o.created_at) = app_firm_today()
         )
       RETURNING 1
     )
     SELECT (SELECT count(*) FROM sent) + (SELECT count(*) FROM ir_sent) AS sent, (SELECT count(*) FROM mailed) AS mailed`,
    [today],
  );
  return { sent: Number(rows[0]!.sent), mailed: Number(rows[0]!.mailed) };
}
