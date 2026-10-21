import { route } from "@/server/http";
import { listInquiries } from "@/services/inquiries";

// The firm's intake inbox, newest first. The public form posts to /api/inquiries.
export const GET = route({}, ({ tx, principal }) => listInquiries(tx, principal));
