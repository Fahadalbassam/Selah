// The SMTP side of the mail sender, shared by the sender (scripts/send-mail.ts)
// and the relay check (scripts/mail-check.ts), so the check exercises exactly
// what the sender does.
import nodemailer, { type SendMailOptions } from "nodemailer";
import type { OutgoingMail } from "../jobs/mail";

/**
 * A transport for SMTP_URL, e.g. smtps://user:pass@mail.example.com:465.
 * Timeouts are short so a stuck relay fails the mail (and it is retried)
 * instead of holding the sender for nodemailer's default ten minutes.
 */
export function smtpTransport(smtpUrl: string) {
  return nodemailer.createTransport({
    url: smtpUrl,
    connectionTimeout: 20_000,
    greetingTimeout: 20_000,
    socketTimeout: 60_000,
  });
}

export function toMessage(mail: OutgoingMail, from: string): SendMailOptions {
  return {
    from,
    to: mail.to,
    subject: mail.subject,
    text: mail.text,
    html: mail.html,
    ...(mail.icalEvent
      ? { icalEvent: { method: mail.icalEvent.method, content: mail.icalEvent.content, filename: "invite.ics" } }
      : {}),
  };
}
