// The public form's fixed choices (src/lib/intake.ts) are the database's
// enums (src/db/schema). The page and API use the first, the database the second.
import { describe, expect, it } from "vitest";
import {
  contactChannel,
  employeeBand,
  familyGeneration,
  familyGovernance,
  familyWorking,
  heardFrom,
  inquirySource,
  inquiryUrgency,
  ownershipType,
  requesterRole,
} from "@/db/schema";
import {
  CONTACT_CHANNELS,
  EMPLOYEE_BANDS,
  FAMILY_GENERATIONS,
  FAMILY_GOVERNANCE,
  FAMILY_OWNERSHIP,
  FAMILY_WORKING,
  HEARD_FROM,
  INQUIRY_SOURCES,
  OWNERSHIP_TYPES,
  REQUESTER_ROLES,
  URGENCIES,
} from "@/lib/intake";

describe("intake choices", () => {
  it.each([
    ["employee_band", EMPLOYEE_BANDS, employeeBand.enumValues],
    ["ownership_type", OWNERSHIP_TYPES, ownershipType.enumValues],
    ["inquiry_urgency", URGENCIES, inquiryUrgency.enumValues],
    ["heard_from", HEARD_FROM, heardFrom.enumValues],
    ["inquiry_source", INQUIRY_SOURCES, inquirySource.enumValues],
    ["requester_role", REQUESTER_ROLES, requesterRole.enumValues],
    ["contact_channel", CONTACT_CHANNELS, contactChannel.enumValues],
    ["family_generation", FAMILY_GENERATIONS, familyGeneration.enumValues],
    ["family_working", FAMILY_WORKING, familyWorking.enumValues],
    ["family_governance", FAMILY_GOVERNANCE, familyGovernance.enumValues],
  ])("%s matches the database enum", (_, ts, db) => {
    expect([...ts]).toEqual([...db]);
  });

  it("family ownership types are ownership types", () => {
    for (const o of FAMILY_OWNERSHIP) expect(OWNERSHIP_TYPES).toContain(o);
  });
});
