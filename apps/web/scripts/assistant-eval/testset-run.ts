// Scores the labelled test set (section 7 item 7) on the real pipeline, as
// each seeded consultant: prepareAsk() (permissions, hybrid search, records)
// gives exactly what would go to the model, and the marked passage ids say
// whether the right passages were in it.
//
//   MODE=retrieval  every question, no model: hit rate, recall and the rank
//                   of the first right passage. Fast; needs only embeddings.
//   MODE=full       the questions in SAMPLE (default: FULL_SAMPLE) answered
//                   by the configured model through the AI service's answer
//                   call, then citation support by passage ids, the
//                   expected-answer check, and a hand-review sheet (SHEET) for
//                   faithfulness. No model judges anything.
//                   The database is read first, for every question, and the
//                   model is asked afterwards, so a long run on a slow model
//                   never holds the database.
//
// The model must be local. A full run refuses unless AI_SERVICE_URL is on this
// machine (localhost, 127.0.0.1, ::1) or the compose service "ai", and the AI
// service reports a local model; it asks again before every answer, so a
// service switched to a hosted model mid-run stops the run. Masking is off in
// these runs, which is only safe with a local model.
//
// A retrieval run sends only the questions' text to the AI service (to embed
// them); no file content leaves the database.
//
// Env: the web app's settings, plus CONTENT (the JSON testset-seed.ts printed),
// OUT (results JSON), optionally PAYLOAD_LOG (JSONL from a logging proxy in
// front of Ollama, for prompt sizes), SHEET (review sheet, Markdown), ONLY=N01,N02.
import { readFileSync, writeFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { Pool } from "pg";
import { asUser } from "@/db/client";
import { detectLang } from "@/lib/translations";
import { modelIsLocal } from "@/services/ai-client";
import * as A from "@/services/assistant";
import { loadPrincipal } from "@/services/principal";
import { CORPUS, passageById } from "./testset/corpus";
import { FULL_SAMPLE, QUESTIONS, type Question } from "./testset/questions";

const MODE = process.env.MODE === "full" ? "full" : "retrieval";
const OUT = process.env.OUT!;
const LOG = process.env.PAYLOAD_LOG;
const content = JSON.parse(readFileSync(process.env.CONTENT!, "utf8")) as { ids: Record<string, string>; board: string; rawdah: string; waha: string };
const only = process.env.ONLY ? new Set(process.env.ONLY.split(",")) : MODE === "full" ? new Set(process.env.SAMPLE ? process.env.SAMPLE.split(",") : FULL_SAMPLE) : null;
const owner = new Pool({ connectionString: process.env.DATABASE_OWNER_URL, max: 2 });
const q1 = async <T,>(sql: string, p: unknown[] = []) => (await owner.query(sql, p)).rows[0] as T;

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1", "ai"]);
async function assertLocalModel() {
  const host = new URL(process.env.AI_SERVICE_URL ?? "http://unset.invalid").hostname;
  if (!LOCAL_HOSTS.has(host)) throw new Error(`AI_SERVICE_URL is not on this machine (${host}): full runs use the local model only`);
  if (!(await modelIsLocal())) throw new Error("the AI service does not report a local model: full runs use the local model only");
}
if (MODE === "full") await assertLocalModel();

/**
 * One POST that waits as long as the model needs. Node's fetch gives up after 300 s without the
 * reply's first line (its headers timeout), whatever abort signal it is given; a processor-only
 * model took 350 s on one answer of the first run. node:http has no such limit: only this one.
 */
function postJson(url: URL, body: unknown, timeoutMs: number): Promise<{ status: number; json: unknown }> {
  return new Promise((resolve, reject) => {
    const data = Buffer.from(JSON.stringify(body));
    const req = (url.protocol === "https:" ? httpsRequest : httpRequest)(
      url,
      { method: "POST", headers: { "content-type": "application/json", "content-length": data.length, authorization: `Bearer ${process.env.AI_SERVICE_TOKEN}` } },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          try {
            resolve({ status: res.statusCode ?? 0, json: JSON.parse(Buffer.concat(chunks).toString("utf8")) });
          } catch (e) {
            reject(e);
          }
        });
        res.on("error", reject);
      },
    );
    req.setTimeout(timeoutMs, () => req.destroy(new Error("timed out")));
    req.on("error", reject);
    req.end(data);
  });
}

