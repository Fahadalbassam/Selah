// The mail sender. Runs as the schema owner (outbound_emails is not
// reachable from the app role). Each run claims due rows with SKIP LOCKED,
// so two senders never send the same mail; a claim lasts 10 minutes, so a
// sender that dies mid-run leaves its rows to be tried again.
import { buildIcs } from "../lib/ics";
import { MAX_ATTEMPTS, renderMail, retryDelayMinutes, type MailKind } from "../lib/mail-templates";

interface Queryable {
  query<R = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: R[] }>;
}

export interface OutgoingMail {
  to: string;
  subject: string;
  text: string;
  html: string;
  /** A calendar invite or cancellation (RFC 5546 method in the content). */
  icalEvent?: { method: "REQUEST" | "CANCEL"; content: string };
}

/** Delivers one mail or throws. Wraps nodemailer in scripts/send-mail.ts; tests pass a fake. */
export type Deliver = (mail: OutgoingMail) => Promise<void>;

interface Row {
  id: string;
  to_email: string;
  kind: MailKind;
  link: string | null;
  meeting_id: string | null;
  attempts: number;
}

export interface MailRunResult {
  sent: number;
  failed: number;
}

export async function runMail(db: Queryable, deliver: Deliver, appUrl: string, batch = 20): Promise<MailRunResult> {
  const { rows } = await db.query<Row>(
    `UPDATE outbound_emails SET attempts = attempts + 1, next_attempt_at = now() + interval '10 minutes'
     WHERE id IN (
       SELECT id FROM outbound_emails
       WHERE sent_at IS NULL AND failed_at IS NULL AND (next_attempt_at IS NULL OR next_attempt_at <= now())
       ORDER BY created_at LIMIT $1 FOR UPDATE SKIP LOCKED
     )
     RETURNING id, to_email, kind, link, meeting_id, attempts`,
    [batch],
  );

  const result: MailRunResult = { sent: 0, failed: 0 };
  for (const row of rows) {
    try {
      const mail: OutgoingMail = { to: row.to_email, ...renderMail(row.kind, row.link, appUrl) };
      if (row.meeting_id) {
        const ics = await meetingIcs(db, row.meeting_id);
        if (ics) mail.icalEvent = ics;
      }
      await deliver(mail);
      await db.query(`UPDATE outbound_emails SET sent_at = now(), link = NULL, last_error = NULL WHERE id = $1`, [row.id]);
      result.sent++;
    } catch (err) {
      const message = (err instanceof Error ? err.message : String(err)).slice(0, 500);
      const giveUp = row.attempts >= MAX_ATTEMPTS;
      await db.query(
        `UPDATE outbound_emails SET last_error = $2,
           next_attempt_at = now() + make_interval(mins => $3::int),
           failed_at = CASE WHEN $4::boolean THEN now() END
         WHERE id = $1`,
        [row.id, message, retryDelayMinutes(row.attempts), giveUp],
      );
      result.failed++;
    }
  }
  return result;
}

// The invite as it stands when the mail goes out, so a meeting moved after
// the invite was queued goes out with its new time.
async function meetingIcs(db: Queryable, meetingId: string): Promise<OutgoingMail["icalEvent"] | null> {
  const { rows } = await db.query<{
    ics_uid: string;
    ics_sequence: number;
    status: "scheduled" | "held" | "cancelled";
    title: string;
    starts_at: Date;
    ends_at: Date;
    join_url: string | null;
    location_text: string | null;
    updated_at: Date;
    organizer_id: string;
    organizer_name: string;
    organizer_email: string;
  }>(
    `SELECT m.ics_uid, m.ics_sequence, m.status, m.title, m.starts_at, m.ends_at, m.join_url, m.location_text, m.updated_at,
            m.organizer_id, u.name AS organizer_name, u.email AS organizer_email
     FROM meetings m JOIN "user" u ON u.id = m.organizer_id WHERE m.id = $1`,
    [meetingId],
  );
  const m = rows[0];
  if (!m) return null;
  const attendees = await db.query<{ name: string; email: string | null; role: string; user_id: string | null }>(
    `SELECT coalesce(u.name, c.name) AS name, coalesce(u.email, c.email) AS email, a.role, a.user_id
     FROM meeting_attendees a LEFT JOIN "user" u ON u.id = a.user_id LEFT JOIN client_contacts c ON c.id = a.contact_id
     WHERE a.meeting_id = $1`,
    [meetingId],
  );
  const content = buildIcs({
    uid: m.ics_uid,
    sequence: m.ics_sequence,
    status: m.status,
    title: m.title,
    startsAt: m.starts_at,
    endsAt: m.ends_at,
    joinUrl: m.join_url,
    locationText: m.location_text,
    organizer: { name: m.organizer_name, email: m.organizer_email },
    attendees: attendees.rows
      .filter((a) => a.email && a.user_id !== m.organizer_id)
      .map((a) => ({ name: a.name, email: a.email!, optional: a.role === "optional" })),
    updatedAt: m.updated_at,
  });
  return { method: m.status === "cancelled" ? "CANCEL" : "REQUEST", content };
}
