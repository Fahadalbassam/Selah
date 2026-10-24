import { authorize } from "./authorize";
import type { Principal, Resource, Visibility } from "./types";

/**
 * The filter the AI retrieval query must run with. It is computed by the same
 * authorize() as everything else, then pushed INTO the vector search's WHERE
 * clause, so chunks outside it are never scored, let alone sent to the model.
 * Filtering after the search is not allowed.
 */
export interface RetrievalScope {
  projectId: string;
  orgId: string;
  /** Labels the user may read. user_private chunks also need ownerUserId = userId. */
  labels: readonly Visibility[];
  userId: string;
  /** A client person: only files, recommendations and actions are searched (no meeting notes or reviews). */
  client?: boolean;
}

export function retrievalScope(principal: Principal, project: Resource & { type: "project" }): RetrievalScope | null {
  if (!authorize(principal, "assistant.query", project).allowed) return null;
  // Action owners see only their own actions and the files shared with them,
  // narrower than row-level security, and passages are not indexed per
  // person, so they never get retrieval. A client admin or manager reads
  // what row-level security gives them, which is what their screens show
  // (tests/db/client-assistant.test.ts).
  if (principal.role === "action_owner") return null;

  const labels: Visibility[] =
    principal.orgKind === "firm" ? ["shared", "firm_private", "user_private"] : ["shared", "client_private", "user_private"];

  return {
    projectId: project.projectId!,
    orgId: project.orgId,
    labels,
    userId: principal.userId,
    client: principal.orgKind === "client",
  };
}
