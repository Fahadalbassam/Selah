// Check the mail relay before relying on it: signs in to SMTP_URL, then
// sends each mail template (with dummy links) to one address and reports how
// long each took. Nothing is queued or read from the database.
// Usage: npm run mail:check -- you@example.com [kind ...]
import { randomBytes, randomUUID } from "node:crypto";
import type { OutgoingMail } from "../src/jobs/mail";
import { MAIL_KINDS, renderMail, type MailKind } from "../src/lib/mail-templates";
import { smtpTransport, toMessage } from "../src/lib/smtp";

const smtpUrl = process.env.SMTP_URL;
const from = process.env.MAIL_FROM;
const appUrl = process.env.APP_URL ?? "http://localhost:3000";
if (!smtpUrl || !from) throw new Error("SMTP_URL and MAIL_FROM must be set");
const [to, ...asked] = process.argv.slice(2);
if (!to?.includes("@")) throw new Error("usage: npm run mail:check -- you@example.com [kind ...]");
const unknown = asked.filter((k) => !(MAIL_KINDS as readonly string[]).includes(k));
if (unknown.length) throw new Error(`unknown kinds: ${unknown.join(", ")}`);

// Meeting mails need a meeting row for their .ics, so they are left out.
const DEFAULT: MailKind[] = [
  "invitation",
  "password_reset",
  "password_reset.notice",
  "action.assigned",
  "action.revision_requested",
  "action.verified_complete",
  "evidence.requested",
];
const token = () => randomBytes(32).toString("base64url");
const LINKS: Partial<Record<MailKind, string>> = {
  invitation: `/invite/${token()}`,
  password_reset: `/reset-password/${token()}`,
  "email_change.confirm": `/confirm-email/${token()}`,
  "access_review.due": "/team",
  "inquiry.new": `/inquiries/${randomUUID()}`,
};
const linkFor = (kind: MailKind) => LINKS[kind] ?? (kind.startsWith("action.") || kind === "evidence.requested" ? `/actions/${randomUUID()}` : null);

const transport = smtpTransport(smtpUrl);
const relay = new URL(smtpUrl);
let t = Date.now();
await transport.verify();
console.log(`signed in to ${relay.hostname}:${relay.port || "(default port)"} in ${Date.now() - t} ms`);

let failed = 0;
for (const kind of asked.length ? (asked as MailKind[]) : DEFAULT) {
  const mail: OutgoingMail = { to, ...renderMail(kind, linkFor(kind), appUrl) };
  t = Date.now();
  try {
    const info = await transport.sendMail(toMessage(mail, from));
    console.log(`${kind}: ${info.response} (${Date.now() - t} ms)`);
  } catch (err) {
    failed++;
    console.log(`${kind}: FAILED ${err instanceof Error ? err.message : err} (${Date.now() - t} ms)`);
  }
}
transport.close();
process.exitCode = failed ? 1 : 0;
