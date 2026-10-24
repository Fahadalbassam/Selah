import { enteredInquiryInput } from "@/lib/inquiry-entry";
import { route } from "@/server/http";
import { enterInquiry, listInquiries } from "@/services/inquiries";

// The firm's intake inbox, newest first. The public form posts to /api/inquiries.
export const GET = route({}, ({ tx, principal }) => listInquiries(tx, principal));

/** Firm staff enter a referral, a returning client, a tender or an approach of their own. */
export const POST = route({ body: enteredInquiryInput }, ({ tx, principal, body }) => enterInquiry(tx, principal, body));
