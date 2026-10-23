// Turning a transcript file into plain lines of "Speaker: words". Pure, so
// the browser can preview and the server stores the same thing.
//   text - pasted, or a .txt export (Google Meet saves transcripts as a Doc)
//   vtt  - WebVTT captions (Meet, Teams and Zoom recordings)
//   srt  - SubRip captions

// The database checks the same formats and length (tests/db/rule-parity.test.ts).
export const TRANSCRIPT_FORMATS = ["text", "vtt", "srt"] as const;
export type TranscriptFormat = (typeof TRANSCRIPT_FORMATS)[number];
export const TRANSCRIPT_MAX_CHARS = 500_000;

const TIMING = /^\s*(\d{1,2}:)?\d{1,2}:\d{2}[.,]\d{3}\s*-->\s*(\d{1,2}:)?\d{1,2}:\d{2}[.,]\d{3}/;

export function formatOf(fileName: string): TranscriptFormat {
  const ext = fileName.toLowerCase().split(".").pop();
  return ext === "vtt" ? "vtt" : ext === "srt" ? "srt" : "text";
}

/** Plain text, one cue per line, consecutive lines by the same speaker joined. */
export function parseTranscript(raw: string, format: TranscriptFormat): string {
  const text = raw.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  if (format === "text") return text.trim();

  const lines: { speaker: string | null; words: string }[] = [];
  for (const block of text.split(/\n{2,}/)) {
    const rows = block
      .split("\n")
      .map((r) => r.trim())
      .filter(Boolean);
    const at = rows.findIndex((r) => TIMING.test(r));
    if (at < 0) continue; // WEBVTT header, NOTE, STYLE, or a stray block
    const cue = rows.slice(at + 1).join(" ");
    if (!cue) continue;
    // WebVTT voice tags: <v Sara Ahmed>words</v>; otherwise "Name: words" stays as it is.
    const voice = /^<v(?:\.[^ >]*)?\s+([^>]+)>(.*)$/.exec(cue);
    const speaker = voice ? voice[1]!.trim() : null;
    const words = (voice ? voice[2]! : cue).replace(/<[^>]+>/g, "").trim();
    if (!words) continue;
    const last = lines[lines.length - 1];
    if (last && speaker && last.speaker === speaker) last.words += ` ${words}`;
    else lines.push({ speaker, words });
  }
  return lines.map((l) => (l.speaker ? `${l.speaker}: ${l.words}` : l.words)).join("\n");
}
