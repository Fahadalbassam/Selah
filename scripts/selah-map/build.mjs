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
    links: n.links.map((l) => ({ to: l.to, kind: l.kind, files: l.files, flow: l.flow })),
  });
}

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
