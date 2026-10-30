// A client leaving (baseline: Offboarding, 0025). Shared by the screens, the
// services and the tests; the database holds the same numbers and lists.

/** Days the client's people keep read-only access after archiving. */
export const GRACE_DAYS = { min: 0, max: 90, default: 60 } as const;

/**
 * Years a client's records are kept after it is archived before the purge
 * job deletes them: Saudi law on commercial books (ten years for books and
 * correspondence) and the CMA corporate governance regulations (ten years
 * for minutes and documents).
 */
export const RETENTION_YEARS = 10;

/** Text limits the database enforces. */
export const OFFBOARDING_LIMITS = { note: 2000, reason: { min: 5, max: 2000 } } as const;

/** Client-level tables an archived client freezes (the client_open trigger, check_client_open()). */
export const CLIENT_FROZEN_TABLES = [
  "client_contacts",
  "client_indicator_settings",
  "client_kpi_links",
  "client_kpi_values",
  "client_kpis",
  "client_profiles",
  "departments",
  "engagements",
  "indicator_feeds",
  "indicator_imports",
  "invitations",
  "join_requests",
  "projects",
] as const;

/** What the purge job counts in a deletion record (client_deletions.counts). */
export const DELETION_COUNTS = ["projects", "actions", "documents", "people", "contacts"] as const;

/**
 * The export pack (J14.2): the labels of what a leaving client takes (files
 * shared with it or private to it; never the firm's own), and the most file
 * bytes one pack holds in memory. Files past the cap are listed, not packed.
 */
export const PACK_LABELS = ["shared", "client_private"] as const;
export const PACK_MAX_BYTES = 200 * 1024 * 1024;
export const PACK_RECEIPT_LIMITS = { name: { min: 2, max: 200 }, note: 2000 } as const;

const EXT: Record<string, string> = {
  "application/pdf": "pdf",
  "image/png": "png",
  "image/jpeg": "jpg",
  "text/plain": "txt",
  "text/csv": "csv",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
};

/** A name safe as one path segment in a ZIP on any system, Arabic kept. */
export function safeSegment(name: string, fallback: string): string {
  const s = name
    .normalize("NFC")
    .replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[\s.]+|[\s.]+$/g, "")
    .slice(0, 80)
    .trim();
  return s || fallback;
}

/**
 * Where a file goes in the pack: files/<project>/<title> (v<version>).<ext>.
 * Two files that would land on the same path get a number, so none is lost.
 */
export function packPath(
  used: Set<string>,
  file: { project: string; title: string; version: number; contentType: string },
): string {
  const ext = EXT[file.contentType] ?? "bin";
  const project = safeSegment(file.project, "project");
  let base = safeSegment(file.title.replace(new RegExp(`\\.${ext}$`, "i"), ""), "file");
  if (file.version > 1) base = `${base} (v${file.version})`;
  let path = `files/${project}/${base}.${ext}`;
  for (let n = 2; used.has(path.toLowerCase()); n++) path = `files/${project}/${base} ${n}.${ext}`;
  used.add(path.toLowerCase());
  return path;
}
