import "server-only";
import { z } from "zod";
import { env } from "@/env";

// Client for the Python AI service. The service never gets database
// credentials: it receives only passages this server already authorized.

// How long each kind of call may take. The model may run on the server's
// processor (the section 7 test run: answers took a median of 2 minutes and
// up to 6, most of it reading the prompt before the first word), so a call
// that asks the model gets minutes, not seconds. Embeddings stay short: one
// question's vector, or a file's chunks in the indexing job.
const EMBED_TIMEOUT_MS = 60_000;
/** One translated field: a short text, one model run. */
const TRANSLATE_TIMEOUT_MS = 300_000;
/** A file's pages read in, or a pasted org chart written out as rows, or a whole answer (up to three model runs): as long as a streamed answer. */
const LONG_MODEL_TIMEOUT_MS = 600_000;

async function call<T>(path: string, body: unknown, schema: z.ZodType<T>, timeoutMs: number): Promise<T> {
  const e = env();
  const res = await fetch(new URL(path, e.AI_SERVICE_URL), {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${e.AI_SERVICE_TOKEN}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`ai service ${path} failed: ${res.status}`);
  return schema.parse(await res.json());
}

// The service is on the same network; a slow answer means something is wrong, and masking is the safe side.
const MODEL_TIMEOUT_MS = 5_000;

/**
 * Whether the AI service itself says its chat model runs locally (GET
 * /v1/model, by the service's own explicit LLM_PROVIDER=ollama). Anything
 * else is false: a hosted model, no setting, an error, a timeout, an answer
 * in another shape. The caller masks unless this is true (masking.ts).
 */
export async function modelIsLocal(): Promise<boolean> {
  try {
    const e = env();
    const res = await fetch(new URL("/v1/model", e.AI_SERVICE_URL), {
      headers: { authorization: `Bearer ${e.AI_SERVICE_TOKEN}` },
      signal: AbortSignal.timeout(MODEL_TIMEOUT_MS),
    });
    if (!res.ok) return false;
    const r = z.object({ local: z.boolean() }).safeParse(await res.json());
    return r.success && r.data.local === true;
  } catch {
    return false;
  }
}

export function embed(texts: string[]): Promise<number[][]> {
  return call("/v1/embed", { texts }, z.object({ vectors: z.array(z.array(z.number())) }), EMBED_TIMEOUT_MS).then((r) => r.vectors);
}

export interface Passage {
  id: string;
  text: string;
  source: string;
}

const answerSchema = z.object({
  answer: z.string(),
  cited_ids: z.array(z.string()),
  grounded: z.boolean(),
});

export type Answer = z.infer<typeof answerSchema>;

/** An earlier turn of the same chat: context for a follow-up, never a source. */
export interface HistoryTurn {
  role: "user" | "assistant";
  content: string;
}

export function answer(
  question: string,
  passages: Passage[],
  language: "ar" | "en" | "auto",
  history: HistoryTurn[] = [],
  /** "client": the client rules are added to the prompt (wave 3, F39). */
  audience: "staff" | "client" = "staff",
  /** A client person's progress-update draft: the AI service writes its mark and takes out rating words. */
  opts: { progressDraft?: boolean } = {},
): Promise<Answer> {
  return call("/v1/answer", { question, passages, language, history, audience, progress_draft: opts.progressDraft === true }, answerSchema, LONG_MODEL_TIMEOUT_MS);
}

// While an answer streams: the longest wait for the next line, and for the
// whole answer. The AI service sends a "wait" line whenever it has sent
// nothing for 10 seconds (also while the model reads the prompt, minutes on a
// processor), so a minute without any line means the service is gone; the
// whole answer still ends after 10 minutes.
export const STREAM_IDLE_MS = 60_000;
export const STREAM_TOTAL_MS = 600_000;

/**
 * The same answer as answer(), streamed: onText gets the answer written so
 * far (unchecked, for showing progress) as the model writes it, and onWait
 * each "wait" line (the model is still working and has nothing to show). The
 * checked answer is what the promise gives.
 */
export async function answerStream(
  question: string,
  passages: Passage[],
  language: "ar" | "en" | "auto",
  history: HistoryTurn[],
  audience: "staff" | "client",
  onText: (text: string) => void,
  opts: { progressDraft?: boolean; onWait?: () => void } = {},
): Promise<Answer> {
  const e = env();
  // One signal for both limits, with a reason that says which one fired.
  const stop = new AbortController();
  const quiet = () => stop.abort(new Error(`ai service: no line from the answer stream for ${STREAM_IDLE_MS / 1000} s`));
  const total = setTimeout(() => stop.abort(new Error(`ai service: the answer took over ${STREAM_TOTAL_MS / 60_000} minutes`)), STREAM_TOTAL_MS);
  let timer = setTimeout(quiet, STREAM_IDLE_MS);
  try {
    const res = await fetch(new URL("/v1/answer/stream", e.AI_SERVICE_URL), {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${e.AI_SERVICE_TOKEN}` },
      body: JSON.stringify({ question, passages, language, history, audience, progress_draft: opts.progressDraft === true }),
      signal: stop.signal,
    });
    if (!res.ok || !res.body) throw new Error(`ai service /v1/answer/stream failed: ${res.status}`);
    const decoder = new TextDecoder();
    let buffer = "";
    const reader = res.body.getReader();
    for (let r = await reader.read(); !r.done; r = await reader.read()) {
      const chunk = r.value;
      clearTimeout(timer);
      timer = setTimeout(quiet, STREAM_IDLE_MS);
      buffer += decoder.decode(chunk, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line) continue;
        const event = streamEvent.parse(JSON.parse(line));
        if (event.type === "text") onText(event.text);
        else if (event.type === "done") return event.answer;
        else if (event.type === "wait") opts.onWait?.();
        else throw new Error("ai service: the answer failed");
      }
    }
    throw new Error("ai service: the answer stopped early");
  } finally {
    clearTimeout(timer);
    clearTimeout(total);
  }
}

const streamEvent = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), text: z.string() }),
  z.object({ type: z.literal("done"), answer: answerSchema }),
  z.object({ type: z.literal("error") }),
  // The model is still working (reading the prompt, or asked again) and has nothing to show yet.
  z.object({ type: z.literal("wait") }),
]);

export function translateText(text: string, source: "ar" | "en", target: "ar" | "en"): Promise<{ text: string; model: string }> {
  return call("/v1/translate", { text, source, target }, z.object({ text: z.string().min(1), model: z.string() }), TRANSLATE_TIMEOUT_MS);
}

const orgDraftSchema = z.object({
  units: z.array(z.object({ ref: z.string(), parent: z.string(), code: z.string(), name: z.string(), kind: z.string() })).max(300),
  positions: z
    .array(
      z.object({
        ref: z.string(),
        unit: z.string(),
        code: z.string(),
        title: z.string(),
        reports_to: z.string(),
        head: z.boolean(),
        specialties: z.array(z.string()).max(30),
      }),
    )
    .max(600),
  model: z.string(),
});

export type OrgDraft = z.infer<typeof orgDraftSchema>;

/**
 * Units and positions arranged from pasted text (org chart, part 4), through
 * the service's chat_json with a strict schema that has no field for a
 * person. The text must already be masked; the caller keeps only what is
 * written in it (lib/org-chart-import.ts). Anything else the service sends
 * back is dropped here (zod keeps only the fields named).
 */
export function draftOrgChart(text: string): Promise<OrgDraft> {
  return call("/v1/org-chart/draft", { text }, orgDraftSchema, LONG_MODEL_TIMEOUT_MS);
}

export interface SummaryPoint {
  text: string;
  pages: number[];
}

/** Summarise a file from its pages. Points that cite no page given are dropped by the service. */
export function summarizePages(
  pages: { n: number; text: string }[],
  lang: "ar" | "en",
): Promise<{ points: SummaryPoint[]; model: string }> {
  return call(
    "/v1/summarize",
    { pages, lang },
    z.object({ points: z.array(z.object({ text: z.string(), pages: z.array(z.number().int()) })), model: z.string() }),
    LONG_MODEL_TIMEOUT_MS,
  );
}
