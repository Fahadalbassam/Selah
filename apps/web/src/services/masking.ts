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
 * drizzle/0047). Off, it changes nothing.
 */
export async function projectMasker(tx: Tx, projectId: string, on = maskingOn()): Promise<Masker> {
  if (!on) return createMasker([]);
  const { rows } = await tx.execute<{ kind: string; term: string }>(sql`SELECT kind, term FROM app_mask_terms(${projectId})`);
  return createMasker(rows, { places: true });
}
