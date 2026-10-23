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
       RETURNING 1
     ),
     mailed AS (
       INSERT INTO outbound_emails (to_email, kind, link)
       SELECT u.email, 'follow_up.digest', '/notifications'
       FROM (SELECT DISTINCT r FROM logged l, unnest(l.recipients) r) x
       JOIN "user" u ON u.id = x.r
       WHERE app_can_reset_password(x.r)
         AND coalesce((SELECT p.follow_up_digest FROM mail_preferences p WHERE p.user_id = x.r), true)
         AND NOT EXISTS (
           SELECT 1 FROM outbound_emails o
           WHERE o.kind = 'follow_up.digest' AND lower(o.to_email) = lower(u.email) AND app_firm_date(o.created_at) = app_firm_today()
         )
       RETURNING 1
     )
     SELECT (SELECT count(*) FROM sent) AS sent, (SELECT count(*) FROM mailed) AS mailed`,
    [today],
  );
  return { sent: Number(rows[0]!.sent), mailed: Number(rows[0]!.mailed) };
}