const U = {
  khalid: (await q1<{ id: string }>(`SELECT id FROM "user" WHERE email = 'khalid@mizan.example'`)).id,
  noura: (await q1<{ id: string }>(`SELECT id FROM "user" WHERE email = 'noura@mizan.example'`)).id,
};
const P = { board: content.board, rawdah: content.rawdah, waha: content.waha };
const fileOfDoc = new Map(Object.entries(content.ids).map(([k, id]) => [id, k]));
const filesByKey = new Map(CORPUS.map((f) => [f.key, f]));
const norm = (s: string) => s.replace(/\s+/g, " ").trim();
const chunkText = new Map<string, { content: string; projectId: string }>();
async function chunk(id: string) {
  if (!chunkText.has(id)) {
    const r = await q1<{ content: string; project_id: string }>(`SELECT content, project_id FROM ai_chunks WHERE id = $1`, [id]);
    chunkText.set(id, { content: r?.content ?? "", projectId: r?.project_id ?? "" });
  }
  return chunkText.get(id)!;
}
const recordTitle = new Map<string, string>();
async function record(type: string, id: string) {
  const k = `${type}:${id}`;
  if (!recordTitle.has(k)) {
    const table = type === "action" ? "actions" : type === "recommendation" ? "recommendations" : null;
    const r = table ? await q1<{ title: string } | undefined>(`SELECT title FROM ${table} WHERE id = $1`, [id]) : undefined;
    recordTitle.set(k, r ? `${type === "action" ? "act" : "rec"}:${r.title}` : `${type}:${id.slice(0, 8)}`);
  }
  return recordTitle.get(k)!;
}

/** What one source sent to the model holds: the passage ids it covers (a file passage) or the record's label. */
async function covers(c: A.Citation): Promise<{ label: string; ids: string[]; projectId: string | null; text: string }> {
  if (!c.chunkId) {
    const label = await record(c.sourceType, c.sourceId);
    return { label, ids: [label], projectId: c.projectId ?? null, text: "" };
  }
  const ch = await chunk(c.chunkId);
  const key = fileOfDoc.get(c.sourceId);
  const file = key ? filesByKey.get(key) : undefined;
  const text = norm(ch.content);
  const ids = file ? file.pages.flat().filter((x) => text.includes(norm(x.text))).map((x) => x.id) : [];
  return { label: key ?? `document:${c.sourceId.slice(0, 8)}`, ids, projectId: ch.projectId, text: ch.content };
}

const logLines = () => {
  if (!LOG) return [];
  try {
    return readFileSync(LOG, "utf8").trim().split("\n").filter(Boolean);
  } catch {
    return [];
  }
};

interface Result {
  id: string;
  group: string;
  lang: string;
  q: string;
  gold: string[];
  expect: string;
  refused: string | null;
  sent: { label: string; ids: string[] }[];
  hit: boolean | null;
  recall: number | null;
  firstGoldRank: number | null;
  otherProjectSent: number;
  neverSent: string[];
  searchMs: number;
  // full mode
  answer?: string;
  grounded?: boolean;
  cited?: { label: string; ids: string[] }[];
  citesGold?: boolean | null;
  citedGoldShare?: number | null;
  expectOk?: boolean | null;
  anyOk?: boolean | null;
  languageOk?: boolean | null;
  answerMs?: number;
  promptTokens?: (number | null)[];
  neverInAnswer?: string[];
}

const results: Result[] = [];
const pending: { qn: Question; r: Result; prepared: A.PreparedAsk }[] = [];

/** Step 1, the only one that reads the database: what would go to the model, and which marked passages it holds. */
async function prepare(qn: Question) {
  const userId = U[qn.user];
  const projectId = qn.project === "all" ? null : P[qn.project];
  const allowed = new Set<string>(
    projectId ? [projectId] : (await owner.query(`SELECT project_id FROM project_members WHERE user_id = $1`, [userId])).rows.map((r: { project_id: string }) => r.project_id),
  );
  const t0 = performance.now();
  let prepared: A.PreparedAsk | null = null;
  let refused: string | null = null;
  try {
    // Search reads the question alone, also in a follow-up (as the product does); the earlier turn is added in step 2.
    prepared = await asUser(userId, async (tx) => A.prepareAsk(tx, (await loadPrincipal(tx, userId))!, { projectId, question: qn.q, language: "auto" }, false));
  } catch (e) {
    refused = `${(e as Error).constructor.name}: ${(e as Error).message}`.slice(0, 160);
  }
  const searchMs = performance.now() - t0;
  const sentFull = prepared ? await Promise.all([...prepared.byPassageId.values()].map(covers)) : [];
  const sent = sentFull.map(({ label, ids }) => ({ label, ids }));
  const covered = new Set(sent.flatMap((s) => s.ids));
  const gold = qn.gold;
  const firstGold = sent.findIndex((s) => s.ids.some((i) => gold.includes(i)));
  const sentText = sentFull.map((s) => s.text).join("\n") + (prepared ? prepared.passages.map((x) => x.text).join("\n") : "");
  const r: Result = {
    id: qn.id,
    group: qn.group,
    lang: qn.lang,
    q: qn.q,
    gold,
    expect: qn.expect,
    refused,
    sent,
    hit: gold.length ? gold.some((g) => covered.has(g)) : null,
    recall: gold.length ? gold.filter((g) => covered.has(g)).length / gold.length : null,
    firstGoldRank: firstGold >= 0 ? firstGold + 1 : null,
    otherProjectSent: sentFull.filter((s) => s.projectId && !allowed.has(s.projectId)).length,
    neverSent: (qn.never ?? []).filter((w) => sentText.includes(w)),
    searchMs,
  };
  results.push(r);
  if (prepared) pending.push({ qn, r, prepared });
  console.log(qn.id, qn.group, r.refused ? `REFUSED ${r.refused}` : `hit=${r.hit} recall=${r.recall?.toFixed(2)} rank=${r.firstGoldRank} sent=${sent.length}`);
}

