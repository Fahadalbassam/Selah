import { route } from "@/server/http";
import { listNotifications } from "@/services/notifications";

// The caller's newest notifications and their unread count.
export const GET = route({}, ({ tx, principal }) => listNotifications(tx, principal));
