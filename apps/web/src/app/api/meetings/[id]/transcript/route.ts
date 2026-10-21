import { z } from "zod";
import { TRANSCRIPT_MAX_CHARS } from "@/lib/transcripts";
import { route } from "@/server/http";
import { deleteTranscript, getTranscript, importTranscript } from "@/services/meetings";

// A held meeting's transcript, for the firm's people running it. Import
// needs the meeting to record that participants were told.
const params = z.object({ id: z.uuid() });
const body = z.object({
  // The file as read in the browser (a little over the stored limit, for timings the parser drops).
  text: z
    .string()
    .min(1)
    .max(TRANSCRIPT_MAX_CHARS * 2),
  format: z.enum(["text", "vtt", "srt"]),
  lang: z.enum(["ar", "en", "mixed"]),
});

export const GET = route({ params }, ({ tx, principal, params }) => getTranscript(tx, principal, params.id));
export const PUT = route({ params, body }, ({ tx, principal, params, body }) => importTranscript(tx, principal, params.id, body));
export const DELETE = route({ params }, ({ tx, principal, params }) => deleteTranscript(tx, principal, params.id));
