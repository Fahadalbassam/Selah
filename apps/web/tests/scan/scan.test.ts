import { deflateRawSync, crc32 } from "node:zlib";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

// Runs against a real clamd (CLAMD_HOST, default port 3310). Nothing here
// touches the database or the bucket: those modules are replaced with spies,
// so the tests can also prove that a refused upload never reaches them.
const state = vi.hoisted(() => ({
  env: {
    NODE_ENV: "test",
    SCAN_REQUIRED: "true",
    CLAMD_HOST: process.env.CLAMD_HOST ?? "localhost",
    CLAMD_PORT: Number(process.env.CLAMD_PORT ?? 3310),
  },
  audits: [] as Array<Record<string, unknown>>,
  stored: 0,
  transactions: 0,
}));

vi.mock("@/env", () => ({ env: () => state.env }));
vi.mock("@/services/audit", () => ({
  audit: async () => undefined,
  auditDetached: async (entry: Record<string, unknown>) => void state.audits.push(entry),
}));
vi.mock("@/services/storage", () => ({
  putObject: async () => void state.stored++,
}));
vi.mock("@/db/client", () => ({
  asUser: async () => void state.transactions++,
  asAnonymous: async () => void state.transactions++,
}));

const { prepareUpload } = await import("@/services/evidence");
const { UnavailableError, BadRequestError } = await import("@/server/errors");

// The EICAR test string, assembled at runtime so this file itself is never
// flagged by a scanner on a developer's machine.
const EICAR = Buffer.from(["X5O!P%@AP[4\\PZX54(P^)7CC)7}$", "EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*"].join(""));

const PDF = Buffer.from(
  "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\n" +
    "trailer<</Root 1 0 R>>\n%%EOF\n",
);

/** A one-entry zip archive (deflated), enough for ClamAV to unpack. */
function zip(name: string, content: Buffer): Buffer {
  const data = deflateRawSync(content);
  const nameBytes = Buffer.from(name);
  const crc = crc32(content);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(8, 8);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(content.length, 22);
  local.writeUInt16LE(nameBytes.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(8, 10);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(content.length, 24);
  central.writeUInt16LE(nameBytes.length, 28);
  const centralStart = local.length + nameBytes.length + data.length;
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + nameBytes.length, 12);
  end.writeUInt32LE(centralStart, 16);
  return Buffer.concat([local, nameBytes, data, central, nameBytes, end]);
}

const file = (bytes: Buffer, name: string, type: string) => new File([new Uint8Array(bytes)], name, { type });
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const USER = "00000000-0000-4000-8000-000000000001";
const ACTION = "00000000-0000-4000-8000-000000000002";

beforeEach(() => {
  state.env.CLAMD_PORT = Number(process.env.CLAMD_PORT ?? 3310);
  state.audits.length = 0;
});

afterAll(() => {
  // A refused upload never opens a transaction or writes to the bucket.
  expect(state.transactions).toBe(0);
  expect(state.stored).toBe(0);
});

describe("upload scanning against clamd", () => {
  const infected: Array<[string, File]> = [
    ["EICAR as a text file", file(EICAR, "notes.txt", "text/plain")],
    ["EICAR inside a zip named .docx", file(zip("word/document.xml", EICAR), "report.docx", DOCX)],
    ["EICAR appended to a PDF", file(Buffer.concat([PDF, EICAR]), "evidence.pdf", "application/pdf")],
  ];

  it.each(infected)("refuses %s and audits the refusal", async (_label, upload) => {
    await expect(prepareUpload(USER, ACTION, upload)).rejects.toThrow(BadRequestError);
    await expect(prepareUpload(USER, ACTION, upload)).rejects.toThrow("file rejected: infected");
    expect(state.audits).toContainEqual(
      expect.objectContaining({
        actorId: USER,
        outcome: "deny",
        reason: "infected",
      }),
    );
  });

  it("accepts a clean PDF as scanned", async () => {
    const prepared = await prepareUpload(USER, ACTION, file(PDF, "evidence.pdf", "application/pdf"));
    expect(prepared.scanned).toBe(true);
    expect(prepared.contentType).toBe("application/pdf");
    expect(state.audits).toHaveLength(0);
  });

  it("refuses with 503 when clamd is down", async () => {
    state.env.CLAMD_PORT = 1; // nothing listens there
    const err = await prepareUpload(USER, ACTION, file(PDF, "evidence.pdf", "application/pdf")).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UnavailableError);
    expect(state.audits).toHaveLength(0);
  });
});
