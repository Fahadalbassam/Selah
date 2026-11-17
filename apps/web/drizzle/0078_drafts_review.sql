-- Review of D6 (docs/review/work/drafts-hidden-review.md), one section per
-- finding.
--
-- 1. A deleted draft. Only drafts are deleted, so an action that no longer
--    exists was a draft the client never saw. The check through an action
--    answered "visible" for a missing one, so a deleted draft's activity
--    events (and any old notice about it) came back for the client admin.
--    Now a missing action is hidden from a client, like a draft, and the
--    function answers the same for both (no way to tell a draft's id from an
--    unknown one). A row that names no action (NULL) keeps its own rules.
CREATE OR REPLACE FUNCTION app_action_visible_to_client(aid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce(app_org_kind() = 'firm', false)
    OR aid IS NULL
    OR EXISTS (SELECT 1 FROM actions a WHERE a.id = aid AND a.status <> 'draft')
$$;
