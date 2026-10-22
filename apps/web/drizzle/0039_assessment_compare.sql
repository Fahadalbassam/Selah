-- Retake and compare (docs/assessments.md, "Retake and compare").
--
-- Two assessments of the same client on the same template, question by
-- question. A template can change between versions, so questions are matched
-- by their reference ("2.1"), or by their wording when they have none. A
-- question only in the later one is new; only in the earlier one, dropped.
-- A reference names one question in a version. Questions without one that
-- share their wording are matched in order. A question whose wording
-- changed under the same reference is flagged, so the answers aren't read
-- as like for like. With the caller's rights: both assessments must be
-- visible to them.

CREATE UNIQUE INDEX template_questions_ref_once ON template_questions (version_id, trim(ref))
  WHERE ref IS NOT NULL AND trim(ref) <> '';
--> statement-breakpoint

CREATE FUNCTION app_assessment_compare(earlier uuid, later uuid)
RETURNS TABLE (match_key text, ref text, section_position integer, section_title text, section_title_ar text,
               question_position integer, prompt text, prompt_ar text, type assessment_question_type,
               before_value text, after_value text, before_points integer, after_points integer,
               before_max integer, after_max integer, before_gap boolean, after_gap boolean,
               in_earlier boolean, in_later boolean, wording_changed boolean)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE a assessments%ROWTYPE; b assessments%ROWTYPE;
BEGIN
  SELECT * INTO a FROM assessments WHERE id = earlier;
  SELECT * INTO b FROM assessments WHERE id = later;
  IF a.id IS NULL OR b.id IS NULL THEN
    RAISE EXCEPTION 'assessment not found' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF a.id = b.id THEN
    RAISE EXCEPTION 'choose two different assessments' USING ERRCODE = 'check_violation';
  END IF;
  IF a.org_id <> b.org_id THEN
    RAISE EXCEPTION 'only assessments of the same client can be compared' USING ERRCODE = 'check_violation';
  END IF;
  IF (SELECT template_id FROM template_versions WHERE id = a.template_version_id)
     <> (SELECT template_id FROM template_versions WHERE id = b.template_version_id) THEN
    RAISE EXCEPTION 'only assessments on the same template can be compared' USING ERRCODE = 'check_violation';
  END IF;

  RETURN QUERY
  WITH x AS (
    SELECT keyed.k || '#' || row_number() OVER (PARTITION BY keyed.k ORDER BY keyed.sp, keyed.qp) AS k, keyed.ref, keyed.sp,
           keyed.title, keyed.title_ar, keyed.qp, keyed.prompt, keyed.prompt_ar, keyed.type, keyed.value, keyed.points,
           keyed.max_points, keyed.is_gap
    FROM (SELECT coalesce(nullif(trim(q.ref), ''), lower(trim(q.prompt))) AS k, q.ref, s.position AS sp, s.title, s.title_ar,
                 q.position AS qp, q.prompt, q.prompt_ar, q.type, r.value, r.points, r.max_points, r.is_gap
          FROM app_assessment_results(earlier) r
          JOIN template_questions q ON q.id = r.question_id
          JOIN template_sections s ON s.id = r.section_id) keyed
  ),
  y AS (
    SELECT keyed.k || '#' || row_number() OVER (PARTITION BY keyed.k ORDER BY keyed.sp, keyed.qp) AS k, keyed.ref, keyed.sp,
           keyed.title, keyed.title_ar, keyed.qp, keyed.prompt, keyed.prompt_ar, keyed.type, keyed.value, keyed.points,
           keyed.max_points, keyed.is_gap
    FROM (SELECT coalesce(nullif(trim(q.ref), ''), lower(trim(q.prompt))) AS k, q.ref, s.position AS sp, s.title, s.title_ar,
                 q.position AS qp, q.prompt, q.prompt_ar, q.type, r.value, r.points, r.max_points, r.is_gap
          FROM app_assessment_results(later) r
          JOIN template_questions q ON q.id = r.question_id
          JOIN template_sections s ON s.id = r.section_id) keyed
  )
  -- Placed and worded as in the later assessment, where it is there.
  SELECT coalesce(y.k, x.k), coalesce(y.ref, x.ref), coalesce(y.sp, x.sp), coalesce(y.title, x.title),
         coalesce(y.title_ar, x.title_ar), coalesce(y.qp, x.qp), coalesce(y.prompt, x.prompt), coalesce(y.prompt_ar, x.prompt_ar),
         coalesce(y.type, x.type), x.value, y.value, x.points, y.points, x.max_points, y.max_points,
         coalesce(x.is_gap, false), coalesce(y.is_gap, false), x.k IS NOT NULL, y.k IS NOT NULL,
         x.k IS NOT NULL AND y.k IS NOT NULL AND lower(trim(x.prompt)) <> lower(trim(y.prompt))
  FROM x FULL JOIN y ON y.k = x.k
  ORDER BY 3, 6;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_assessment_compare(uuid, uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_assessment_compare(uuid, uuid) TO selah_app;
