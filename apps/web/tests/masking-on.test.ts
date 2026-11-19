// Phase 3, R1: names are masked unless the AI service itself says its model is local.
// Closed by default: if the service cannot be asked, or answers anything else, the text is masked.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/env", () => ({
  env: () => ({ AI_SERVICE_URL: "http://ai.test:8000", AI_SERVICE_TOKEN: "t".repeat(40) }),
}));

const { modelIsLocal } = await import("@/services/ai-client");
const { maskingOn } = await import("@/services/masking");

const reply = (status: number, body: unknown) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("modelIsLocal", () => {
  it("is true only when the service answers local: true", async () => {
    const fetch = reply(200, { local: true, model: "qwen3:4b" });
    vi.stubGlobal("fetch", fetch);
    expect(await modelIsLocal()).toBe(true);
    const [url, init] = fetch.mock.calls[0] as unknown as [URL, RequestInit];
    expect(String(url)).toBe("http://ai.test:8000/v1/model");
    expect((init.headers as Record<string, string>).authorization).toBe(`Bearer ${"t".repeat(40)}`);
  });

  it.each([
    ["a hosted model", 200, { local: false, model: "gpt-oss:120b" }],
    ["an answer in another shape", 200, { provider: "ollama" }],
    ["local as a string", 200, { local: "true" }],
    ["an older service without the route", 404, { detail: "Not Found" }],
    ["a refused token", 401, { detail: "unauthorized" }],
  ])("is false for %s", async (_name, status, body) => {
    vi.stubGlobal("fetch", reply(status, body));
    expect(await modelIsLocal()).toBe(false);
  });

  it("is false when the service cannot be reached", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    );
    expect(await modelIsLocal()).toBe(false);
  });
});

describe("maskingOn", () => {
  const auto = { AI_MASKING: "auto", LLM_PROVIDER: "ollama" } as const;

  it("masks with auto unless the service says local", async () => {
    expect(await maskingOn(auto, async () => true)).toBe(false);
    expect(await maskingOn(auto, async () => false)).toBe(true);
  });

  it("masks when asking the service throws", async () => {
    expect(
      await maskingOn(auto, async () => {
        throw new Error("down");
      }),
    ).toBe(true);
  });

  it("masks when the service cannot be reached (the real check)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    );
    expect(await maskingOn(auto)).toBe(true);
  });

  it("masks when this app says hosted, without asking", async () => {
    const local = vi.fn(async () => true);
    expect(await maskingOn({ AI_MASKING: "auto", LLM_PROVIDER: "openai_compat" }, local)).toBe(true);
    expect(local).not.toHaveBeenCalled();
  });

  it("keeps the forced settings", async () => {
    expect(await maskingOn({ AI_MASKING: "on", LLM_PROVIDER: "ollama" }, async () => true)).toBe(true);
    expect(await maskingOn({ AI_MASKING: "off", LLM_PROVIDER: "openai_compat" }, async () => false)).toBe(false);
  });
});

describe("where the masking decision and the 'local' wording come from", () => {
  const src = (p: string) => readFileSync(join(__dirname, "../src", p), "utf8");

  it("is worked out before the transaction opens, on every route that sends text to the model", () => {
    for (const p of [
      "app/api/assistant/query/route.ts",
      "app/api/translations/route.ts",
      "app/api/documents/[id]/summary/route.ts",
      "app/api/clients/[id]/structure/import/draft/route.ts",
    ]) {
      expect(src(p), p).toMatch(/prepare: \(\) => maskingOn\(\)/);
      expect(src(p), p).toMatch(/prepared/);
    }
  });

  it("says 'local' only when the AI service says so, never from this app's setting alone", () => {
    expect(src("app/(public)/legal/[doc]/page.tsx")).toMatch(/LLM_PROVIDER !== "ollama" \|\| !\(await modelIsLocal\(\)\)/);
    expect(src("services/assistant.ts")).toMatch(/LLM_PROVIDER === "ollama" && \(await modelIsLocal\(\)\) \? \("local" as const\)/);
  });
});
