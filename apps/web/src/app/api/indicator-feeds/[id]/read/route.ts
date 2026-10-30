import { z } from "zod";
import { route } from "@/server/http";
import { readSheetNow } from "@/services/indicator-data";

// Read a connected sheet now instead of waiting for the daily read.
export const POST = route({ params: z.object({ id: z.uuid() }) }, ({ tx, principal, params }) => readSheetNow(tx, principal, params.id));
