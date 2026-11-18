-- Who sees an item (feature A, re-check S10): the audience checks the app's
-- policies call (app_audience_ok(kind, item), 0118) decide "an item the caller
-- can see" with copies of the rules for files and meetings. A way in added to
-- these policies, or a change to one, without the same change to its copy
-- would let someone left out back in. Each policy the copies follow says so;
-- tests/db/audience.test.ts fails when a copy and the rules differ.
COMMENT ON POLICY scoped ON documents IS
  'Copied in app_caller_sees_document() (0112) for the audience check: change both together (re-check S10).';
--> statement-breakpoint
COMMENT ON POLICY department ON documents IS
  'Copied in app_caller_sees_document() (0112) for the audience check: change both together (re-check S10).';
--> statement-breakpoint
COMMENT ON POLICY scoped_read ON meetings IS
  'Copied in app_caller_sees_meeting() (0118) for the audience check: change both together (re-check S10).';
--> statement-breakpoint
COMMENT ON POLICY department ON meetings IS
  'Copied in app_caller_sees_meeting() (0118) for the audience check: change both together (re-check S10).';
--> statement-breakpoint
COMMENT ON POLICY whole_project ON meetings IS
  'Copied in app_caller_sees_meeting() (0118) for the audience check: change both together (re-check S10).';
--> statement-breakpoint
COMMENT ON FUNCTION app_caller_sees_document(uuid) IS
  'A copy of the policies scoped and department on documents, for the audience check. A new way into documents goes here too (re-check S10).';
--> statement-breakpoint
COMMENT ON FUNCTION app_caller_sees_meeting(uuid) IS
  'A copy of the policies scoped_read, department and whole_project on meetings, for the audience check. A new way into meetings goes here too (re-check S10).';
