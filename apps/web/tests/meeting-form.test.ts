import { describe, expect, it } from "vitest";
import { callProvider, localInstant, localParts, meetingError } from "@/lib/meetings";

describe("meeting form helpers", () => {
  it("accept the same call links as the database", () => {
    expect(callProvider("https://meet.google.com/abc-defg-hij")).toBe("google_meet");
    expect(callProvider("https://teams.microsoft.com/l/meetup-join/x")).toBe("teams");
    expect(callProvider("https://acme.zoom.us/j/123")).toBe("zoom");
    expect(callProvider("http://meet.google.com/abc")).toBeNull();
    expect(callProvider("https://meet.google.com.evil.example/abc")).toBeNull();
    expect(callProvider("https://evil.example/?https://meet.google.com")).toBeNull();
  });

  it("turn a local date and time into an instant and back", () => {
    const d = localInstant("2026-11-03", "09:30")!;
    expect(localParts(d)).toEqual({ date: "2026-11-03", time: "09:30" });
    expect(localInstant("2026-11-03", "")).toBeNull();
  });

  it("map the database's refusals to the form's messages", () => {
    expect(meetingError("use a Google Meet, Teams or Zoom link starting with https://")).toBe("badLink");
    expect(meetingError("that person cannot open this meeting's project")).toBe("cannotOpen");
    expect(meetingError("refused by a data rule")).toBeNull();
  });
});
