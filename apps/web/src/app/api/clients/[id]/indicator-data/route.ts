import { z } from "zod";
import { route } from "@/server/http";
import { chooseDataMode, dataSettings } from "@/services/indicator-data";

// How the client's indicator figures reach Selah: typed only, files, or a connection.
const params = z.object({ id: z.uuid() });

export const GET = route({ params }, ({ tx, principal, params }) => dataSettings(tx, principal, params.id));

export const PUT = route({ params, body: z.object({ mode: z.enum(["typed", "files", "connected"]) }) }, ({ tx, principal, params, body }) =>
  chooseDataMode(tx, principal, params.id, body.mode),
);
