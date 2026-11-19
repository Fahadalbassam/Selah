// The first-visit hints (big prompt 6.1): the existing two-week welcome on the
// home, one short set for each role, never a tour that covers the screen.
// Each set says what this home is for (`welcome.home.<role>`) and the first
// few things to do (`welcome.steps.<role>`), each step a link. Plain module:
// the home page and tests/welcome.test.ts share it.

import type { Role } from "@/authz";

/** New people (two weeks from their first sign-in) see the welcome until they hide it. */
export const WELCOME_DAYS = 14;

/** Where each role's steps lead, in the order of `welcome.steps.<role>`. */
export const WELCOME_LINKS: Record<Role, readonly string[]> = {
  firm_admin: ["/clients", "/team", "/settings"],
  consultant: ["/actions", "/projects", "/actions?filter=awaiting-review"],
  client_admin: ["/projects", "/team", "/help"],
  client_manager: ["/actions", "/projects", "/help"],
  action_owner: ["/actions", "/actions", "/help"],
};

export interface WelcomeSet {
  /** `welcome.home.<role>`: what this home is for. */
  home: string;
  /** `welcome.steps.<role>`: the first things to do. */
  steps: string;
  links: readonly string[];
}

/** The reader's own set: chosen by their role only, so each role reads its own hints. */
export function welcomeFor(role: Role): WelcomeSet {
  return { home: `home.${role}`, steps: `steps.${role}`, links: WELCOME_LINKS[role] };
}
