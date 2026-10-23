import { strFromU8, strToU8, unzipSync, zipSync, type Unzipped } from "fflate";

/**
 * Office files (.xlsx, .docx) are zip archives of XML. This opens one with
 * hard limits, so a crafted file (a zip bomb, thousands of entries) is
 * refused before it can use up memory. Only the entries a reader asks for
 * are inflated.
 */
export const ZIP_LIMITS = {
  /** Entries in the archive. Real workbooks and documents have tens. */
  entries: 2000,
  /** One inflated entry. */
  entryBytes: 40 * 1024 * 1024,
  /** All inflated entries together. */
  totalBytes: 80 * 1024 * 1024,
  /** Inflated size over compressed size. Text XML compresses well, but not this well. */
  ratio: 200,
};

export class OfficeFileError extends Error {
  constructor(readonly reason: "not_office" | "too_large" | "unsafe" | "empty") {
    super(`office file refused: ${reason}`);
  }
}

/** Inflate the entries `want` picks (by path) and return them as text. */
export function readEntries(bytes: Uint8Array, want: (path: string) => boolean): Map<string, string> {
  let entries = 0;
  let total = 0;
  let files: Unzipped;
  try {
    files = unzipSync(bytes, {
      filter(file) {
        if (++entries > ZIP_LIMITS.entries) throw new OfficeFileError("too_large");
        if (!want(file.name)) return false;
        if (file.originalSize > ZIP_LIMITS.entryBytes) throw new OfficeFileError("too_large");
        if (file.size > 0 && file.originalSize / file.size > ZIP_LIMITS.ratio && file.originalSize > 1024 * 1024)
          throw new OfficeFileError("unsafe");
        total += file.originalSize;
        if (total > ZIP_LIMITS.totalBytes) throw new OfficeFileError("too_large");
        return true;
      },
    });
  } catch (err) {
    if (err instanceof OfficeFileError) throw err;
    throw new OfficeFileError("not_office");
  }
  const out = new Map<string, string>();
  for (const [name, data] of Object.entries(files)) {
    // The declared size is what was checked; refuse an entry that lied about it.
    if (data.byteLength > ZIP_LIMITS.entryBytes) throw new OfficeFileError("unsafe");
    out.set(name, strFromU8(data));
  }
  return out;
}

/** Build a zip from text entries (for writing .xlsx). */
export function writeZip(entries: Record<string, string>): Uint8Array {
  const files: Record<string, Uint8Array> = {};
  for (const [name, text] of Object.entries(entries)) files[name] = strToU8(text);
  return zipSync(files, { level: 6 });
}
