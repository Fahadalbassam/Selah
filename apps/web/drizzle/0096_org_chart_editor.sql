ALTER TABLE "invitations" ADD COLUMN "position_lineage_id" uuid;--> statement-breakpoint
-- ------------------------------------------ org chart, part 3: the editor and the people
-- Approved 17 Nov 2026 (gate A follow-ups, section 3, new feature B), part 3
-- of 5: the outline editor, holders and vacancies, the leaving and invite
-- hooks. Decided by the lead on 18 Nov (data protection): a holding entered
-- by mistake can be removed, so a client's structure can stop naming people
-- (and the client can then switch to minimal records). Everything else in
-- 0091_org_chart is unchanged.

-- 1. The invitation's position. The foreign key is written here rather than
--    in the schema files (src/db/schema/app.ts would import org-chart.ts,
--    which imports it). A position the firm later drops leaves the
--    invitation without one.
ALTER TABLE invitations ADD CONSTRAINT invitations_position_lineage_fk
  FOREIGN KEY (position_lineage_id) REFERENCES positions(id) ON DELETE SET NULL;
--> statement-breakpoint
-- An invitation names a position of the company's current published
-- structure (its lineage), never at a client that keeps minimal records, and
-- only when the person inviting may change who holds positions there (the
-- client's admin, the firm's editors: app_org_chart_holder_writer). Whether
-- it is still vacant is checked again when the invitation is accepted.
CREATE FUNCTION check_invitation_position() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.position_lineage_id IS NULL OR (TG_OP = 'UPDATE' AND NEW.position_lineage_id IS NOT DISTINCT FROM OLD.position_lineage_id) THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM positions p JOIN org_chart_versions v ON v.id = p.version_id JOIN organizations o ON o.id = v.org_id
    WHERE p.lineage_id = NEW.position_lineage_id AND v.org_id = NEW.org_id AND v.state = 'published' AND NOT o.minimal_records)
  THEN
    RAISE EXCEPTION 'an invitation fills a position of the company''s current structure' USING ERRCODE = 'check_violation';
  END IF;
  IF app_uid() IS NOT NULL AND NOT app_org_chart_holder_writer(NEW.org_id) THEN
    RAISE EXCEPTION 'no such position' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER invitation_position BEFORE INSERT OR UPDATE OF position_lineage_id ON invitations
  FOR EACH ROW EXECUTE FUNCTION check_invitation_position();
--> statement-breakpoint
-- 2. Telling the client's lead and deputy that who holds a position changed:
--    one unread notice per client at a time, and at most one mail a firm day
--    to each for each client, neither carrying a name. The body of
--    notify_position_holder() (0091), unchanged, moved here so the
--    invitation and the removal below can call it too. Internal.
CREATE FUNCTION app_org_chart_tell_lead(org uuid, actor uuid) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH told AS (
    INSERT INTO notifications (user_id, kind, entity_type, entity_id)
      SELECT ca.user_id, 'org_chart.holder_changed', 'organization', org
      FROM client_assignments ca JOIN org_memberships m ON m.user_id = ca.user_id AND m.active
      WHERE ca.client_org_id = org AND (ca.is_lead OR ca.is_deputy) AND ca.user_id IS DISTINCT FROM actor
        AND NOT EXISTS (
          SELECT 1 FROM notifications x
          WHERE x.user_id = ca.user_id AND x.kind = 'org_chart.holder_changed' AND x.entity_id = org AND x.read_at IS NULL)
    RETURNING user_id
  )
  INSERT INTO outbound_emails (to_email, kind, link)
    SELECT u.email, 'org_chart.holder_changed', '/clients/' || org FROM told t JOIN "user" u ON u.id = t.user_id
    WHERE app_can_reset_password(t.user_id)
      AND NOT EXISTS (
        SELECT 1 FROM outbound_emails o
        WHERE o.kind = 'org_chart.holder_changed' AND o.link = '/clients/' || org AND lower(o.to_email) = lower(u.email)
          AND app_firm_date(o.created_at) = app_firm_today())
$$;
--> statement-breakpoint
-- Latest definition: 0091_org_chart. The same rule, through the helper.
CREATE OR REPLACE FUNCTION notify_position_holder() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF app_uid() IS NULL OR (TG_OP = 'UPDATE' AND NEW.to_date IS NOT DISTINCT FROM OLD.to_date) THEN
    RETURN NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM positions p JOIN org_chart_versions v ON v.id = p.version_id
    WHERE p.lineage_id = NEW.position_lineage_id AND v.chart_id = NEW.chart_id AND v.state = 'published') THEN
    RETURN NULL;
  END IF;
  PERFORM app_org_chart_tell_lead(NEW.org_id, app_uid());
  RETURN NULL;
