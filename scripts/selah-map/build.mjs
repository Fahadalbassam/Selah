#!/usr/bin/env node
// Builds docs/selah-map.html from docs/system-map.md.
//   node scripts/selah-map/build.mjs                      check paths against the working tree (git ls-files), write the map
//   node scripts/selah-map/build.mjs --ref origin/main    check against a git ref instead
//   node scripts/selah-map/build.mjs --check              check only, write nothing
// Exits 1 (and lists them) when a backticked path in system-map.md does not exist, or the file breaks its format.
// Plain Node, no dependencies. The map data is embedded as JSON; all JS and CSS are inline; nothing is fetched.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { AR } from './arabic.mjs';

// Known gaps found by the scenario runs, by feature id (ids G01..G69 are in docs/team/gaps-and-priorities.md).
// Short on purpose: the full list, the type, the seriousness and the fix are in that file.
const GAPS_DOC = 'docs/team/gaps-and-priorities.md';
const GAPS = {
  F01: { ids: 'G04, G13, G24, G29, G62', en: 'the erasure reason is shown to the client admin; a refused e-mail domain gets the wrong reason; the access review refuses in English; the invitation mail names neither firm nor inviter.', ar: 'سبب المحو يظهر لمسؤول العميل؛ نطاق البريد المرفوض يُعلَّل خطأً؛ مراجعة الصلاحيات ترفض بالإنجليزية؛ بريد الدعوة لا يذكر المكتب ولا الداعي.' },
  F02: { ids: 'G06, G07', en: 'the isolation sweep (scenario 19) is not finished; "Not found" pages answer HTTP 200 (no leak: a forbidden record and a made-up id look the same; it only blocks scripted sweeps).', ar: 'فحص العزل (السيناريو 19) لم يكتمل؛ صفحات «غير موجود» تردّ بالرمز 200 (دون تسريب: السجل الممنوع والرقم المختلق متطابقان؛ يعيق الفحص الآلي فقط).' },
  F04: { ids: 'G15, G18, G50', en: 'the client is not told on screen when the consultant changes; join requests are approved or declined with no confirm and no reason; "Make lead" is hidden in a menu.', ar: 'لا يُبلَّغ العميل على الشاشة بتغيير المستشار؛ طلبات الانضمام تُقبل أو تُرفض دون تأكيد أو سبب؛ «اجعله القائد» مخفي في قائمة.' },
  F07: { ids: 'G21', en: 'the firm is not told when the client confirms receipt of a deliverable.', ar: 'لا يُبلَّغ المكتب حين يؤكد العميل استلام مخرَج.' },
  F08: { ids: 'G28, G48, G49, G57', en: 'the conflict dialog defaults to "conflict"; the owner dialog skips the suggestions; dates cannot be typed; nothing says the decline mail went.', ar: 'حوار التعارض يبدأ بـ«يوجد تعارض»؛ حوار المسؤول يتجاهل المقترحين؛ لا يمكن كتابة التواريخ؛ لا شيء يؤكد إرسال رسالة الاعتذار.' },
  F09: { ids: 'G30, G40, G53', en: '"Release now" is on by default; draft actions are not marked on the plan list; the import does not say what it created.', ar: 'خيار «أسند الآن» مفعّل افتراضيًا؛ الإجراءات المسودة غير موسومة في الخطة؛ الاستيراد لا يذكر ما أنشأه.' },
  F10: { ids: 'G16, G17, G44, G45, G46, G52, G58', en: 'an owner change tells only the new owner; declining a date request has no reason; accepting an item and signing off are two steps with an English message.', ar: 'تغيير المسؤول يُبلَّغ به الجديد فقط؛ رفض طلب الموعد بلا سبب؛ قبول البند والاعتماد خطوتان برسالة بالإنجليزية.' },
  F12: { ids: 'G05, G55', en: 'PRIVACY: a new file version keeps the "let the assistant read it" flag (a real bypass: the uploader-or-admin rule fires only on UPDATE, so a staffed consultant or client manager can put new content into the assistant without consent); it also takes the new file name.', ar: 'خصوصية: النسخة الجديدة من الملف تُبقي تفعيل قراءة المساعد (التفاف فعلي: قاعدة «صاحب الرفع أو المدير» تعمل عند التعديل فقط، فيستطيع مستشار أو مدير عميل إدخال محتوى جديد للمساعد دون موافقة)؛ وتأخذ اسم الملف الجديد.' },
  F14: { ids: 'G01, G26', en: 'meeting decisions and follow-ups start shared with the client (the summary starts firm-only); a department-limited manager sees "none for you yet" for meetings she is invited to.', ar: 'القرارات والمتابعات تبدأ مشاركة مع العميل (الملخص يبدأ للمكتب فقط)؛ مدير مقيّد بإدارة يرى «لا شيء لك» رغم دعوته.' },
  F15: { ids: 'G20, G33', en: 'sending a report gives the client no notice; the PDF date can show the previous day.', ar: 'إرسال التقرير لا يُشعر العميل؛ تاريخ ملف PDF قد يظهر باليوم السابق.' },
  F16: { ids: 'G54, G56', en: 'the numbers-import button is hidden until a data mode is chosen; the mute-mail switch has no mail to silence (the notice is bell only).', ar: 'زر استيراد الأرقام مخفي حتى يُختار نمط البيانات؛ مفتاح كتم البريد بلا بريد (الإشعار داخل التطبيق فقط).' },
  F17: { ids: 'G12, G19, G41', en: 'sharing an assessment sends no notice and asks no confirm; finalising gives no list of open questions; consultant guidance reaches the client.', ar: 'مشاركة التقييم بلا إشعار أو تأكيد؛ الاعتماد لا يعدّد الأسئلة المفتوحة؛ إرشادات المستشار تصل للعميل.' },
  F18: { ids: 'G23, G32, G47', en: 'a reopened project sends the client admin no notice; the closure PDF total was off by one; "Start closing" is only in a menu.', ar: 'إعادة فتح المشروع لا تُشعر مدير العميل؛ مجموع تقرير الإغلاق ناقص بواحد؛ «بدء الإغلاق» في قائمة فقط.' },
  F19: { ids: 'G25', en: 'an archived client is offered reply buttons and a wrong refusal reason, and its sign-in message does not say what to do.', ar: 'العميل المؤرشف تُعرض له أزرار الرد ويُرفض بسبب خاطئ، ورسالة دخوله لا تقول ما العمل.' },
  F20: { ids: 'G37, G38', en: 'the draft from pasted text gave 0 units; the publish-id fix (#215) has not been re-run through scenario 20.', ar: 'المسودة من النص الملصوق أعطت صفر وحدات؛ لم يُعد اختبار إصلاح #215 في السيناريو 20.' },
  F21: { ids: 'G09, G27, G31, G34, G35, G36, G51, G65, G69', en: 'the progress draft disagrees with the project page; an unreadable attachment is answered as another file; a scanned page produced an invented answer; no answer could be produced on the last test copy.', ar: 'مسودة التقدم تخالف صفحة المشروع؛ المرفق غير المقروء يُجاب عنه كأنه ملف آخر؛ صفحة ممسوحة أنتجت إجابة مختلقة؛ تعذّر أي جواب في آخر نسخة اختبار.' },
  F22: { ids: 'G02, G03, G10, G66', en: 'the AI notice says clients have no assistant; the security page lists protections that are not set up; the legal texts are not lawyer-reviewed.', ar: 'إشعار الذكاء الاصطناعي يقول إن العملاء بلا مساعد؛ صفحة الأمان تذكر حمايات غير مُعدّة؛ لم تراجع النصوص القانونية محامٍ.' },
  F23: { ids: 'G22, G62', en: 'a held work mail shows no sign on the notice; mails for English readers are Arabic first.', ar: 'البريد المؤجل لا علامة عليه في الإشعار؛ رسائل القرّاء الإنجليز تبدأ بالعربية.' },
  F24: { ids: 'G08, G14, G68', en: 'a broken audit chain tells nobody; old rows keep some private file names until the clean-up script runs; the CSV time is UTC.', ar: 'انكسار سلسلة التدقيق لا يُبلغ أحدًا؛ صفوف قديمة تحمل أسماء ملفات خاصة حتى يعمل سكربت التنظيف؛ وقت ملف CSV بالتوقيت العالمي.' },
  F26: { ids: 'G08', en: 'written and tested but not run: run it once before go-live.', ar: 'مكتوب ومُختبَر لكنه لم يُشغَّل: يُشغَّل مرة قبل الإطلاق.' },
  F27: { ids: 'G43, G61', en: 'a refused retention setting says "refused by a data rule" in English and names no field.', ar: 'إعداد الاحتفاظ المرفوض يقول «refused by a data rule» بالإنجليزية دون تسمية الحقل.' },
  F29: { ids: 'G32, G39', en: 'an export asked for in English from an Arabic screen keeps Arabic headers.', ar: 'تصدير مطلوب بالإنجليزية من شاشة عربية يبقي العناوين بالعربية.' },
  F30: { ids: 'G11, G59, G67', en: 'go-live items are open (sending domain, second backup disk, restore drill, outside test); dialogs ignore early clicks.', ar: 'بنود الإطلاق مفتوحة (نطاق الإرسال، قرص النسخ الثاني، تمرين الاستعادة، اختبار خارجي)؛ الحوارات تتجاهل النقرات المبكرة.' },
};

