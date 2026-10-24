ALTER TYPE "public"."text_status" ADD VALUE 'needs_ocr';--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "ocr_pages" integer[] DEFAULT '{}'::integer[] NOT NULL;--> statement-breakpoint
-- The assistant reads PDF, Word, PowerPoint and Excel files (wave 1, item 4,
-- 2026-10-24). A scanned page has no text layer: the indexing job lists it in
-- ocr_pages, and a file with nothing but scanned pages is "needs_ocr" rather
-- than "not_searchable", so it can be picked up when text recognition comes.
-- Both are the job's to set, never a person's; a change that sends the file
-- back to the job clears them.
CREATE OR REPLACE FUNCTION check_text_status() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  -- Set by the indexing job (the schema owner), never by a person.
  IF session_user = 'selah_app' AND (TG_OP = 'INSERT' AND (NEW.text_status <> 'pending' OR cardinality(NEW.ocr_pages) > 0)
     OR TG_OP = 'UPDATE' AND (NEW.text_status <> OLD.text_status OR NEW.ocr_pages <> OLD.ocr_pages)) THEN
    RAISE EXCEPTION 'the text status is set by the indexing job' USING ERRCODE = 'insufficient_privilege';
  END IF;
  -- These changes drop the file's passages (drop_document_chunks,
  -- drop_department_chunks): the job indexes it again.
  IF TG_OP = 'UPDATE' AND (NEW.ai_indexable AND NOT OLD.ai_indexable OR NEW.visibility <> OLD.visibility
     OR NEW.department_id IS DISTINCT FROM OLD.department_id) THEN
    NEW.text_status := 'pending';
    NEW.ocr_pages := '{}';
  END IF;
  RETURN NEW;
END $$;
