import { describe, expect, it } from "vitest";
import { callProvider, departmentsToOffer, leftOutOfMeeting, localInstant, localParts, meetingError } from "@/lib/meetings";

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
    // Riyadh time whatever the browser's zone: 09:30 in Riyadh is 06:30 UTC.
    expect(d.toISOString()).toBe("2026-11-03T06:30:00.000Z");
    expect(localParts(new Date("2026-11-03T22:15:00Z"))).toEqual({ date: "2026-11-04", time: "01:15" });
    expect(localInstant("2026-11-03", "")).toBeNull();
  });

  it("map the database's refusals to the form's messages", () => {
    expect(meetingError("use a Google Meet, Teams or Zoom link starting with https://")).toBe("badLink");
    expect(meetingError("that person cannot open this meeting's project")).toBe("cannotOpen");
    expect(meetingError("refused by a data rule")).toBeNull();
    expect(meetingError("book a meeting for one of your departments: a whole-project meeting is for people who see all of the project's work")).toBe(
      "wholeProject",
    );
  });
});

// Decision 1a: the booking form says, before saving, who could not open a
// meeting of the whole project, and offers a department's meeting instead.
describe("the invite warning", () => {
  const people = [
    { userId: "a", name: "Sara", wholeProject: false, departmentIds: ["board"] },
    { userId: "b", name: "Huda", wholeProject: true, departmentIds: ["legal"] },
    { userId: "c", name: "Omar", wholeProject: false, departmentIds: ["board", "legal"] },
  ];
  const bookable = [
    { id: "board", label: "Board secretariat" },
    { id: "finance", label: "Finance" },
  ];

  it("names the people chosen who could not open a meeting of the whole project", () => {
    expect(leftOutOfMeeting(people, ["a", "b"], null).map((p) => p.name)).toEqual(["Sara"]);
    expect(leftOutOfMeeting(people, ["a", "b", "c"], null).map((p) => p.name)).toEqual(["Sara", "Omar"]);
    expect(leftOutOfMeeting(people, ["b"], null)).toEqual([]);
  });

  it("says nothing for a department's meeting: whoever is invited to one opens it", () => {
    expect(leftOutOfMeeting(people, ["a", "c"], "finance")).toEqual([]);
  });

  it("offers the departments of the people left out that the organiser may book for", () => {
    expect(departmentsToOffer(leftOutOfMeeting(people, ["a", "c"], null), bookable).map((d) => d.label)).toEqual(["Board secretariat"]);
    expect(departmentsToOffer([], bookable)).toEqual([]);
  });
});
