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

export function answer(question: string, passages: Passage[], language: "ar" | "en" | "auto"): Promise<Answer> {
  return call("/v1/answer", { question, passages, language }, answerSchema);
}