const here = path.dirname(fileURLToPath(import.meta.url));
const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: here, encoding: 'utf8' }).trim();
const args = process.argv.slice(2);
const refIdx = args.indexOf('--ref');
const ref = refIdx >= 0 ? args[refIdx + 1] : null;
const checkOnly = args.includes('--check');
const src = path.join(root, 'docs', 'system-map.md');
const out = path.join(root, 'docs', 'selah-map.html');

// ---- repo file list ----
const git = (a) => execFileSync('git', a, { cwd: root, encoding: 'utf8', maxBuffer: 1 << 28 });
const files = new Set((ref ? git(['ls-tree', '-r', '--name-only', ref]) : git(['ls-files'])).split('\n').filter(Boolean));
const dirs = new Set();
for (const f of files) {
  let d = path.posix.dirname(f);
  while (d && d !== '.' && !dirs.has(d)) { dirs.add(d); d = path.posix.dirname(d); }
}
const exists = (p) => files.has(p) || dirs.has(p.replace(/\/$/, ''));

// ---- parse ----
const text = fs.readFileSync(src, 'utf8');
const lines = text.split('\n');
const problems = [];
const missing = new Map(); // path -> where
const note = (msg) => problems.push(msg);
const LISTS = ['pages', 'components', 'api', 'services', 'lib', 'jobs', 'migrations', 'tests', 'docs', 'extra_files'];
const KEYS = ['id', 'kind', 'parent', 'summary', 'roles', 'risk', 'pages', 'components', 'api', 'services', 'lib', 'jobs', 'db_tables', 'migrations', 'policy', 'tests', 'docs', 'extra_files'];
const LINK_KINDS = ['data', 'permission', 'AI call', 'job', 'scan', 'shared file'];
const RISKS = ['privacy', 'permissions', 'ai', 'migration'];
const ticks = (s) => [...s.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
const checkPath = (p, where) => {
  if (!exists(p)) { if (!missing.has(p)) missing.set(p, []); missing.get(p).push(where); }
};

const nodes = [];
let cur = null;
for (let i = 0; i < lines.length; i++) {
  const ln = lines[i];
  const h = ln.match(/^(##|###) (F\d+(?:\.\d+)?) (.+)$/);
  if (h) { cur = { id: h[2], name: h[3].trim(), line: i + 1, fields: {}, links: [] }; nodes.push(cur); continue; }
  if (/^## /.test(ln)) { cur = null; continue; }
  if (!cur) continue;
  const b = ln.match(/^- ([a-z_]+): ?(.*)$/);
  if (!b) continue;
  const [, key, val] = b;
  if (key === 'link') {
    const parts = val.split(' | ');
    if (parts.length < 4) { note(`${cur.id} (line ${i + 1}): link needs 'to | kind | files | what flows'`); continue; }
    const [to, kind, f, ...flow] = parts;
    const fl = ticks(f);
    fl.forEach((p) => checkPath(p, `${cur.id} link to ${to.trim()}`));
    cur.links.push({ to: to.trim(), kind: kind.trim(), files: fl, flow: flow.join(' | ').trim() });
  } else {
    cur.fields[key] = val.trim();
  }
}

// ---- validate nodes ----
const byId = new Map(nodes.map((n) => [n.id, n]));
if (byId.size !== nodes.length) note('duplicate feature ids');
const outNodes = [];
for (const n of nodes) {
  const f = n.fields;
  for (const k of KEYS) if (!(k in f)) note(`${n.id} (line ${n.line}): missing bullet '${k}'`);
  if (f.id !== n.id) note(`${n.id}: id bullet says '${f.id}'`);
  if (!['feature', 'sub-feature'].includes(f.kind)) note(`${n.id}: kind must be feature or sub-feature`);
  if (f.parent && f.parent !== 'none' && !byId.has(f.parent)) note(`${n.id}: parent ${f.parent} not found`);
  const risk = (f.risk || '').split(',').map((s) => s.trim()).filter((s) => s && s !== 'none');
  risk.forEach((r) => { if (!RISKS.includes(r)) note(`${n.id}: unknown risk '${r}'`); });
  const lists = {};
  for (const k of LISTS) {
    const v = f[k] ?? '';
    if (v === 'none' || v === '') { lists[k] = []; continue; }
    lists[k] = ticks(v).filter((t) => t.includes('/'));
    ticks(v).filter((t) => !t.includes('/')).forEach((t) => {
      if (/^[\w.\-]+\.(ts|tsx|json|md|yml|yaml|sh|mjs|py|txt|sql|css)$/.test(t)) lists[k].push(t);
      else note(`${n.id}: '${t}' in ${k} is not a path`);
    });
    lists[k].forEach((p) => checkPath(p, `${n.id} ${k}`));
  }
  const tables = f.db_tables && f.db_tables !== 'none' ? ticks(f.db_tables) : [];
  const policy = f.policy && f.policy !== 'none' ? ticks(f.policy) : [];
  for (const l of n.links) {
    if (!byId.has(l.to)) note(`${n.id}: link to unknown ${l.to}`);
    if (!LINK_KINDS.includes(l.kind)) note(`${n.id}: link kind '${l.kind}' is not one of ${LINK_KINDS.join(', ')}`);
  }
  const ar = AR[n.id];
  if (!ar) note(`${n.id}: no Arabic entry in scripts/selah-map/arabic.mjs`);
  outNodes.push({
    id: n.id, kind: f.kind, parent: f.parent === 'none' ? null : f.parent,
    name: { en: n.name, ar: ar ? ar[0] : n.name },
    summary: { en: f.summary, ar: ar ? ar[1] : f.summary },
    roles: f.roles, risk, lists, tables, policy,
    gaps: GAPS[n.id] || null,
    links: n.links.map((l) => ({ to: l.to, kind: l.kind, files: l.files, flow: l.flow })),
  });
}

// known-gaps notes: the file they point to must exist, and so must every feature they name
// (a document of this branch, so it is checked in the working tree like the rule docs, even with --ref)
if (!fs.existsSync(path.join(root, GAPS_DOC))) checkPath(GAPS_DOC + ' (working tree)', 'known-gaps notes on the map');
for (const id of Object.keys(GAPS)) if (!byId.has(id)) note(`GAPS names unknown feature ${id}`);

// ---- tables after the features ----
const shared = [];
const changes = [];
let sec = '';
for (let i = 0; i < lines.length; i++) {
  const ln = lines[i];
  if (/^## /.test(ln)) sec = ln;
  if (!ln.startsWith('|')) continue;
  const cells = ln.split('|').slice(1, -1).map((c) => c.trim());
  if (/^-+$/.test(cells[0]) || cells[0] === 'file' || cells[0] === 'change') continue;
  if (sec.startsWith('## Shared files')) {
    const p = ticks(cells[0])[0];
    if (!p) { note(`shared files table line ${i + 1}: no path`); continue; }
    checkPath(p, 'shared files table');
    const fs_ = cells[1].split(',').map((s) => s.trim()).filter(Boolean);
    fs_.forEach((id) => { if (!byId.has(id)) note(`shared files line ${i + 1}: unknown feature ${id}`); });
    shared.push({ file: p, features: fs_, count: Number(cells[2]) || 0 });
  } else if (sec.startsWith('## If you change')) {
    ticks(cells[0])
      .filter((x) => x.includes('/') && /^(apps|docs|services|ops|scripts|db)\//.test(x) && /^[\w@.\-/()[\]]+\.[a-z]+$/.test(x))
      .forEach((x) => checkPath(x, 'if-you-change table'));
    changes.push({ change: cells[0].replace(/`/g, ''), also: cells[1] });
  }
}

// docs the map points to
const RULE_DOCS = ['CLAUDE.md', 'docs/rules.md', 'docs/ui-guidelines.md', 'docs/authorization.md', 'docs/assistant.md', 'docs/security.md', 'docs/data-architecture.md', 'docs/handoff.md', 'docs/operations.md', 'docs/system-map.md'];
// these are docs of this branch, so they are checked in the working tree even with --ref
RULE_DOCS.forEach((p) => { if (!fs.existsSync(path.join(root, p))) checkPath(p + ' (working tree)', 'rule links of the map'); });

// notes (not failures): policy entries the map names
const warnings = [];
const polFile = path.join(root, 'apps/web/src/authz/policy.ts');
if (!ref && fs.existsSync(polFile)) {
  const pol = fs.readFileSync(polFile, 'utf8');
  for (const n of outNodes) for (const p of n.policy) if (!p.startsWith('(') && !pol.includes(p)) warnings.push(`${n.id}: policy entry '${p}' not found in policy.ts`);
}

if (!outNodes.length) note('no features found: is docs/system-map.md in the expected format?');
if (missing.size || problems.length) {
  console.error('selah-map: docs/system-map.md does not match the repo.\n');
  if (missing.size) {
    console.error(`${missing.size} path(s) do not exist${ref ? ' in ' + ref : ''}:`);
    for (const [p, w] of missing) console.error(`  ${p}   (${[...new Set(w)].slice(0, 3).join('; ')})`);
  }
  if (problems.length) { console.error('\nFormat problems:'); problems.forEach((p) => console.error('  ' + p)); }
  console.error('\nFix docs/system-map.md and run again.');
  process.exit(1);
}
warnings.forEach((w) => console.warn('warning: ' + w));

const linkCount = outNodes.reduce((s, n) => s + n.links.length, 0);
console.log(`selah-map: ok. ${outNodes.filter((n) => n.kind === 'feature').length} features, ${outNodes.filter((n) => n.kind === 'sub-feature').length} sub-features, ${linkCount} links, ${shared.length} shared files; all paths exist${ref ? ' in ' + ref : ''}.`);
if (checkOnly) process.exit(0);

let commit = '';
try { commit = git(['rev-parse', '--short', ref || 'HEAD']).trim(); } catch { /* ignore */ }
const statusLine = (lines.find((l) => l.startsWith('> **Status')) || '').replace(/^> /, '').replace(/\*\*/g, '').replace(/`/g, '');
const data = { generatedFrom: 'docs/system-map.md', commit, status: statusLine, nodes: outNodes, shared, changes, ruleDocs: RULE_DOCS };
const tpl = fs.readFileSync(path.join(here, 'template.html'), 'utf8');
if (!tpl.includes('/*__DATA__*/null')) { console.error('template.html has no /*__DATA__*/null marker'); process.exit(1); }
// "<" is escaped so the JSON can never close the script tag
const BS = String.fromCharCode(92);
const json = JSON.stringify(data).split("<").join(BS + "u003c").split(String.fromCharCode(8232)).join(BS + "u2028").split(String.fromCharCode(8233)).join(BS + "u2029");
fs.writeFileSync(out, tpl.replace('/*__DATA__*/null', () => json));
console.log(`wrote ${path.relative(root, out)} (${(fs.statSync(out).size / 1024).toFixed(0)} KB)`);
