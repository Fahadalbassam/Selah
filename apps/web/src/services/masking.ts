import "server-only";
import { sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import type { Env } from "@/env";
import { createMasker, type Masker } from "@/lib/masking";
import { createNumberTagger, type NumberTagger } from "@/lib/sensitive-numbers";
import { modelIsLocal } from "./ai-client";

/**
 * Whether text is masked before it reaches the model. AI_MASKING "on" and
 * "off" force it. "auto" (the default) masks unless the AI service itself
 * says its model is local (modelIsLocal: by the service's own setting, asked
 * each time), and always when this app's own LLM_PROVIDER says hosted. If the
 * service cannot be asked, or answers anything else, the text is masked: the
 * two apps' settings can disagree (phase 3, R1), and the service's is the one
 * that decides where the text goes. Closed by default, as the org chart draft.
 */
export async function maskingOn(
  e: Pick<Env, "AI_MASKING" | "LLM_PROVIDER"> = {
    // Read directly (validated in env.ts), so jobs and tests without the web app's settings work too.
    AI_MASKING: (process.env.AI_MASKING as Env["AI_MASKING"] | undefined) ?? "auto",
    LLM_PROVIDER: (process.env.LLM_PROVIDER as Env["LLM_PROVIDER"] | undefined) ?? "ollama",
  },
  local?: () => Promise<boolean>,
): Promise<boolean> {
  if (e.AI_MASKING === "on") return true;
  if (e.AI_MASKING === "off") return false;
  if (e.LLM_PROVIDER !== "ollama") return true;
  try {
    return !(await (local ?? modelIsLocal)());
  } catch {
    return true;
  }
}

/**
 * The masking for one request about one project: its client and firm, their
 * people and contacts, and the client's departments (app_mask_terms,
 * baseline: Assistant chats). Off, it masks no name. Either way personal
 * numbers are tagged (section 7 item 6): with a local model too.
 */
export async function projectMasker(tx: Tx, projectId: string, on?: boolean, numbers: NumberTagger = createNumberTagger()): Promise<Masker> {
  if (!(on ?? (await maskingOn()))) return createMasker([], { numbers });
  const { rows } = await tx.execute<{ kind: string; term: string; entity: string }>(sql`SELECT kind, term, entity FROM app_mask_terms(${projectId})`);
  return createMasker(rows, { places: true, numbers });
}

/**
 * The masking for one text, for translation and the assistant: only the
 * names of its projects written in that text (app_mask_terms_in), never the
 * list of names the asker may read, so it masks every name in the text,
 * whoever asks (action owners included). Off, it masks no name. Either way
 * personal numbers are tagged (section 7 item 6): with a local model too.
 * `numbers`: a tagger the request already used (the assistant tags the
 * question before it is embedded), so one number keeps one tag.
 */
export async function textMasker(tx: Tx, projectIds: string[], text: string, on?: boolean, numbers: NumberTagger = createNumberTagger()): Promise<Masker> {
  if (projectIds.length === 0 || !(on ?? (await maskingOn()))) return createMasker([], { numbers });
  const { rows } = await tx.execute<{ pid: string; kind: string; term: string; grp: number }>(sql`
    SELECT pid, t.kind, t.term, t.grp
    FROM unnest(ARRAY[${sql.join(projectIds.map((i) => sql`${i}::uuid`), sql`, `)}]) pid, LATERAL app_mask_terms_in(pid, ${text}) t`);
  // The names of one record share a number within their project.
  return createMasker(rows.map((r) => ({ kind: r.kind, term: r.term, entity: `${r.pid}:${r.grp}` })), { places: true, numbers });
}
