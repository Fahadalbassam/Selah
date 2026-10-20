/**
 * What may be uploaded as a document or evidence (ASVS V5). Pure so it can be
 * unit-tested and shown to the user before they pick a file.
 *
 * A file passes only if its extension, its declared type and its first bytes
 * agree. The declared type alone is chosen by the browser and can be forged.
 */
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

const ZIP = [0x50, 0x4b, 0x03, 0x04];
const OLE = [0xd0, 0xcf, 0x11, 0xe0];

interface FileKind {
  ext: string;
  mime: string;
  magic: number[] | null;
}

const KINDS: FileKind[] = [
  { ext: "pdf", mime: "application/pdf", magic: [0x25, 0x50, 0x44, 0x46] },
  { ext: "docx", mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", magic: ZIP },
  { ext: "xlsx", mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", magic: ZIP },
  { ext: "pptx", mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation", magic: ZIP },
  { ext: "doc", mime: "application/msword", magic: OLE },
  { ext: "xls", mime: "application/vnd.ms-excel", magic: OLE },
  { ext: "png", mime: "image/png", magic: [0x89, 0x50, 0x4e, 0x47] },
  { ext: "jpg", mime: "image/jpeg", magic: [0xff, 0xd8, 0xff] },
  { ext: "jpeg", mime: "image/jpeg", magic: [0xff, 0xd8, 0xff] },
  { ext: "txt", mime: "text/plain", magic: null },
  { ext: "csv", mime: "text/csv", magic: null },
];

export const ACCEPTED_EXTENSIONS = KINDS.map((k) => `.${k.ext}`).join(",");

export type UploadCheck =
  | { ok: true; contentType: string; fileName: string }
  | { ok: false; reason: "empty" | "too_large" | "type" };

/** Keep the user's name readable but safe for a header and a file system. */
export function cleanFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  const cleaned = base
    .normalize("NFC")
    .replace(/[\u0000-\u001f\u007f"<>|:*?]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(-150);
  return cleaned || "file";
}

export function checkUpload(name: string, declaredType: string, size: number, head: Uint8Array): UploadCheck {
  if (size <= 0) return { ok: false, reason: "empty" };
  if (size > MAX_UPLOAD_BYTES) return { ok: false, reason: "too_large" };
  const fileName = cleanFileName(name);
  const ext = fileName.includes(".") ? fileName.split(".").pop()!.toLowerCase() : "";
  const kind = KINDS.find((k) => k.ext === ext);
  if (!kind) return { ok: false, reason: "type" };
  // Browsers send an empty type for some files; when they do send one it must match.
  const declared = declaredType.split(";")[0]!.trim().toLowerCase();
  if (declared && declared !== kind.mime && declared !== "application/octet-stream") return { ok: false, reason: "type" };
  if (kind.magic && !kind.magic.every((b, i) => head[i] === b)) return { ok: false, reason: "type" };
  if (!kind.magic && head.slice(0, 512).includes(0)) return { ok: false, reason: "type" };
  return { ok: true, contentType: kind.mime, fileName };
}
