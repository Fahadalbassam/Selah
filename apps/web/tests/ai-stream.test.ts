// Section 7 test run: on a processor-only server the model read a long prompt
// for minutes before its first word, the stream sent nothing, and the web's
// idle timer turned a slow answer into an error. The AI service now sends a
// "wait" line every 10 seconds; these keep the stream open, and the overall
// limit still ends it.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/env", () => ({
  env: () => ({ AI_SERVICE_URL: "http://ai.test:8000", AI_SERVICE_TOKEN: "t".repeat(40) }),
}));

const { answerStream, STREAM_IDLE_MS, STREAM_TOTAL_MS } = await import("@/services/ai-client");

const WAIT = '{"type":"wait"}\n';
const DONE = `${JSON.stringify({ type: "done", answer: { answer: "Quarterly.", cited_ids: ["P1"], grounded: true } })}\n`;

/**
 * A fake AI service: `script` gets a function to send a line and runs on
 * fake timers. The body errors when the caller's signal aborts, as fetch's does.
 */
function service(script: (send: (line: string) => void, end: () => void) => void) {
  return vi.fn(async (_url: URL, init: RequestInit) => {
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        init.signal?.addEventListener("abort", () => controller.error(init.signal!.reason));
        script(
          // Nothing more once the caller has given up.
          (line) => init.signal?.aborted || controller.enqueue(encoder.encode(line)),
          () => init.signal?.aborted || controller.close(),
        );
      },
    });
    return new Response(body, { status: 200, headers: { "content-type": "application/x-ndjson" } });
  });
}

const ask = (onWait = () => {}) =>
  answerStream("How often does the board meet?", [{ id: "P1", text: "The board meets quarterly.", source: "doc" }], "en", [], "staff", () => {}, { onWait });

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("answerStream on a slow model", () => {
  it("stays open through minutes of waits, longer than the idle limit, and gives the answer", async () => {
    vi.stubGlobal(
      "fetch",
      service((send, end) => {
        // Six minutes of reading the prompt (the slowest answer in the test run), a wait every 10 s.
        const beat = setInterval(() => send(WAIT), 10_000);
        setTimeout(() => {
          clearInterval(beat);
          send(DONE);
          end();
        }, 360_000);
      }),
    );
    const onWait = vi.fn();
    const answer = ask(onWait);
    await vi.advanceTimersByTimeAsync(360_000);
    await expect(answer).resolves.toEqual({ answer: "Quarterly.", cited_ids: ["P1"], grounded: true });
    // Each wait reaches the caller, which tells the person it is still working.
    expect(onWait.mock.calls.length).toBeGreaterThanOrEqual(35);
  });

  it("ends a stream that goes quiet with no waits after the idle limit", async () => {
    vi.stubGlobal(
      "fetch",
      service((send) => {
        send(WAIT);
      }),
    );
    const answer = ask();
    const settled = vi.fn();
    answer.catch(settled);
    await vi.advanceTimersByTimeAsync(STREAM_IDLE_MS - 1_000);
    expect(settled).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2_000);
    await expect(answer).rejects.toThrow(/no line from the answer stream/);
  });

  it("still ends after the overall limit while waits keep coming", async () => {
    vi.stubGlobal(
      "fetch",
      service((send) => {
        setInterval(() => send(WAIT), 10_000);
      }),
    );
    const answer = ask();
    const settled = vi.fn();
    answer.catch(settled);
    await vi.advanceTimersByTimeAsync(STREAM_TOTAL_MS - 1_000);
    expect(settled).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2_000);
    await expect(answer).rejects.toThrow(/took over 10 minutes/);
    vi.clearAllTimers();
  });
});
