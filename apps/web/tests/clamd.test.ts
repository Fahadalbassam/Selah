import { createServer, type AddressInfo, type Server } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { scanWithClamd } from "@/lib/clamd";

let server: Server | undefined;
afterEach(() => server?.close());

/** A fake clamd that checks the INSTREAM framing and answers `reply`. */
function fakeClamd(reply: (body: Buffer) => string): Promise<number> {
  server = createServer((socket) => {
    let buf = Buffer.alloc(0);
    socket.on("data", (d) => {
      buf = Buffer.concat([buf, d]);
      const cmd = "zINSTREAM\0";
      if (buf.length < cmd.length) return;
      let off = cmd.length;
      const parts: Buffer[] = [];
      for (;;) {
        if (buf.length < off + 4) return;
        const n = buf.readUInt32BE(off);
        if (n === 0) break;
        if (buf.length < off + 4 + n) return;
        parts.push(buf.subarray(off + 4, off + 4 + n));
        off += 4 + n;
      }
      socket.end(`${reply(Buffer.concat(parts))}\0`);
    });
  });
  return new Promise((r) => server!.listen(0, "127.0.0.1", () => r((server!.address() as AddressInfo).port)));
}

describe("clamd INSTREAM client", () => {
  it("reports a clean file and streams every byte", async () => {
    const big = new Uint8Array(200_000).fill(7);
    let received = 0;
    const port = await fakeClamd((body) => ((received = body.length), "stream: OK"));
    await expect(scanWithClamd(big, "127.0.0.1", port)).resolves.toEqual({ clean: true });
    expect(received).toBe(200_000);
  });

  it("reports the signature of an infected file", async () => {
    const port = await fakeClamd(() => "stream: Eicar-Signature FOUND");
    await expect(scanWithClamd(new Uint8Array([1]), "127.0.0.1", port)).resolves.toEqual({ clean: false, signature: "Eicar-Signature" });
  });

  it("fails closed on errors and unreachable daemons", async () => {
    const port = await fakeClamd(() => "INSTREAM size limit exceeded. ERROR");
    await expect(scanWithClamd(new Uint8Array([1]), "127.0.0.1", port)).rejects.toThrow(/unexpected/);
    await expect(scanWithClamd(new Uint8Array([1]), "127.0.0.1", 1)).rejects.toThrow();
  });
});
