import { z } from "zod";

// No-login upload links for one information request item (wave 2, F14,
// decision D6). The database holds the same limits (check_info_request_link,
// app_upload_by_link).

/** Days a link works: the consultant picks, 7 unless they change it. */
export const UPLOAD_LINK_DAYS = { min: 1, max: 30, default: 7 } as const;
export const UPLOAD_LINK_DAY_CHOICES = [1, 3, 7, 14, 30] as const;

/** Files one link takes at most. */
export const UPLOAD_LINK_MAX_FILES = 10;

/** The token in /upload/<token>: 32 random bytes, base64url. */
export const isUploadLinkToken = (token: string) => /^[A-Za-z0-9_-]{43}$/.test(token);

export const uploadLinkInput = z
  .object({
    email: z.email().max(254),
    days: z.coerce.number().int().min(UPLOAD_LINK_DAYS.min).max(UPLOAD_LINK_DAYS.max).default(UPLOAD_LINK_DAYS.default),
  })
  .strict();
export type UploadLinkInput = z.infer<typeof uploadLinkInput>;
