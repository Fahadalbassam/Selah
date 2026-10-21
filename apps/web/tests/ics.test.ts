import { describe, expect, it } from "vitest";
import { buildIcs, escapeText, fold } from "@/lib/ics";

const meeting = {
  uid: "abc@selah",
  sequence: 2,
  status: "scheduled" as const,
  title: "Status, governance; review",
  startsAt: new Date("2026-11-01T07:00:00Z"),
  endsAt: new Date("2026-11-01T08:00:00.500Z"),
  joinUrl: "https://meet.google.com/abc-defg-hij",
  locationText: null,
  organizer: { name: "سارة", email: "sara@firm.example" },
  attendees: [
    { name: 'Reem "R"', email: "reem@acme.example" },
    { name: "Majed", email: "majed@acme.example", optional: true },
  ],
  updatedAt: new Date("2026-10-21T00:00:00Z"),
};

describe("calendar invites", () => {
  it("are an RFC 5545 request with a stable UID, the sequence and UTC times", () => {
    const ics = buildIcs(meeting);
    expect(ics.endsWith("\r\n")).toBe(true);
    const lines = ics.replace(/\r\n /g, "").split("\r\n"); // unfolded
    expect(lines).toContain("METHOD:REQUEST");
    expect(lines).toContain("UID:abc@selah");
    expect(lines).toContain("SEQUENCE:2");
    expect(lines).toContain("DTSTART:20261101T070000Z");
    expect(lines).toContain("DTEND:20261101T080000Z");
    expect(lines).toContain("SUMMARY:Status\\, governance\; review");
    expect(lines).toContain("STATUS:CONFIRMED");
    expect(lines).toContain('ATTENDEE;CN="Reem R";ROLE=REQ-PARTICIPANT;RSVP=TRUE:mailto:reem@acme.example');
    expect(ics).toContain("ROLE=OPT-PARTICIPANT");
  });

  it("cancel with METHOD:CANCEL and the same UID", () => {
    const lines = buildIcs({ ...meeting, status: "cancelled", sequence: 3 }).split("\r\n");
    expect(lines).toContain("METHOD:CANCEL");
    expect(lines).toContain("STATUS:CANCELLED");
    expect(lines).toContain("UID:abc@selah");
  });

  it("escape text and fold long lines without splitting a character", () => {
    expect(escapeText("a\\b;c,d\ne")).toBe("a\\\\b\;c\\,d\\ne");
    const long = "SUMMARY:" + "م".repeat(60);
    const folded = fold(long).split("\r\n");
    expect(folded.length).toBeGreaterThan(1);
    for (const part of folded) expect(Buffer.byteLength(part)).toBeLessThanOrEqual(75);
    expect(folded.map((p, i) => (i ? p.slice(1) : p)).join("")).toBe(long);
  });
});