/**
 * Step 2, full runs only, with no database: the AI service's /v1/answer (the prompt and answer check
 * the card uses), then the citations checked against the passages sent, as finishAsk() does. A
 * follow-up gets the earlier question and answer as its history, as recentTurns() would give it.
 * Not the card's stream: it gives up after 120 s without a first word, which a processor-only model
 * reading a long prompt passes (docs/assistant-eval-results.md).
 */
const answers = new Map<string, { q: string; answer: string }>();
async function answerOne({ qn, r, prepared: p }: (typeof pending)[number]) {
  const parent = qn.follow ? answers.get(qn.follow) : undefined;
  const history = parent ? [{ role: "user" as const, content: parent.q }, { role: "assistant" as const, content: parent.answer }] : [];
  // Asked again before every answer: the passages are about to be sent unmasked.
  await assertLocalModel();
  const before = logLines().length;
  const t1 = performance.now();
  const res = await postJson(
    new URL("/v1/answer", process.env.AI_SERVICE_URL),
    { question: p.maskedQuestion, passages: p.passages, language: A.answerLanguage(p), history, audience: "staff", progress_draft: p.progressDraft },
    1_800_000,
  ).catch(() => null);
  r.answerMs = performance.now() - t1;
  const out = res && res.status === 200 ? (res.json as { answer: string; cited_ids: string[]; grounded: boolean }) : null;
  r.promptTokens = logLines()
    .slice(before)
    .map((l) => (JSON.parse(l) as { prompt_eval_count?: number | null }).prompt_eval_count ?? null);
  if (!out) {
    r.answer = "(error)";
    r.grounded = false;
  } else {
    const citations = out.cited_ids.flatMap((id) => p.byPassageId.get(id) ?? []);
    const grounded = out.grounded && citations.length > 0;
    const answer = (grounded ? p.masker.unmask(out.answer) : A.cannotConfirm(p.language, p.question)).replace(/[  ]/g, " ");
    const cited = grounded ? await Promise.all(citations.map(covers)) : [];
    const gold = qn.gold;
    answers.set(qn.id, { q: qn.q, answer });
    r.answer = answer;
    r.grounded = grounded;
    r.cited = cited.map(({ label, ids }) => ({ label, ids }));
    r.citesGold = gold.length && grounded ? cited.some((c) => c.ids.some((i) => gold.includes(i))) : null;
    r.citedGoldShare = gold.length && cited.length ? cited.filter((c) => c.ids.some((i) => gold.includes(i))).length / cited.length : null;
    r.expectOk = qn.expect === "either" ? null : qn.expect === "answer" ? grounded : !grounded;
    r.anyOk = qn.any?.length && grounded ? qn.any.some((w) => answer.toLowerCase().includes(w.toLowerCase())) : null;
    r.languageOk = /\p{L}/u.test(answer) ? detectLang(answer) === qn.lang : null;
    r.neverInAnswer = (qn.never ?? []).filter((w) => answer.includes(w));
  }
  console.log(qn.id, `${r.grounded ? "grounded" : "not grounded"} ${Math.round(r.answerMs)} ms tokens=${r.promptTokens.join("/")} | ${(r.answer ?? "").slice(0, 100).replace(/\n/g, " ")}`);
}

for (const qn of QUESTIONS) if (!only || only.has(qn.id)) await prepare(qn);
if (MODE === "full") {
  // The model is local; chunk text and record titles are already read, so nothing below touches the database.
  await owner.end();
  for (const item of pending) await answerOne(item);
}

