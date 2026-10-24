// The way in, as the legal pages read it from COMPOSE_PROFILES (R5).
import { describe, expect, it } from "vitest";
import { edgeMode, legalDocFromSlug, LEGAL_DOCS, LEGAL_SLUGS } from "@/lib/legal";

describe("edge mode", () => {
  it("reads direct or tunnel from the compose profiles, direct winning", () => {
    expect(edgeMode(undefined)).toBeNull();
    expect(edgeMode("")).toBeNull();
    expect(edgeMode("tunnel")).toBe("tunnel");
    expect(edgeMode("gpu, direct")).toBe("direct");
    expect(edgeMode("tunnel,direct")).toBe("direct");
    expect(edgeMode("tunnels")).toBeNull();
  });
});

describe("legal slugs", () => {
  it("map every document both ways, the security overview included", () => {
    for (const d of LEGAL_DOCS) expect(legalDocFromSlug(LEGAL_SLUGS[d])).toBe(d);
    expect(legalDocFromSlug("security")).toBe("security");
    expect(legalDocFromSlug("nope")).toBeNull();
  });
});
