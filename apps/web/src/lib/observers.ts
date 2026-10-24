import { FROZEN_TABLES } from "./closure";

// Read-only observers on a project (migration 0034, wave 1 N6). The
// database holds the same lists; tests/db/observers.test.ts checks them.

/** What an observer still writes: notes on actions (their comments), and leaving the team. */
export const OBSERVER_WRITABLE_TABLES = ["action_notes", "project_members"] as const;

/** The tables an observer only reads (the project_observer trigger, check_not_observer()). */
export const OBSERVER_READ_ONLY_TABLES = FROZEN_TABLES.filter(
  (t) => !(OBSERVER_WRITABLE_TABLES as readonly string[]).includes(t),
);
