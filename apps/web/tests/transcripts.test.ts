import { describe, expect, it } from "vitest";
import { formatOf, parseTranscript } from "../src/lib/transcripts";

describe("transcript parsing", () => {
  it("reads WebVTT with voice tags, joining one speaker's cues and dropping timings and notes", () => {
    const vtt = `WEBVTT

NOTE made by Meet

1
00:00:01.000 --> 00:00:04.000
<v Sara Ahmed>The board meets quarterly.</v>

2
00:00:04.500 --> 00:00:06.000
<v Sara Ahmed>Minutes go out within a week.</v>

00:00:06.000 --> 00:00:08.000
<v.loud Khalid>Agreed, <b>starting</b> next month.</v>
`;
    expect(parseTranscript(vtt, "vtt")).toBe(
      "Sara Ahmed: The board meets quarterly. Minutes go out within a week.\nKhalid: Agreed, starting next month.",
    );
  });

  it("reads SubRip with Windows line ends and Arabic text", () => {
    const srt =
      "1\r\n00:00:01,000 --> 00:00:03,000\r\nسارة: يجتمع المجلس كل ربع سنة.\r\n\r\n2\r\n00:00:03,500 --> 00:00:05,000\r\nخالد: موافق.\r\n";
    expect(parseTranscript(srt, "srt")).toBe("سارة: يجتمع المجلس كل ربع سنة.\nخالد: موافق.");
  });

  it("keeps pasted text as it is, trimmed, and tells formats by extension", () => {
    expect(parseTranscript("﻿  Sara: hello \n", "text")).toBe("Sara: hello");
    expect(formatOf("Meeting.VTT")).toBe("vtt");
    expect(formatOf("call.srt")).toBe("srt");
    expect(formatOf("transcript.txt")).toBe("text");
  });
});