END $$;
--> statement-breakpoint
-- 3. Accepting an invitation that names a position starts the holding, from
--    the day it is accepted, when the position is still on the company's
--    current structure and still has room (fewer people hold it today than
--    it is planned for). The chart's publish lock is taken before that check
--    (S5 of the part 3 review), so a publish under way finishes first and a
--    position it drops is never filled. Otherwise the person simply joins,
--    and the person who invited is told, in plain words, that nobody was
--    placed (org_chart.invite_not_placed, a notice without a name), so they
--    can place them. The lead and deputy are told of a holding, as for any
--    change on the published structure. Latest definition: 0000_baseline;
--    unchanged before the position.
CREATE OR REPLACE FUNCTION app_accept_invitation(token_hash text, new_user uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  inv invitations%ROWTYPE;
  pos record;
  hid uuid;
  lchart uuid;
BEGIN
  SELECT * INTO inv FROM invitations i WHERE i.token_hash = app_accept_invitation.token_hash FOR UPDATE;
  IF NOT FOUND OR inv.accepted_at IS NOT NULL OR inv.revoked_at IS NOT NULL OR inv.expires_at <= now() THEN
    RAISE EXCEPTION 'this invitation is no longer valid' USING ERRCODE = 'SL400';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "user" u WHERE u.id = new_user AND lower(u.email) = inv.email) THEN
    RAISE EXCEPTION 'the account does not match the invitation' USING ERRCODE = 'SL400';
  END IF;
  -- The chart's lock before anything else (R1 of the part 3 re-check): a publish takes it first and
  -- then the client's row, which the membership below locks, so taking it later could deadlock.
  IF inv.position_lineage_id IS NOT NULL THEN
    SELECT v.chart_id INTO lchart FROM positions p JOIN org_chart_versions v ON v.id = p.version_id WHERE p.id = inv.position_lineage_id;
    IF lchart IS NOT NULL THEN
      PERFORM pg_advisory_xact_lock_shared(hashtext('org_chart'), hashtext(lchart::text));
    END IF;
  END IF;
  INSERT INTO org_memberships (user_id, org_id, role) VALUES (new_user, inv.org_id, inv.role);
  UPDATE invitations SET accepted_at = now(), accepted_user_id = new_user WHERE id = inv.id;
  INSERT INTO audit_log (actor_id, org_id, action, resource_type, resource_id, outcome, meta)
    VALUES (new_user, inv.org_id, 'invitation.accept', 'invitation', inv.id, 'allow', jsonb_build_object('invited_by', inv.invited_by));
  IF inv.position_lineage_id IS NOT NULL THEN
    -- Under the chart's lock: a publish under way has finished, so the check sees what it published.
    SELECT p.id, p.planned_count, v.chart_id INTO pos
    FROM positions p JOIN org_chart_versions v ON v.id = p.version_id JOIN organizations o ON o.id = v.org_id
    WHERE p.lineage_id = inv.position_lineage_id AND v.org_id = inv.org_id AND v.state = 'published'
      AND NOT o.minimal_records AND o.status <> 'archived';
    IF pos.id IS NOT NULL AND (
      SELECT count(*) FROM position_holders h
      WHERE h.position_lineage_id = inv.position_lineage_id AND h.from_date <= app_firm_today()
        AND (h.to_date IS NULL OR h.to_date >= app_firm_today())) < pos.planned_count THEN
      INSERT INTO position_holders (chart_id, org_id, position_lineage_id, user_id, from_date, created_by)
        VALUES (pos.chart_id, inv.org_id, inv.position_lineage_id, new_user, app_firm_today(), coalesce(inv.invited_by, new_user))
        RETURNING id INTO hid;
      INSERT INTO audit_log (actor_id, org_id, action, resource_type, resource_id, outcome, meta)
        VALUES (new_user, inv.org_id, 'org_chart.holder_start', 'org_chart', pos.id, 'allow',
          jsonb_build_object('client', inv.org_id, 'holder', hid, 'from', app_firm_today(), 'typed', false, 'invitation', inv.id));
      PERFORM app_org_chart_tell_lead(inv.org_id, new_user);
    ELSIF inv.invited_by IS NOT NULL THEN
      -- Filled meanwhile, or no longer on the structure: the person joined; whoever invited them places them.
      INSERT INTO notifications (user_id, kind, entity_type, entity_id)
        SELECT inv.invited_by, 'org_chart.invite_not_placed', 'organization', inv.org_id
        WHERE EXISTS (SELECT 1 FROM org_memberships m WHERE m.user_id = inv.invited_by AND m.active);
    END IF;
  END IF;
  RETURN inv.org_id;
