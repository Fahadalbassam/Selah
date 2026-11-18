import "server-only";
import { sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import type { Env } from "@/env";
import { createMasker, type Masker } from "@/lib/masking";

/** Whether text is masked before it reaches the model: always when the model is hosted elsewhere. */
export function maskingOn(
  e: Pick<Env, "AI_MASKING" | "LLM_PROVIDER"> = {
    // Read directly (validated in env.ts), so jobs and tests without the web app's settings work too.
    AI_MASKING: (process.env.AI_MASKING as Env["AI_MASKING"] | undefined) ?? "auto",
    LLM_PROVIDER: (process.env.LLM_PROVIDER as Env["LLM_PROVIDER"] | undefined) ?? "ollama",
  },
): boolean {
  return e.AI_MASKING === "on" || (e.AI_MASKING === "auto" && e.LLM_PROVIDER !== "ollama");
}

/**
 * The masking for one request about one project: its client and firm, their
 * people and contacts, and the client's departments (app_mask_terms,
 * baseline: Assistant chats). Off, it changes nothing.
 */
export async function projectMasker(tx: Tx, projectId: string, on = maskingOn()): Promise<Masker> {
  if (!on) return createMasker([]);
  const { rows } = await tx.execute<{ kind: string; term: string; entity: string }>(sql`SELECT kind, term, entity FROM app_mask_terms(${projectId})`);
  return createMasker(rows, { places: true });
}

/**
 * The masking for one text, for translation and the assistant: only the
 * names of its projects written in that text (app_mask_terms_in), never the
 * list of names the asker may read, so it masks every name in the text,
 * whoever asks (action owners included). Off, it changes nothing.
 */
export async function textMasker(tx: Tx, projectIds: string[], text: string, on = maskingOn()): Promise<Masker> {
  if (!on || projectIds.length === 0) return createMasker([]);
  const { rows } = await tx.execute<{ pid: string; kind: string; term: string; grp: number }>(sql`
    SELECT pid, t.kind, t.term, t.grp
    FROM unnest(ARRAY[${sql.join(projectIds.map((i) => sql`${i}::uuid`), sql`, `)}]) pid, LATERAL app_mask_terms_in(pid, ${text}) t`);
  // The names of one record share a number within their project.
  return createMasker(rows.map((r) => ({ kind: r.kind, term: r.term, entity: `${r.pid}:${r.grp}` })), { places: true });
}
