// The alert job (R4), every jobs round. Asks the web app's readiness probe
// for its checks (with OPS_TOKEN), adds the owner-side ones (mail, audit
// chain), and alerts the firm's administrators when something starts
// failing, every six hours while it keeps failing, and when it recovers.
// Alerts go to OPS_ALERT_EMAIL through SMTP_URL directly (not the mail
// queue, which may be what is broken) and to OPS_ALERT_WEBHOOK if set
// (a POST with {"text": ...}, which Slack, Teams and ntfy accept).
// Usage: npm run job:ops-check
import { readFile, writeFile } from "node:fs/promises";
import { Pool } from "pg";
import { ownerChecks } from "../src/jobs/ops-check";
import {
  alertText,
  decideAlert,
  type AlertState,
  type Check,
} from "../src/lib/ops";
import { smtpTransport } from "../src/lib/smtp";

const {
  DATABASE_OWNER_URL,
  APP_URL = "",
  OPS_READY_URL = "http://web:3000/api/ready",
  OPS_TOKEN,
  OPS_ALERT_EMAIL,
  OPS_ALERT_WEBHOOK,
  OPS_STATE_FILE = "/tmp/selah-ops-state.json",
  SMTP_URL,
  MAIL_FROM,
} = process.env;
if (!DATABASE_OWNER_URL) throw new Error("DATABASE_OWNER_URL is not set");

const checks: Check[] = [];
try {
  const res = await fetch(OPS_READY_URL, {
    headers: OPS_TOKEN ? { authorization: `Bearer ${OPS_TOKEN}` } : {},
    signal: AbortSignal.timeout(15_000),
  });
  const body = (await res.json()) as { status: string; checks?: Check[] };
  if (body.checks) checks.push(...body.checks);
  else if (body.status !== "ok")
    checks.push({
      name: "web app",
      ok: false,
      critical: true,
      error: `status ${body.status} (set OPS_TOKEN for details)`,
    });
} catch (e) {
  checks.push({
    name: "web app",
    ok: false,
    critical: true,
    error: `no answer from ${OPS_READY_URL}: ${e instanceof Error ? e.message : e}`,
  });
}
const pool = new Pool({ connectionString: DATABASE_OWNER_URL, max: 1 });
try {
  checks.push(...(await ownerChecks(pool)));
} catch (e) {
  checks.push({
    name: "database (owner)",
    ok: false,
    critical: true,
    error: e instanceof Error ? e.message.slice(0, 120) : "failed",
  });
} finally {
  await pool.end().catch(() => {});
}

const failing = checks.filter((c) => !c.ok);
const saved = await readFile(OPS_STATE_FILE, "utf8")
  .then((t) => JSON.parse(t) as AlertState)
  .catch(() => null);
const decided = decideAlert(
  saved ?? { failing: [], alertedAt: null },
  failing.map((c) => c.name),
  Date.now(),
);
// The first round after the jobs start (the stack coming up) only takes note:
// what still fails a round later is alerted then.
const send = saved ? decided.send : null;
const next =
  saved || !decided.send ? decided.next : { ...decided.next, alertedAt: null };
await writeFile(OPS_STATE_FILE, JSON.stringify(next));
for (const c of failing)
  console.error(`ops-check: ${c.name} failing: ${c.error ?? "no answer"}`);

if (send) {
  const mail = alertText(
    send,
    next.failing,
    Object.fromEntries(failing.map((c) => [c.name, c.error ?? ""])),
    APP_URL,
  );
  let sent = false;
  if (OPS_ALERT_EMAIL && SMTP_URL) {
    await smtpTransport(SMTP_URL)
      .sendMail({
        from: MAIL_FROM ?? "Selah <no-reply@localhost>",
        to: OPS_ALERT_EMAIL,
        subject: mail.subject,
        text: mail.text,
      })
      .then(() => (sent = true))
      .catch((e) =>
        console.error(
          `ops-check: alert mail failed: ${e instanceof Error ? e.message : e}`,
        ),
      );
  }
  if (OPS_ALERT_WEBHOOK) {
    await fetch(OPS_ALERT_WEBHOOK, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: `${mail.subject}\n\n${mail.text}` }),
      signal: AbortSignal.timeout(15_000),
    })
      .then((r) => (sent ||= r.ok))
      .catch((e) =>
        console.error(
          `ops-check: alert webhook failed: ${e instanceof Error ? e.message : e}`,
        ),
      );
  }
  console.log(
    `ops-check: ${send} alert ${sent ? "sent" : "not sent (set OPS_ALERT_EMAIL or OPS_ALERT_WEBHOOK)"}`,
  );
}
