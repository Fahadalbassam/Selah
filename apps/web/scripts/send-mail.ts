// Send queued mail. Run as the schema owner, either once (from cron) or as a
// long-running service with --watch, which wakes on every new mail and also
// checks every 30 seconds for retries.
// Usage: npm run job:mail [-- --watch]
//
// SMTP_URL is the server's mail relay, e.g. smtps://user:pass@mail.example.com:465.
// MAIL_FROM is the sender address, e.g. "Selah <no-reply@example.com>".
// Without SMTP_URL (development only) mails are printed instead of sent.
import nodemailer from "nodemailer";
import { Client, Pool } from "pg";
import { runMail, type Deliver } from "../src/jobs/mail";

const url = process.env.DATABASE_OWNER_URL;
const appUrl = process.env.APP_URL;
if (!url) throw new Error("DATABASE_OWNER_URL is not set");
if (!appUrl) throw new Error("APP_URL is not set");
const smtpUrl = process.env.SMTP_URL;
const from = process.env.MAIL_FROM;
if (process.env.NODE_ENV === "production" && (!smtpUrl || !from))
  throw new Error("SMTP_URL and MAIL_FROM are required in production");

const transport = smtpUrl ? nodemailer.createTransport(smtpUrl) : nodemailer.createTransport({ jsonTransport: true });
const deliver: Deliver = async (mail) => {
  const info = await transport.sendMail({
    from: from ?? "Selah <no-reply@localhost>",
    to: mail.to,
    subject: mail.subject,
    text: mail.text,
    html: mail.html,
    ...(mail.icalEvent
      ? { icalEvent: { method: mail.icalEvent.method, content: mail.icalEvent.content, filename: "invite.ics" } }
      : {}),
  });
  if (!smtpUrl) console.log(`[not sent, no SMTP_URL] ${mail.to}: ${mail.subject}\n${mail.text}`);
  else if (info.rejected?.length) throw new Error(`rejected: ${info.rejected.join(", ")}`);
};

const pool = new Pool({ connectionString: url, max: 2 });

async function drain() {
  for (;;) {
    const { sent, failed } = await runMail(pool, deliver, appUrl!);
    if (sent || failed) console.log(`mail: ${sent} sent, ${failed} to retry`);
    if (sent + failed < 20) return;
  }
}

if (!process.argv.includes("--watch")) {
  await drain();
  await pool.end();
} else {
  const listener = new Client({ connectionString: url });
  await listener.connect();
  let wake: (() => void) | null = null;
  listener.on("notification", () => wake?.());
  await listener.query("LISTEN outbound_email");
  const stop = async () => {
    await listener.end();
    await pool.end();
    process.exit(0);
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
  for (;;) {
    try {
      await drain();
    } catch (err) {
      console.error("mail:", err instanceof Error ? err.message : err);
    }
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 30_000);
      wake = () => {
        clearTimeout(timer);
        resolve();
      };
    });
    wake = null;
  }
}
