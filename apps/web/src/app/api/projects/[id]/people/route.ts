import { z } from "zod";
import { route } from "@/server/http";
import { addProjectPerson, getProjectPeople } from "@/services/staffing";

const params = z.object({ id: z.uuid() });

export const GET = route({ params }, ({ tx, principal, params }) => getProjectPeople(tx, principal, params.id));

/** The firm admin, the client's admin or its lead consultant: put one of the client's people on the project. */
export const POST = route({ params, body: z.object({ userId: z.uuid() }).strict() }, ({ tx, principal, params, body }) =>
  addProjectPerson(tx, principal, params.id, body.userId),
);
