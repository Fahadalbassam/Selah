import { createConnection } from "node:net";

export type ScanResult = { clean: true } | { clean: false; signature: string };

const CHUNK = 64 * 1024;

/**
 * Scan bytes with a ClamAV daemon using the INSTREAM command. Throws when the
 * daemon cannot be reached or answers something unexpected, so callers fail
 * closed: a file that was not scanned is never treated as clean.
 */
export function scanWithClamd(bytes: Uint8Array, host: string, port: number, timeoutMs = 20_000): Promise<ScanResult> {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host, port });
    const chunks: Buffer[] = [];
    const fail = (err: Error) => {
      socket.destroy();
      reject(err);
    };
    socket.setTimeout(timeoutMs, () => fail(new Error("clamd timed out")));
    socket.on("error", fail);
    socket.on("connect", () => {
      socket.write("zINSTREAM\0");
      for (let i = 0; i < bytes.byteLength; i += CHUNK) {
        const part = bytes.subarray(i, i + CHUNK);
        const size = Buffer.alloc(4);
        size.writeUInt32BE(part.byteLength);
        socket.write(size);
        socket.write(part);
      }
      socket.write(Buffer.alloc(4)); // zero length ends the stream
    });
    socket.on("data", (d) => chunks.push(d));
    socket.on("end", () => {
      const reply = Buffer.concat(chunks).toString("utf8").replace(/\0/g, "").trim();
      socket.destroy();
      if (reply === "stream: OK") return resolve({ clean: true });
      const found = /^stream: (.+) FOUND$/.exec(reply);
      if (found) return resolve({ clean: false, signature: found[1]! });
      reject(new Error(`unexpected clamd reply: ${reply.slice(0, 200)}`));
    });
  });
}
