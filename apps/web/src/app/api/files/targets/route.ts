import { route } from "@/server/http";
import { uploadTargets } from "@/services/files";

// The projects the signed-in person can add a file to, with the labels and departments they may choose.
export const GET = route({}, ({ tx, principal }) => uploadTargets(tx, principal));
