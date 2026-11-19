// Node's own fetch gives up on a response's headers after 300 s, whatever the
// call's limit (review of PR #208, S2), so a 10-minute model call failed at 5.
// Through a real server: the agent the AI client hands to fetch is the one
// that decides how long fetch waits. (Small limits stand for the long ones.)
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { patientDispatcher } from "@/services/ai-client";

let server: Server;
let url: string;

beforeAll(async () => {
  // A model reading the prompt: no headers for 1.5 s.
  server = createServer((_req, res) => setTimeout(() => res.end("{}"), 1_500));
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
});

afterAll(() => new Promise<void>((done) => server.close(() => done())));

const ask = (ms: number) => fetch(url, { method: "POST", body: "{}", dispatcher: patientDispatcher(ms) } as RequestInit);

describe("patientDispatcher with Node's fetch", () => {
  it("waits for headers as long as its limit allows", async () => {
    const res = await ask(5_000);
    expect(await res.json()).toEqual({});
  });

  it("is what decides: a shorter limit than the server takes fails on the headers", async () => {
    await expect(ask(500)).rejects.toMatchObject({ cause: { code: "UND_ERR_HEADERS_TIMEOUT" } });
  });
});
