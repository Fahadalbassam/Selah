// The project's activity tab and the roll-ups show words, never raw keys:
// every event the app records and every project state has a label in both
// languages (review findings R02 and R03).
import { describe, expect, it } from "vitest";
import { projectState } from "@/db/schema";
import ar from "../messages/ar.json";
import en from "../messages/en.json";

// Action events written by the services; status changes show as "from → to".
const ACTION_EVENTS = [
  "created",
  "updated",
  "progress_update",
  "commented",
  "evidence_submitted",
  "evidence_requested",
  // EVIDENCE_REQUEST_MOVES in services/follow-through.ts
  ...["accepted", "rejected", "waived", "open"].map((s) => `evidence_request_${s}`),
  "risk_accepted",
  "deadline_change_requested",
  "deadline_change_approved",
  "deadline_change_rejected",
];
// Findings and recommendations are labelled by kind: "updated a recommendation", not "updated an action".
const RECORD_EVENTS = ["finding", "recommendation"].flatMap((k) => ["updated", "released", "withdrawn"].map((e) => `${k}_${e}`));
const RESPONSE_EVENTS = ["responded", "response_confirmed", "response_answered"].map((e) => `recommendation_${e}`);
const OTHER_EVENTS = [
  "document_shared",
  "document_withdrawn",
  "department_moved",
  "assessment_started",
  "assessment_finalised",
  "assessment_shared",
  "assessment_unshared",
  "info_request_added",
  "info_requests_added",
  "info_request_answered",
  "info_request_file_removed",
  "info_request_reviewed",
  "info_request_returned",
  "info_request_reopened",
  "info_request_not_applicable",
  "info_request_removed",
  "info_request_link_upload",
  "other",
];

describe.each([
  ["ar", ar],
  ["en", en],
])("%s labels", (_, messages) => {
  it("names every activity event", () => {
    const events = messages.project.events as Record<string, string>;
    const missing = [...ACTION_EVENTS, ...RECORD_EVENTS, ...RESPONSE_EVENTS, ...OTHER_EVENTS].filter((e) => !events[e]);
    expect(missing).toEqual([]);
  });

  it("names every project state", () => {
    const states = messages.phases.states as Record<string, string>;
    expect(projectState.enumValues.filter((s) => !states[s])).toEqual([]);
  });
});
