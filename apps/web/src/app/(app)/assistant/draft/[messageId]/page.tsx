import { notFound, redirect } from "next/navigation";
import { isUuid } from "@/lib/ids";
import { projectTabHref } from "@/lib/project-tabs";
import { withPrincipal } from "@/server/page";
import { draftForReport } from "@/services/report-send";

/**
 * "Use as draft" under a progress draft in the assistant (migration 0110):
 * opens the firm's report page with the draft as the note. This month's
 * status pack when it still waits for its note, else a new report on the
 * project's Progress tab. Reads only: nothing is saved until the person saves
 * on the report page, and the chat keeps only its answer.
 */
export default async function UseDraftPage({ params }: { params: Promise<{ messageId: string }> }) {
  const { messageId } = await params;
  if (!isUuid(messageId)) notFound();
  const draft = await withPrincipal((tx, principal) => draftForReport(tx, principal, messageId));
  if (!draft) notFound();
  redirect(draft.packId ? `/reports/${draft.packId}?draft=${messageId}` : projectTabHref(draft.projectId, "progress", { draft: messageId }));
}
