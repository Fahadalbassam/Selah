/** The fields of a trace row that decide where it sits in the tree. */
export interface TraceLink {
  nodeType: string;
  nodeId: string;
  parentType: string | null;
  parentId: string | null;
}

/**
 * The rows that start a branch of the trace tree: those with no parent, and
 * those whose parent is not among the rows. The second kind is a node whose
 * parent this person can't see (an assessment the client wasn't shown, say);
 * it starts its own branch instead of disappearing with its parent.
 */
export function traceRoots<T extends TraceLink>(rows: T[]): T[] {
  const present = new Set(rows.map((r) => `${r.nodeType}:${r.nodeId}`));
  return rows.filter((r) => !r.parentId || !present.has(`${r.parentType}:${r.parentId}`));
}