END $$;
--> statement-breakpoint
-- 4. When someone leaves (their account at the company is switched off, the
--    existing leaving flow; the lead's decision B2 in the part 3 review):
--    - every holding of theirs that has started ends on the leaving day,
--      also one with a later end date (the end becomes the leaving day): the
--      position stays and shows as vacant from the next day, unless the
--      person switching them off names a replacement (the service starts
--      that holding). History is kept; each ending is audited.
--    - a holding that has not started yet never took effect: it is
--      cancelled (the row removed), audited as a count without names.
--    An archived client's structure is frozen and left as it is.
--    check_position_holder() lets an end date move earlier only here: while
--    this trigger runs for that person (selah.leaving), from inside a trigger.
CREATE FUNCTION end_holdings_on_leaving() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  h record;
  n integer;
BEGIN
  IF EXISTS (SELECT 1 FROM organizations o WHERE o.id = NEW.org_id AND o.status = 'archived') THEN
    RETURN NULL;
  END IF;
  PERFORM set_config('selah.leaving', NEW.user_id::text, true);
  FOR h IN
    UPDATE position_holders x SET to_date = app_firm_today()
    WHERE x.user_id = NEW.user_id AND x.org_id = NEW.org_id AND x.from_date <= app_firm_today()
      AND (x.to_date IS NULL OR x.to_date > app_firm_today())
    RETURNING x.id, x.org_id, x.position_lineage_id, x.to_date
  LOOP
    INSERT INTO audit_log (actor_id, org_id, action, resource_type, resource_id, outcome, meta)
      VALUES (app_uid(), coalesce(app_org(), NEW.org_id), 'org_chart.holder_end', 'org_chart', h.position_lineage_id, 'allow',
        jsonb_build_object('client', h.org_id, 'holder', h.id, 'on', h.to_date, 'leaving', true));
  END LOOP;
  PERFORM set_config('selah.leaving', '', true);
  WITH gone AS (
    DELETE FROM position_holders x
    WHERE x.user_id = NEW.user_id AND x.org_id = NEW.org_id AND x.from_date > app_firm_today()
    RETURNING 1
  ) SELECT count(*) INTO n FROM gone;
  IF n > 0 THEN
    INSERT INTO audit_log (actor_id, org_id, action, resource_type, resource_id, outcome, meta)
      VALUES (app_uid(), coalesce(app_org(), NEW.org_id), 'org_chart.holder_cancel', 'org_chart', NEW.org_id, 'allow',
        jsonb_build_object('client', NEW.org_id, 'count', n, 'leaving', true));
    PERFORM app_org_chart_tell_lead(NEW.org_id, app_uid());
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE TRIGGER membership_positions AFTER UPDATE OF active ON org_memberships
  FOR EACH ROW WHEN (OLD.active AND NOT NEW.active) EXECUTE FUNCTION end_holdings_on_leaving();
--> statement-breakpoint
-- 5. Removing a holding entered by mistake (a typo, the wrong person), for
--    the people who may change holders: the firm's editors, and the client's
--    admin on positions of the published structure (the same as placing
--    someone). Unlike ending a holding, the row is deleted, so the name is
--    gone from the structure, its history, the masking list and the
--    minimal-records check. The audit log records that a holding was removed
--    from this position, by whom and when, never the name. The app deletes
--    holdings only through this function. Returns the client.
CREATE FUNCTION app_remove_position_holder(p_position uuid, p_holder uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  h position_holders;
  on_published boolean;
BEGIN
  SELECT x.* INTO h FROM position_holders x JOIN positions p ON p.lineage_id = x.position_lineage_id
  WHERE x.id = p_holder AND p.id = p_position;
  IF h.id IS NULL THEN
    RAISE EXCEPTION 'no such holding' USING ERRCODE = 'insufficient_privilege';
  END IF;
  on_published := app_org_chart_lineage_published(h.position_lineage_id);
  IF NOT (app_org_chart_editor(h.org_id)
          OR (on_published AND coalesce(app_org_kind() = 'client' AND app_role() = 'client_admin' AND app_org() = h.org_id, false))) THEN
    RAISE EXCEPTION 'no such holding' USING ERRCODE = 'insufficient_privilege';
  END IF;
  PERFORM pg_advisory_xact_lock_shared(hashtext('org_chart'), hashtext(h.chart_id::text));
  DELETE FROM position_holders WHERE id = h.id;
  INSERT INTO audit_log (actor_id, org_id, action, resource_type, resource_id, outcome, meta)
    VALUES (app_uid(), app_org(), 'org_chart.holder_remove', 'org_chart', p_position, 'allow',
      jsonb_build_object('client', h.org_id, 'holder', h.id));
  IF on_published THEN
    PERFORM app_org_chart_tell_lead(h.org_id, app_uid());
  END IF;
  RETURN h.org_id;
END $$;
--> statement-breakpoint
-- 6. Start the draft again from the current published version (the firm's
--    editors): its units and positions are replaced by a copy of what is
--    published, as publishing leaves it. The caller names the draft they
--    looked at, as for publishing. A position only the draft had goes, and
--    with it any holding placed in it (as when the firm removes it).
CREATE FUNCTION app_reset_org_chart_draft(cid uuid, p_draft uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  c org_charts;
  d org_chart_versions;
  cur uuid;
BEGIN
  SELECT * INTO c FROM org_charts WHERE id = cid;
  IF c.id IS NULL OR NOT app_org_chart_editor(c.org_id) THEN
    RAISE EXCEPTION 'no such structure' USING ERRCODE = 'insufficient_privilege';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('org_chart'), hashtext(cid::text));
  SELECT * INTO d FROM org_chart_versions v WHERE v.chart_id = cid AND v.state = 'draft' FOR UPDATE;
  IF d.id IS DISTINCT FROM p_draft THEN
    RAISE EXCEPTION 'this draft is no longer the current one; reload the page' USING ERRCODE = 'check_violation';
  END IF;
  SELECT v.id INTO cur FROM org_chart_versions v WHERE v.chart_id = cid AND v.state = 'published';
  IF cur IS NULL THEN
    RAISE EXCEPTION 'nothing is published yet to start again from' USING ERRCODE = 'check_violation';
  END IF;
  -- Lines and the tree first, so the rows can go in one statement each.
  UPDATE positions SET reports_to_id = NULL WHERE version_id = d.id AND reports_to_id IS NOT NULL;
  DELETE FROM positions WHERE version_id = d.id;
  UPDATE org_units SET parent_id = NULL WHERE version_id = d.id AND parent_id IS NOT NULL;
  DELETE FROM org_units WHERE version_id = d.id;
  PERFORM app_org_chart_copy(cur, d.id);
END $$;
--> statement-breakpoint
-- 7. People are placed only on the live structure (the lead's decision B1,
--    review of part 3): a new holding is of a position of the current
--    published version, for everyone, the firm's editors included and
--    whoever is not signed in (an invitation accepted). The firm's draft
--    therefore never holds anyone, and a draft can never show the company a
--    planned successor. Latest definition: 0091_org_chart; unchanged apart
--    from the draft no longer being allowed and the check no longer skipped
--    for jobs.
CREATE OR REPLACE FUNCTION check_position_holder() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  lchart uuid;
  lorg uuid;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF (to_jsonb(NEW) - '{to_date,ended_by,ended_at}'::text[]) <> (to_jsonb(OLD) - '{to_date,ended_by,ended_at}'::text[]) THEN
      RAISE EXCEPTION 'a holding only ends; to change who holds the position, end this holding and add the next'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.to_date IS NOT DISTINCT FROM OLD.to_date THEN
      RETURN NEW;
    END IF;
    -- Only the leaving (end_holdings_on_leaving(), a trigger) moves an end date earlier, for the person leaving.
    IF (OLD.to_date IS NOT NULL OR NEW.to_date IS NULL)
       AND NOT (OLD.to_date IS NOT NULL AND NEW.to_date IS NOT NULL AND NEW.to_date < OLD.to_date
                AND pg_trigger_depth() > 1 AND current_setting('selah.leaving', true) = OLD.user_id::text) THEN
      RAISE EXCEPTION 'this holding has already ended' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.to_date < OLD.from_date THEN
      RAISE EXCEPTION 'a holding ends on or after the day it started' USING ERRCODE = 'check_violation';
    END IF;
    NEW.ended_by := coalesce(app_uid(), NEW.ended_by);
    NEW.ended_at := now();
    RETURN NEW;
  END IF;

  SELECT v.chart_id, v.org_id INTO lchart, lorg
  FROM positions p JOIN org_chart_versions v ON v.id = p.version_id
  WHERE p.id = NEW.position_lineage_id AND p.lineage_id = p.id;
  IF lchart IS NULL THEN
    RAISE EXCEPTION 'no such position' USING ERRCODE = 'check_violation';
  END IF;
  NEW.chart_id := lchart;
  NEW.org_id := lorg;
  IF coalesce((SELECT o.minimal_records FROM organizations o WHERE o.id = lorg), false) THEN
    RAISE EXCEPTION 'this client keeps minimal records: its structure has titles only, no names' USING ERRCODE = 'check_violation';
  END IF;
  NEW.name := nullif(btrim(NEW.name), '');
  IF NEW.user_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM org_memberships m WHERE m.user_id = NEW.user_id AND m.org_id = lorg AND m.active) THEN
    RAISE EXCEPTION 'a holder is one of the client''s own active people, or a typed name' USING ERRCODE = 'check_violation';
  END IF;
  -- The chart's publish lock, shared: a holding added while a publish of the chart is under way
  -- waits for it, then is checked against what was published (a position it dropped is refused).
  PERFORM pg_advisory_xact_lock_shared(hashtext('org_chart'), hashtext(lchart::text));
  IF NOT EXISTS (
    SELECT 1 FROM positions p JOIN org_chart_versions v ON v.id = p.version_id
    WHERE p.lineage_id = NEW.position_lineage_id AND v.chart_id = lchart AND v.state = 'published') THEN
    RAISE EXCEPTION 'people are placed in positions of the published structure (its current version), never in the draft' USING ERRCODE = 'check_violation';
  END IF;
  IF app_uid() IS NOT NULL THEN
    NEW.created_by := app_uid();
  END IF;
  NEW.created_at := now();
  IF NEW.to_date IS NULL THEN
    NEW.ended_by := NULL;
    NEW.ended_at := NULL;
  ELSE
    NEW.ended_by := NEW.created_by;
    NEW.ended_at := now();
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('position_holder'), hashtext(NEW.position_lineage_id::text));
  IF EXISTS (
    SELECT 1 FROM position_holders h
    WHERE h.position_lineage_id = NEW.position_lineage_id
      AND (h.user_id = NEW.user_id OR lower(h.name) = lower(NEW.name))
      AND daterange(h.from_date, h.to_date, '[]') && daterange(NEW.from_date, NEW.to_date, '[]')) THEN
    RAISE EXCEPTION 'this person already holds the position on some of those days' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
