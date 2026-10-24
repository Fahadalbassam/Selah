CREATE TABLE "conflict_searches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"inquiry_id" uuid,
	"org_id" uuid,
	"terms" jsonb NOT NULL,
	"matches" jsonb NOT NULL,
	"searched_by" uuid NOT NULL,
	"searched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conflict_search_subject" CHECK (("conflict_searches"."inquiry_id" IS NULL) <> ("conflict_searches"."org_id" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "inquiry_qualifications" (
	"inquiry_id" uuid PRIMARY KEY NOT NULL,
	"fit" integer NOT NULL,
	"need" integer NOT NULL,
	"authority" integer NOT NULL,
	"urgency" integer NOT NULL,
	"budget" integer NOT NULL,
	"note" text,
	"rated_by" uuid NOT NULL,
	"rated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inquiry_qualification_range" CHECK ("inquiry_qualifications"."fit" BETWEEN 1 AND 3 AND "inquiry_qualifications"."need" BETWEEN 1 AND 3 AND "inquiry_qualifications"."authority" BETWEEN 1 AND 3 AND "inquiry_qualifications"."urgency" BETWEEN 1 AND 3 AND "inquiry_qualifications"."budget" BETWEEN 1 AND 3)
);
--> statement-breakpoint
ALTER TABLE "conflict_searches" ADD CONSTRAINT "conflict_searches_inquiry_id_inquiries_id_fk" FOREIGN KEY ("inquiry_id") REFERENCES "public"."inquiries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conflict_searches" ADD CONSTRAINT "conflict_searches_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conflict_searches" ADD CONSTRAINT "conflict_searches_searched_by_user_id_fk" FOREIGN KEY ("searched_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inquiry_qualifications" ADD CONSTRAINT "inquiry_qualifications_inquiry_id_inquiries_id_fk" FOREIGN KEY ("inquiry_id") REFERENCES "public"."inquiries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inquiry_qualifications" ADD CONSTRAINT "inquiry_qualifications_rated_by_user_id_fk" FOREIGN KEY ("rated_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "conflict_searches_inquiry_idx" ON "conflict_searches" USING btree ("inquiry_id","searched_at");--> statement-breakpoint
CREATE INDEX "conflict_searches_org_idx" ON "conflict_searches" USING btree ("org_id","searched_at");--> statement-breakpoint
-- Hand-written (wave 1, item 8): the conflict search, its stored summary,
-- the qualification card and the NDA marker.
--
-- Names are compared as sets of words: lower case, Arabic diacritics and
-- tatweel removed, alef, taa marbuta and alef maqsura unified, a leading
-- "al" or "lil" dropped, and words that every company name shares (company,
-- holding, trading, group, Saudi ...) left out. No extension is needed.
CREATE FUNCTION app_name_words(t text) RETURNS text[]
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT coalesce(array_agg(DISTINCT w ORDER BY w), '{}')
  FROM (
    SELECT CASE WHEN w LIKE 'لل%' AND length(w) > 4 THEN substr(w, 3)
                WHEN w LIKE 'ال%' AND length(w) > 4 THEN substr(w, 3)
                ELSE w END AS w
    FROM regexp_split_to_table(
      translate(regexp_replace(lower(coalesce(t, '')), '[ً-ْـ]', '', 'g'), 'أإآةى', 'اااهي'),
      '[^0-9a-zء-ي]+') w
  ) x
  WHERE length(w) >= 3 AND w NOT IN (
    'شركه', 'مؤسسه', 'مجموعه', 'قابضه', 'تجاريه', 'تجاره', 'محدوده', 'مسؤوليه', 'مساهمه', 'ذات', 'سعوديه', 'عربيه', 'خدمات',
    'تطوير', 'وطنيه', 'عامه', 'دوليه', 'شركاه', 'واولاده', 'اولاده', 'company', 'companies', 'holding', 'holdings', 'group',
    'trading', 'trade', 'est', 'establishment', 'ltd', 'llc', 'limited', 'the', 'and', 'for', 'corporation', 'corp', 'inc',
    'international', 'saudi', 'arabia', 'arabian', 'services', 'development', 'national', 'general', 'sons', 'partners')
$$;
--> statement-breakpoint
-- A person's last name as written last, normalised the same way; null when
-- too short to mean anything.
CREATE FUNCTION app_family_name(t text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT CASE WHEN length(w) >= 4 THEN w END FROM (
    SELECT CASE WHEN w LIKE 'ال%' AND length(w) > 4 THEN substr(w, 3) ELSE w END AS w
    FROM (
      SELECT (regexp_split_to_array(btrim(regexp_replace(
        translate(regexp_replace(lower(coalesce(t, '')), '[ً-ْـ]', '', 'g'), 'أإآةى', 'اااهي'),
        '[^0-9a-zء-ي]+', ' ', 'g')), ' '))[cardinality(regexp_split_to_array(btrim(regexp_replace(
        translate(regexp_replace(lower(coalesce(t, '')), '[ً-ْـ]', '', 'g'), 'أإآةى', 'اااهي'),
        '[^0-9a-zء-ي]+', ' ', 'g')), ' '))] AS w
    ) a
  ) b
$$;
--> statement-breakpoint
-- Every client (current, past or a prospect) and every other inquiry that
-- might conflict: the same or a similar name, the same company mail domain,
-- or someone at a client with the person's name or family name. For the firm
-- admin only; anyone else gets nothing.
CREATE FUNCTION app_conflict_matches(names text[], person text, email text, skip_org uuid, skip_inquiry uuid)
RETURNS TABLE (kind text, id uuid, label text, status text, reasons text[], people text[])
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH q AS (
    SELECT DISTINCT app_name_words(n) AS words FROM unnest(names) n WHERE app_name_words(n) <> '{}'
  ), qp AS (
    SELECT app_name_words(person) AS words, app_family_name(person) AS family
  ), qd AS (
    SELECT CASE WHEN d = '' OR d IN ('gmail.com', 'googlemail.com', 'hotmail.com', 'outlook.com', 'outlook.sa', 'live.com', 'msn.com',
      'yahoo.com', 'icloud.com', 'me.com', 'aol.com', 'proton.me', 'protonmail.com', 'mail.com', 'gmx.com') THEN NULL ELSE d END AS dom
    FROM (SELECT lower(btrim(split_part(coalesce(email, ''), '@', 2))) AS d) x
  ), clients AS (
    SELECT o.* FROM organizations o WHERE o.kind = 'client' AND o.id IS DISTINCT FROM skip_org
  ), client_names AS (
    SELECT c.id, n FROM clients c
    LEFT JOIN client_profiles cp ON cp.org_id = c.id
    CROSS JOIN LATERAL unnest(ARRAY[c.name, c.name_ar, c.display_alias, cp.legal_name_ar, cp.legal_name_en, cp.trade_name] || c.short_names) n
    WHERE n IS NOT NULL
  ), people AS (
    SELECT ct.org_id AS id, ct.name AS who FROM client_contacts ct JOIN clients c ON c.id = ct.org_id
    UNION ALL
    SELECT ct.org_id, ct.name_alt FROM client_contacts ct JOIN clients c ON c.id = ct.org_id WHERE ct.name_alt IS NOT NULL
    UNION ALL
    SELECT m.org_id, u.name FROM org_memberships m JOIN "user" u ON u.id = m.user_id JOIN clients c ON c.id = m.org_id
  ), hits AS (
    SELECT 'client' AS kind, cn.id, CASE WHEN app_name_words(cn.n) = q.words THEN 'same_name' ELSE 'similar_name' END AS reason, NULL::text AS who
      FROM client_names cn, q WHERE app_name_words(cn.n) && q.words
    UNION ALL
    SELECT 'client', c.id, 'domain', NULL FROM clients c, qd WHERE qd.dom IS NOT NULL AND (
      qd.dom = ANY (coalesce(c.allowed_email_domains, '{}'))
      OR EXISTS (SELECT 1 FROM client_contacts ct WHERE ct.org_id = c.id AND lower(split_part(ct.email, '@', 2)) = qd.dom)
      OR EXISTS (SELECT 1 FROM org_memberships m JOIN "user" u ON u.id = m.user_id WHERE m.org_id = c.id AND lower(split_part(u.email, '@', 2)) = qd.dom))
    UNION ALL
    SELECT 'client', p.id,
      CASE WHEN cardinality(ARRAY(SELECT unnest(app_name_words(p.who)) INTERSECT SELECT unnest(qp.words))) >= 2 THEN 'person' ELSE 'family' END,
      p.who
      FROM people p, qp WHERE cardinality(qp.words) >= 2 AND (
        cardinality(ARRAY(SELECT unnest(app_name_words(p.who)) INTERSECT SELECT unnest(qp.words))) >= 2
        OR (qp.family IS NOT NULL AND app_family_name(p.who) = qp.family))
    UNION ALL
    SELECT 'inquiry', i.id, CASE WHEN app_name_words(n) = q.words THEN 'same_name' ELSE 'similar_name' END, NULL
      FROM inquiries i CROSS JOIN LATERAL unnest(ARRAY[i.org_name, i.org_name_ar]) n, q
      WHERE i.id IS DISTINCT FROM skip_inquiry AND i.anonymised_at IS NULL AND (skip_org IS NULL OR i.client_org_id IS DISTINCT FROM skip_org)
        AND n IS NOT NULL AND app_name_words(n) && q.words
    UNION ALL
    SELECT 'inquiry', i.id, 'domain', NULL FROM inquiries i, qd
      WHERE i.id IS DISTINCT FROM skip_inquiry AND i.anonymised_at IS NULL AND (skip_org IS NULL OR i.client_org_id IS DISTINCT FROM skip_org)
        AND qd.dom IS NOT NULL AND lower(split_part(i.contact_email, '@', 2)) = qd.dom
  )
  SELECT h.kind, h.id,
    CASE h.kind WHEN 'client' THEN (SELECT o.name || coalesce(' / ' || o.name_ar, '') FROM organizations o WHERE o.id = h.id)
      ELSE (SELECT coalesce(i.org_name, '') || coalesce(' / ' || i.org_name_ar, '') || ' (' || i.public_ref || ')' FROM inquiries i WHERE i.id = h.id) END,
    CASE h.kind WHEN 'client' THEN (
      SELECT CASE WHEN o.prospect THEN 'prospect'
        WHEN o.status = 'archived' OR NOT EXISTS (SELECT 1 FROM projects p WHERE p.org_id = o.id AND p.state <> 'closed') THEN 'past'
        ELSE 'current' END FROM organizations o WHERE o.id = h.id)
      ELSE (SELECT i.status::text FROM inquiries i WHERE i.id = h.id) END,
    array_agg(DISTINCT h.reason ORDER BY h.reason),
    coalesce(array_agg(DISTINCT h.who ORDER BY h.who) FILTER (WHERE h.who IS NOT NULL), '{}')
  FROM hits h
  WHERE app_org_kind() = 'firm' AND app_role() = 'firm_admin'
  GROUP BY h.kind, h.id
  ORDER BY h.kind, 3
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_conflict_matches(text[], text, text, uuid, uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_conflict_matches(text[], text, text, uuid, uuid) TO selah_app;
--> statement-breakpoint
-- Run the search for an inquiry or a client (a prospect being pitched) and
-- keep what it found. The firm admin only.
CREATE FUNCTION app_record_conflict_search(iid uuid, oid uuid) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  q inquiries%ROWTYPE;
  o organizations%ROWTYPE;
  names text[];
  person text;
  email text;
  sid uuid;
BEGIN
  IF app_org_kind() IS DISTINCT FROM 'firm' OR app_role() IS DISTINCT FROM 'firm_admin' OR (iid IS NULL) = (oid IS NULL) THEN
    RAISE EXCEPTION 'only the firm admin searches for conflicts' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF iid IS NOT NULL THEN
    SELECT * INTO q FROM inquiries WHERE id = iid AND firm_org_id = app_org();
    IF NOT FOUND OR q.anonymised_at IS NOT NULL THEN
      RAISE EXCEPTION 'that inquiry can''t be searched' USING ERRCODE = 'check_violation';
    END IF;
    names := ARRAY[q.org_name, q.org_name_ar];
    person := q.contact_name;
    email := q.contact_email;
  ELSE
    SELECT * INTO o FROM organizations WHERE id = oid AND kind = 'client';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'that client can''t be searched' USING ERRCODE = 'check_violation';
    END IF;
    SELECT ARRAY[o.name, o.name_ar, cp.legal_name_ar, cp.legal_name_en, cp.trade_name] || o.short_names INTO names
      FROM (SELECT 1) x LEFT JOIN client_profiles cp ON cp.org_id = oid;
  END IF;
  names := ARRAY(SELECT DISTINCT n FROM unnest(names) n WHERE n IS NOT NULL);
  INSERT INTO conflict_searches (inquiry_id, org_id, terms, matches, searched_by)
  VALUES (iid, oid,
    jsonb_build_object('names', to_jsonb(names), 'person', person, 'domain', nullif(lower(split_part(coalesce(email, ''), '@', 2)), '')),
    coalesce((SELECT jsonb_agg(jsonb_build_object('kind', m.kind, 'id', m.id, 'label', m.label, 'status', m.status, 'reasons', m.reasons, 'people', m.people))
      FROM app_conflict_matches(names, person, email, coalesce(oid, q.client_org_id), iid) m), '[]'::jsonb),
    app_uid())
  RETURNING id INTO sid;
  RETURN sid;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_record_conflict_search(uuid, uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_record_conflict_search(uuid, uuid) TO selah_app;
--> statement-breakpoint
GRANT SELECT ON conflict_searches TO selah_app;
--> statement-breakpoint
ALTER TABLE conflict_searches ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY firm_admin_read ON conflict_searches FOR SELECT TO selah_app USING (
  app_org_kind() = 'firm' AND app_role() = 'firm_admin'
  AND (inquiry_id IS NULL OR EXISTS (SELECT 1 FROM inquiries i WHERE i.id = inquiry_id AND i.firm_org_id = app_org())));
--> statement-breakpoint
CREATE TRIGGER append_only BEFORE UPDATE OR DELETE ON conflict_searches FOR EACH ROW EXECUTE FUNCTION forbid_change();
--> statement-breakpoint
-- An inquiry is cleared of conflicts only after a search was run for it.
-- (Jobs and the owner's scripts, with no user, are not people clearing it.)
CREATE FUNCTION check_conflict_cleared() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.conflict_status = 'clear' AND OLD.conflict_status IS DISTINCT FROM 'clear' AND app_uid() IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM conflict_searches s WHERE s.inquiry_id = NEW.id) THEN
    RAISE EXCEPTION 'run the conflict search before clearing the inquiry' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER conflict_cleared BEFORE UPDATE OF conflict_status ON inquiries FOR EACH ROW EXECUTE FUNCTION check_conflict_cleared();
--> statement-breakpoint
-- The qualification card: whoever works the inquiry rates it while it is open.
GRANT SELECT, INSERT, UPDATE ON inquiry_qualifications TO selah_app;
--> statement-breakpoint
ALTER TABLE inquiry_qualifications ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY qualification_read ON inquiry_qualifications FOR SELECT TO selah_app USING (app_can_see_inquiry(inquiry_id));
--> statement-breakpoint
CREATE POLICY qualification_insert ON inquiry_qualifications FOR INSERT TO selah_app
  WITH CHECK (app_can_see_inquiry(inquiry_id) AND rated_by = app_uid());
--> statement-breakpoint
CREATE POLICY qualification_update ON inquiry_qualifications FOR UPDATE TO selah_app
  USING (app_can_see_inquiry(inquiry_id)) WITH CHECK (app_can_see_inquiry(inquiry_id) AND rated_by = app_uid());
--> statement-breakpoint
CREATE FUNCTION check_inquiry_qualification() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF (SELECT status FROM inquiries WHERE id = NEW.inquiry_id) NOT IN ('new', 'triaged', 'discovery_scheduled', 'discovery_done', 'proposal_sent') THEN
    RAISE EXCEPTION 'an inquiry is rated while it is open' USING ERRCODE = 'check_violation';
  END IF;
  NEW.rated_at := now();
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER qualification_rules BEFORE INSERT OR UPDATE ON inquiry_qualifications FOR EACH ROW EXECUTE FUNCTION check_inquiry_qualification();
--> statement-breakpoint
-- The NDA marker: the owner or the firm admin records the day it was
-- signed, in the inquiry's history. A later entry corrects an earlier one.
CREATE FUNCTION app_mark_inquiry_nda(iid uuid, signed_on date) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT app_can_see_inquiry(iid) THEN
    RAISE EXCEPTION 'only the inquiry''s owner or the firm admin marks the NDA' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF signed_on IS NULL OR signed_on > app_firm_today() THEN
    RAISE EXCEPTION 'the NDA date is on or before today' USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (SELECT 1 FROM inquiries WHERE id = iid AND anonymised_at IS NOT NULL) THEN
    RAISE EXCEPTION 'that inquiry is closed and cleared' USING ERRCODE = 'check_violation';
  END IF;
  INSERT INTO inquiry_events (inquiry_id, actor_id, event, meta) VALUES (iid, app_uid(), 'nda_signed', jsonb_build_object('signed_on', signed_on));
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_mark_inquiry_nda(uuid, date) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_mark_inquiry_nda(uuid, date) TO selah_app;
