// Review of PR #208, S3: the model answers one question at a time for
// everyone, and on a processor each takes minutes, so one person may have only
// so many answers on their way: one for a client person, two for firm staff.
// Another is refused with a plain message before anything is searched or counted.
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConflictError } from "@/server/errors";
import { ANSWERS_AT_ONCE, takeAnswerSlot } from "@/services/assistant-in-flight";
import { principal } from "./fixtures";

const stream = vi.hoisted(() => ({ ends: [] as (() => void)[], prepare: vi.fn() }));

vi.mock("next/headers", () => ({ headers: async () => new Headers({ accept: "application/x-ndjson" }) }));
vi.mock("@/server/http", () => ({ route: (_options: unknown, handler: unknown) => handler }));
vi.mock("@/services/masking", () => ({ maskingOn: async () => true }));
vi.mock("@/services/assistant", () => ({
  ask: vi.fn(),
  prepareAsk: stream.prepare,
  streamAnswer: (_p: unknown, _prepared: unknown, onEnd: () => void) => {
    stream.ends.push(onEnd);
    return new ReadableStream();
  },
}));

const { POST } = (await import("@/app/api/assistant/query/route")) as unknown as {
  POST: (ctx: { tx: unknown; principal: ReturnType<typeof principal>; prepared: boolean; body: { question: string } }) => Promise<Response>;
};

const asking = (who: ReturnType<typeof principal>) => POST({ tx: {}, principal: who, prepared: true, body: { question: "What is overdue?" } });

afterEach(() => {
  for (const end of stream.ends.splice(0)) end();
  stream.prepare.mockReset();
});

describe("answers on their way at once", () => {
  it("are one for a client person and two for firm staff, each person on their own", () => {
    expect(ANSWERS_AT_ONCE).toEqual({ firm: 2, client: 1 });
    const a = takeAnswerSlot("client-a", "client");
    expect(a).not.toBeNull();
    expect(takeAnswerSlot("client-a", "client")).toBeNull();
    // Someone else is not held up by them.
    const b = takeAnswerSlot("client-b", "client");
    expect(b).not.toBeNull();
    const s1 = takeAnswerSlot("staff", "firm");
    const s2 = takeAnswerSlot("staff", "firm");
    expect(s1 && s2).toBeTruthy();
    expect(takeAnswerSlot("staff", "firm")).toBeNull();
    // Given back twice by mistake, it still counts once.
    a!();
    a!();
    const again = takeAnswerSlot("client-a", "client");
    expect(again).not.toBeNull();
    expect(takeAnswerSlot("client-a", "client")).toBeNull();
    for (const r of [again, b, s1, s2]) r!();
  });

  it("refuses a client person's second question while the first streams, and takes it once that one is saved", async () => {
    stream.prepare.mockResolvedValue({});
    const client = principal("client_manager");
    const first = await asking(client);
    expect(first.headers.get("content-type")).toContain("application/x-ndjson");
    const second = asking(client);
    await expect(second).rejects.toBeInstanceOf(ConflictError);
    await expect(second).rejects.toThrow("answer in progress");
    // Refused before the search, so the daily count is not touched.
    expect(stream.prepare).toHaveBeenCalledTimes(1);
    stream.ends.shift()!();
    await expect(asking(client)).resolves.toBeInstanceOf(Response);
  });

  it("gives the slot back when the question fails before its stream starts", async () => {
    const client = principal("client_manager");
    stream.prepare.mockRejectedValueOnce(new Error("search failed"));
    await expect(asking(client)).rejects.toThrow("search failed");
    stream.prepare.mockResolvedValue({});
    await expect(asking(client)).resolves.toBeInstanceOf(Response);
  });
});