-- 8. A position only the draft has never holds anyone (S2 of the part 3
--    review; it follows from 7). The second lock: removing such a position
--    (or starting the draft again, which removes them) would delete its
--    holdings through the foreign key without a trace, so it is refused if
--    one ever exists. Jobs and a discarded client pass.
CREATE FUNCTION check_position_holdings() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF app_uid() IS NULL OR current_setting('selah.discard', true) IS NOT DISTINCT FROM 'on' THEN
    RETURN OLD;
  END IF;
  -- Only the draft's own positions: a published one is refused by check_position() anyway.
  IF OLD.id = OLD.lineage_id
     AND EXISTS (SELECT 1 FROM org_chart_versions v WHERE v.id = OLD.version_id AND v.state = 'draft')
     AND EXISTS (SELECT 1 FROM position_holders h WHERE h.position_lineage_id = OLD.id) THEN
    RAISE EXCEPTION 'a position only the draft has holds someone; nobody is placed in the draft' USING ERRCODE = 'check_violation';
  END IF;
  RETURN OLD;
END $$;
--> statement-breakpoint
CREATE TRIGGER position_holdings BEFORE DELETE ON positions FOR EACH ROW EXECUTE FUNCTION check_position_holdings();
--> statement-breakpoint
REVOKE ALL ON FUNCTION check_invitation_position(), app_org_chart_tell_lead(uuid, uuid), end_holdings_on_leaving(), check_position_holdings(),
  app_remove_position_holder(uuid, uuid), app_reset_org_chart_draft(uuid, uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_remove_position_holder(uuid, uuid), app_reset_org_chart_draft(uuid, uuid) TO selah_app;