// ------------------------------------------------------------------ summary
const pct = (n: number, d: number) => (d ? `${n} of ${d} (${Math.round((n / d) * 100)}%)` : "n/a");
const scored = results.filter((r) => r.hit !== null);
const byGroup = new Map<string, Result[]>();
for (const r of scored) byGroup.set(r.group, [...(byGroup.get(r.group) ?? []), r]);
const summary: Record<string, unknown> = {
  mode: MODE,
  questions: results.length,
  withGold: scored.length,
  hitRate: pct(scored.filter((r) => r.hit).length, scored.length),
  meanRecall: scored.length ? +(scored.reduce((s, r) => s + (r.recall ?? 0), 0) / scored.length).toFixed(3) : null,
  goldFirst: pct(scored.filter((r) => r.firstGoldRank === 1).length, scored.length),
  byGroup: Object.fromEntries([...byGroup].map(([g, rs]) => [g, pct(rs.filter((r) => r.hit).length, rs.length)])),
  byLang: Object.fromEntries(["ar", "en"].map((l) => [l, pct(scored.filter((r) => r.lang === l && r.hit).length, scored.filter((r) => r.lang === l).length)])),
  misses: scored.filter((r) => !r.hit).map((r) => r.id),
  otherProjectSent: results.reduce((s, r) => s + r.otherProjectSent, 0),
  neverSent: results.filter((r) => r.neverSent.length).map((r) => r.id),
  refused: results.filter((r) => r.refused).map((r) => r.id),
  medianSearchMs: Math.round([...results.map((r) => r.searchMs)].sort((a, b) => a - b)[Math.floor(results.length / 2)] ?? 0),
};
if (MODE === "full") {
  const answered = results.filter((r) => r.answer !== undefined);
  const withGold = answered.filter((r) => r.gold.length && r.grounded);
  const times = answered.map((r) => r.answerMs ?? 0).sort((a, b) => a - b);
  const tokens = answered.flatMap((r) => r.promptTokens ?? []).filter((n): n is number => typeof n === "number");
  Object.assign(summary, {
    answered: answered.length,
    expectOk: pct(answered.filter((r) => r.expectOk === true).length, answered.filter((r) => r.expectOk !== null).length),
    citesGold: pct(withGold.filter((r) => r.citesGold).length, withGold.length),
    meanCitedGoldShare: withGold.length ? +(withGold.reduce((s, r) => s + (r.citedGoldShare ?? 0), 0) / withGold.length).toFixed(3) : null,
    contentCheck: pct(answered.filter((r) => r.anyOk === true).length, answered.filter((r) => r.anyOk !== null).length),
    languageOk: pct(answered.filter((r) => r.languageOk === true).length, answered.filter((r) => r.languageOk !== null).length),
    neverInAnswer: answered.filter((r) => r.neverInAnswer?.length).map((r) => r.id),
    medianAnswerMs: Math.round(times[Math.floor(times.length / 2)] ?? 0),
    maxAnswerMs: Math.round(times.at(-1) ?? 0),
    maxPromptTokens: tokens.length ? Math.max(...tokens) : null,
    promptsOver4096: tokens.filter((n) => n > 4096).length,
  });
}
console.log(JSON.stringify(summary, null, 1));
writeFileSync(OUT, JSON.stringify({ summary, results }, null, 1));

// The hand-review sheet: faithfulness is judged by a person, never by a model.
if (MODE === "full" && process.env.SHEET) {
  const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\n+/g, " ");
  const passage = (id: string) => passageById.get(id)?.text ?? id;
  const rows = results.map((r) => {
    const goldText = r.gold.map((g) => (g.startsWith("act:") ? g : `${g}: ${passage(g)}`)).join(" / ") || "(none: the right answer is \"can't confirm\")";
    const cited = (r.cited ?? []).map((c) => `${c.label} [${c.ids.join(", ") || "no marked passage"}]`).join("; ") || "(none)";
    return `| ${r.id} | ${cell(r.q)} | ${cell(r.answer ?? "")} | ${cell(cited)} | ${cell(goldText)} |  |  |`;
  });
  writeFileSync(
    process.env.SHEET,
    [
      "# Faithfulness review sheet",
      "",
      "Score each answer against the marked passages and what it cites: 2 = every claim is supported by a cited passage; 1 = partly supported, or right but missing something the question needs (for example only one of two versions); 0 = a claim is unsupported or wrong. \"Can't confirm\" where the right answer is \"can't confirm\" scores 2.",
      "",
      "| Id | Question | Answer | Cited (passage ids) | Right passages | Score (0-2) | Notes |",
      "|---|---|---|---|---|---|---|",
      ...rows,
      "",
    ].join("\n"),
  );
}
if (MODE !== "full") await owner.end();
process.exit(0);
