import { route } from "@/server/http";
import { listProfiles } from "@/services/expertise";

// What each consultant can lead. Firm staff only.
export const GET = route({}, ({ tx, principal }) => listProfiles(tx, principal));
