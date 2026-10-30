import { z } from "zod";
import { route } from "@/server/http";
import { disconnectFeed } from "@/services/indicator-data";

// Disconnect a sheet or a key at once.
export const DELETE = route({ params: z.object({ id: z.uuid() }) }, ({ tx, principal, params }) => disconnectFeed(tx, principal, params.id));
