import { z } from "zod";

// Who is who on the client's side of a project (wave 1, item 6). The
// database holds the rules (baseline: Client roles, 0010).

export const CLIENT_ROLES_ORDER = ["sponsor", "coordinator", "steering", "acceptor", "observer"] as const;
export type ClientRoleName = (typeof CLIENT_ROLES_ORDER)[number];

/** Held by one person per project; naming another replaces them. */
export const SINGLE_ROLES: readonly ClientRoleName[] = ["sponsor", "coordinator"];

/** With an account, these need a client admin or manager (they decide or accept). */
export const DECIDING_ROLES: readonly ClientRoleName[] = ["sponsor", "coordinator", "acceptor"];

/** A form's person choice: "user:<id>" or "contact:<id>". */
export const clientRoleInput = z.object({
  role: z.enum(CLIENT_ROLES_ORDER),
  person: z.string().regex(/^(user|contact):[0-9a-f-]{36}$/),
});

export type ClientRoleInput = z.infer<typeof clientRoleInput>;
