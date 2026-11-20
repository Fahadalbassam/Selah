// A refused id says so (scenario 20, 20 Nov 2026): an id that is not a valid
// UUID, in the address or as the only thing wrong with a body, answers 400
// "invalid id" with the field names (never the values), so the screen can
// say the item was not recognised instead of "check what you entered".
import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/auth/auth", () => ({ auth: () => ({ api: { getSession: async () => ({ user: { id: "a9810ef3-3d79-405a-b5e3-ca96a900dd6a", twoFactorEnabled: true } }) } }) }));
vi.mock("@/db/client", () => ({
  asUser: async () => {
    throw new Error("the handler must not run");
  },
  asAnonymous: async () => {
    throw new Error("the handler must not run");
  },
}));
vi.mock("@/env", () => ({ env: () => ({ APP_URL: "http://localhost:3000", TWO_FACTOR_REQUIRED: "false" }) }));
vi.mock("@/services/audit", () => ({ auditDetached: async () => undefined }));
vi.mock("@/services/consent", () => ({ pendingConsents: async () => [] }));
vi.mock("@/services/principal", () => ({ loadPrincipal: async () => null }));

const { route } = await import("@/server/http");

const OLD_STYLE = "8660cc23-a53e-cc43-6dd2-83b2b18553d1"; // a unit id the old copy made (version digit c, variant 6)
const handler = route(
  { params: z.object({ unitId: z.uuid() }), body: z.object({ parentId: z.uuid().nullish(), code: z.string().max(4).optional() }) },
  async () => ({ ok: true }),
);
const call = (unitId: string, body: unknown) =>
  handler(
    new NextRequest(`http://localhost:3000/api/org-chart/units/${unitId}`, {
      method: "PATCH",
      headers: { origin: "http://localhost:3000", "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ unitId }) },
  );

describe("a refused id", () => {
  it("in the address answers 400 invalid id with the field's name, not its value", async () => {
    const res = await call(OLD_STYLE, {});
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toEqual({ error: "bad_request", message: "invalid id", fields: ["unitId"] });
    expect(JSON.stringify(body)).not.toContain(OLD_STYLE);
  });

  it("as the only thing wrong with a body is an invalid id too; anything else stays invalid input", async () => {
    const good = "a9810ef3-3d79-405a-b5e3-ca96a900dd6a";
    expect(await (await call(good, { parentId: OLD_STYLE })).json()).toEqual({ error: "bad_request", message: "invalid id", fields: ["parentId"] });
    expect(await (await call(good, { parentId: OLD_STYLE, code: "too long" })).json()).toEqual({
      error: "bad_request",
      message: "invalid input",
      fields: ["parentId", "code"],
    });
  });
});
