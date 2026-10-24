import { NextResponse } from "next/server";
import { z } from "zod";
import { MAX_UPLOAD_BYTES } from "@/lib/upload-rules";
import { BadRequestError } from "@/server/errors";
import { publicRoute } from "@/server/http";
import { prepareLinkUpload, uploadByLink } from "@/services/upload-links";

// A file sent through a no-login upload link (F14). Public: the token is the
// only proof. Checked and virus-scanned like any upload before a connection
// is taken; the database files it against the link's one item. A link that
// stopped working answers 404, and one that took its ten files 429.
export const POST = publicRoute(
  {
    params: z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/) }),
    maxBytes: MAX_UPLOAD_BYTES,
    form: true,
    prepare: ({ params, files }) => {
      const file = files.get("file");
      if (!file || files.size !== 1) throw new BadRequestError("attach exactly one file");
      return prepareLinkUpload(params.token, file);
    },
  },
  async ({ tx, params, prepared }) => {
    const out = await uploadByLink(tx, params.token, prepared);
    if (out.ok) return out;
    return out.error === "too_many_files"
      ? NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { "cache-control": "no-store" } })
      : NextResponse.json({ error: "not_found" }, { status: 404, headers: { "cache-control": "no-store" } });
  },
);
