import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { inquiryBodySchema } from "@/lib/inquiry-schema";
import { publicRoute } from "@/server/http";
import { submitInquiry } from "@/services/intake";

// The public inquiry form. No session. The database validates again and
// limits each address to 5 an hour (submit_inquiry, baseline: Intake).
export const POST = publicRoute({ body: inquiryBodySchema, maxBytes: 16 * 1024 }, async ({ tx, body, ip, userAgent }) => {
  const { website, ...input } = body;
  // Bots get the same answer as people, and nothing is stored.
  if (website) return NextResponse.json({ ref: `INQ-${randomBytes(4).toString("hex").toUpperCase()}` }, { status: 201 });
  const { ref } = await submitInquiry(tx, input, ip, userAgent);
  return NextResponse.json({ ref }, { status: 201 });
});
