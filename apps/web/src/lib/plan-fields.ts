// The recommendation dialog (October review, item 5): five fields first, the
// rest behind "More". Plain module shared by the dialog and the tests.

/** Shown at once: what a recommendation needs to be useful. */
export const REC_MAIN_FIELDS = ["title", "priority", "accountable", "dueDate", "rationale"] as const;

/** Behind "More": the finding it answers, its source, the department, the outcome, the evidence, who sees it. */
export const REC_MORE_FIELDS = ["finding", "source", "department", "targetOutcome", "requiredEvidence", "visibility"] as const;

/**
 * "More" opens by itself when it already holds something the writer should
 * see: a finding chosen from a finding's row, or a correction of a
 * recommendation that has a finding, a department, an outcome or evidence.
 */
export function recMoreOpen(input: {
  defaultFindingId?: string;
  values?: { findingId: string | null; departmentId: string | null; targetOutcome: string | null; requiredEvidence: string | null } | null;
}): boolean {
  if (input.defaultFindingId) return true;
  const v = input.values;
  return !!v && !!(v.findingId || v.departmentId || v.targetOutcome || v.requiredEvidence);
}
