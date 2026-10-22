-- Scores are the firm's (docs/assessments.md, "Scoring"). Fahad, 2026-10-22:
-- clients see their answers and confirmed findings, never points.
--
--   1. app_assessment_scores refuses a client caller.
--   2. app_assessment_results, and app_assessment_compare through it, return
--      no points, maximums or suggested gaps to a client caller. Whether a
--      question applies is still returned, so the client can see what is
--      left to answer.
--   3. A multiple-choice question whose options all score 0 only describes
--      the client ("Is the company family-owned?"): it is not scored and is
--      never a gap, but must be answered and can be a condition.

CREATE OR REPLACE FUNCTION app_assessment_results(aid uuid)
RETURNS TABLE (answer_id uuid, question_id uuid, section_id uuid, section_position integer, question_position integer, ref text,
               type assessment_question_type, basis criterion_basis, value text, applicable boolean, points integer,
               max_points integer, is_gap boolean, finding_id uuid)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, pg_temp AS $$
  WITH base AS (
    SELECT x.id AS answer_id, q.id AS question_id, s.id AS section_id, s.position AS section_position, q.position AS question_position,
           q.ref, q.type, x.basis, x.value, q.weight, q.gap_max_points,
           (q.applies_if_question_id IS NULL OR coalesce(dep.value = ANY (q.applies_if_values), false)) AS cond_met,
           CASE q.type WHEN 'yes_no' THEN 2 WHEN 'rating' THEN 3
                WHEN 'multiple_choice' THEN (SELECT max((o ->> 'points')::integer) FROM jsonb_array_elements(q.options) o) END AS raw_max,
           CASE WHEN x.value IS NULL OR x.value = 'na' THEN NULL
                WHEN q.type = 'yes_no' THEN CASE x.value WHEN 'yes' THEN 2 WHEN 'partly' THEN 1 ELSE 0 END
                WHEN q.type = 'rating' THEN x.value::integer - 1
                WHEN q.type = 'multiple_choice' THEN
                  (SELECT (o ->> 'points')::integer FROM jsonb_array_elements(q.options) o WHERE o ->> 'value' = x.value) END AS raw
    FROM assessment_answers x
    JOIN template_questions q ON q.id = x.question_id
    JOIN template_sections s ON s.id = q.section_id
    LEFT JOIN assessment_answers dep ON dep.assessment_id = x.assessment_id AND dep.question_id = q.applies_if_question_id
    WHERE x.assessment_id = aid
  ),
  -- A condition on a question that does not apply itself is not met.
  app AS (
    SELECT b.*, b.cond_met AND NOT EXISTS (
      WITH RECURSIVE up(qid) AS (
        SELECT q.applies_if_question_id FROM template_questions q WHERE q.id = b.question_id
        UNION SELECT q.applies_if_question_id FROM template_questions q JOIN up ON q.id = up.qid
      )
      SELECT 1 FROM up JOIN base p ON p.question_id = up.qid WHERE NOT p.cond_met
    ) AS applicable
    FROM base b
  ),
  -- The schema owner (no caller) counts as the firm.
  who AS (SELECT app_org_kind() IS DISTINCT FROM 'client' AS firm)
  SELECT a.answer_id, a.question_id, a.section_id, a.section_position, a.question_position, a.ref, a.type, a.basis, a.value, a.applicable,
         CASE WHEN who.firm AND a.applicable AND a.raw_max > 0 THEN a.raw * a.weight END,
         CASE WHEN who.firm AND a.applicable AND a.raw_max > 0 AND a.raw IS NOT NULL THEN a.raw_max * a.weight END,
         who.firm AND a.raw_max > 0 AND coalesce(a.applicable AND a.raw <= coalesce(a.gap_max_points, a.raw_max / 2), false),
         f.id
  FROM app a CROSS JOIN who LEFT JOIN findings f ON f.assessment_answer_id = a.answer_id
  ORDER BY a.section_position, a.question_position
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_assessment_scores(aid uuid)
RETURNS TABLE (section_id uuid, section_position integer, title text, title_ar text, earned integer, possible integer,
               to_answer integer, gaps integer, confirmed integer)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public, pg_temp AS $$
BEGIN
  IF app_org_kind() = 'client' THEN
    RAISE EXCEPTION 'scores are shown to the firm only' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN QUERY
  SELECT s.id, s.position, s.title, s.title_ar,
         coalesce(sum(r.points), 0)::integer, coalesce(sum(r.max_points), 0)::integer,
         count(*) FILTER (WHERE r.applicable AND r.type <> 'text' AND r.value IS NULL)::integer,
         count(*) FILTER (WHERE r.is_gap)::integer,
         count(*) FILTER (WHERE r.is_gap AND r.finding_id IS NOT NULL)::integer
  FROM assessments a
  JOIN template_sections s ON s.version_id = a.template_version_id
  LEFT JOIN app_assessment_results(aid) r ON r.section_id = s.id
  WHERE a.id = aid
  GROUP BY s.id, s.position, s.title, s.title_ar
  ORDER BY s.position;
END $$;
