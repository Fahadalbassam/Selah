import "server-only";
import { z } from "zod";
import { env } from "@/env";

// Client for the Python AI service. The service never gets database
// credentials: it receives only passages this server already authorized.

const TIMEOUT_MS = 60_000;

async function call<T>(path: string, body: unknown, schema: z.ZodType<T>): Promise<T> {
  const e = env();
  const res = await fetch(new URL(path, e.AI_SERVICE_URL), {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${e.AI_SERVICE_TOKEN}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`ai service ${path} failed: ${res.status}`);
  return schema.parse(await res.json());
}

export function embed(texts: string[]): Promise<number[][]> {
  return call("/v1/embed", { texts }, z.object({ vectors: z.array(z.array(z.number())) })).then((r) => r.vectors);
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
): Promise<Answer> {
  return call("/v1/answer", { question, passages, language, history, audience }, answerSchema);
}

export function translateText(text: string, source: "ar" | "en", target: "ar" | "en"): Promise<{ text: string; model: string }> {
  return call("/v1/translate", { text, source, target }, z.object({ text: z.string().min(1), model: z.string() }));
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
  );
}
