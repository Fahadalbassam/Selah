-- Design re-review R5 and R6.
--
-- R5: a file reaches the AI index only if a review accepted THAT file, not
--     merely because its action was verified later (files from a round that
--     got "revision requested" stay out).
-- R6: nobody reviews work they submitted: neither the action's owner nor
--     anyone who submitted evidence in the round under review.

CREATE OR REPLACE FUNCTION app_evidence_accepted(doc uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM evidence_submissions es
    JOIN reviews r ON r.action_id = es.action_id
    WHERE es.document_id = doc AND r.outcome = 'accept' AND es.id = ANY (r.evidence_submission_ids)
  )
$$;
--> statement-breakpoint
CREATE FUNCTION app_submitted_this_round(act uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM evidence_submissions es
    WHERE es.action_id = act AND es.submitted_by = app_uid()
      AND es.created_at > coalesce((SELECT max(r.created_at) FROM reviews r WHERE r.action_id = act), '-infinity')
  )
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_submitted_this_round(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_submitted_this_round(uuid) TO selah_app;
--> statement-breakpoint
DROP POLICY scoped_insert ON reviews;
--> statement-breakpoint
CREATE POLICY scoped_insert ON reviews FOR INSERT TO selah_app WITH CHECK (
  app_can_see_project(project_id) AND reviewer_id = app_uid()
  AND app_role() IN ('firm_admin', 'consultant')
  AND NOT EXISTS (SELECT 1 FROM actions a WHERE a.id = action_id AND a.owner_user_id = app_uid())
  AND NOT app_submitted_this_round(action_id)
);
