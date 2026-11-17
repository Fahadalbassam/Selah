// The mails behind the signed-out pages, as the recipient sees them: one
// picture per kind (link tokens masked), plus a search of every mail body in
// Mailpit for the name of a real consulting firm.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { MAIL, OUT, chromium } from "./lib.mjs";

const dir = join(OUT, "mails");
mkdirSync(dir, { recursive: true });
const list = (await (await fetch(`${MAIL}/api/v1/messages?limit=500`)).json()).messages;
const mask = (s) => s.replace(/(\/(?:reset-password|sign-in\/link|upload|invite|confirm-email)\/)[A-Za-z0-9_-]{16,}/g, "$1<token>");
const kinds = [
  ["sign-in-link", /رابط الدخول/],
  ["password-reset", /إعادة تعيين/],
  ["upload-link", /مطلوب منك مستند/],
  ["inquiry-received", /استلمنا طلبك/],
  ["meeting-invitation", /دعوة اجتماع/],
  ["invitation", /دعوة للانضمام/],
];
const notes = { total: list.length, subjects: {}, kinds: {}, nameSearch: {} };
for (const m of list) notes.subjects[m.Subject] = (notes.subjects[m.Subject] ?? 0) + 1;

const bodies = [];
for (const m of list) {
  const full = await (await fetch(`${MAIL}/api/v1/message/${m.ID}`)).json();
  bodies.push({ subject: full.Subject, to: full.To.map((t) => t.Address).join(","), from: `${full.From.Name} <${full.From.Address}>`, replyTo: full.ReplyTo, text: full.Text, html: full.HTML, attachments: (full.Attachments ?? []).map((a) => a.FileName) });
}
// The real firm's name is passed on the command line (--names a,b) so it is never written in this repository.
const real = (process.argv[process.argv.indexOf("--names") + 1] || "").split(",").filter(Boolean);
notes.nameSearch.realFirmNameHits = bodies.filter((b) => real.some((w) => (b.subject + b.text + b.html + b.from).toLowerCase().includes(w.toLowerCase()))).length;
notes.nameSearch.realFirmNamesSearched = real.length;
for (const word of ["Mizan", "ميزان", "Selah", "صلة"]) {
  notes.nameSearch[word] = bodies.filter((b) => (b.subject + b.text + b.html + b.from).toLowerCase().includes(word.toLowerCase())).length;
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 640, height: 500 } });
for (const [kind, re] of kinds) {
  const b = bodies.find((x) => re.test(x.subject));
  if (!b) { notes.kinds[kind] = "no such mail in the mailbox"; continue; }
  const head = `<div style="font:13px system-ui;padding:12px 24px;border-bottom:1px solid #ccc;background:#f4f4f4;direction:ltr"><div><b>From:</b> ${b.from.replace("<", "&lt;")}</div><div><b>Reply-To:</b> ${b.replyTo?.length ? b.replyTo.map((r) => r.Address).join(", ") : "(none)"}</div><div><b>Subject:</b> ${b.subject}</div>${b.attachments.length ? `<div><b>Attachment:</b> ${b.attachments.join(", ")}</div>` : ""}</div>`;
  await page.setContent(mask(b.html).replace("<body", `<body data-x`).replace(/(<body[^>]*>)/, `$1</div>`).replace("</div>", ""), { waitUntil: "load" });
  await page.evaluate((h) => document.body.insertAdjacentHTML("beforebegin", h), head);
  await page.screenshot({ path: join(dir, `${kind}.png`), fullPage: true });
  notes.kinds[kind] = { subject: b.subject, from: b.from, replyTo: b.replyTo?.length ? b.replyTo : "(none)", attachments: b.attachments, text: mask(b.text), buttons: (b.html.match(/<a /g) || []).length };
}
await browser.close();
writeFileSync(join(dir, "notes-mails.json"), JSON.stringify(notes, null, 2));
console.log(JSON.stringify(notes, null, 2));
