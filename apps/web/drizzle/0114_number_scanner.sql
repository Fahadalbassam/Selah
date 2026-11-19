-- Personal numbers in what the assistant reads (section 7 item 6). The
-- indexing job tags national IDs, Iqama numbers, IBANs, card numbers,
-- phones, e-mails, and passport and CR numbers next to their word
-- (lib/sensitive-numbers.ts) before a passage is stored in ai_chunks, and
-- counts them per file, by kind: {"ID": 2, "IBAN": 1}. Null until the job
-- has read the file; {} when it found none. The stored file never changes.
ALTER TABLE "documents" ADD COLUMN "number_counts" jsonb;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_number_counts_object"
  CHECK (number_counts IS NULL OR jsonb_typeof(number_counts) = 'object');--> statement-breakpoint
-- Set by the indexing job (the schema owner), never by a person, as text_status.
CREATE FUNCTION check_number_counts() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF session_user = 'selah_app' AND (TG_OP = 'INSERT' AND NEW.number_counts IS NOT NULL
     OR TG_OP = 'UPDATE' AND NEW.number_counts IS DISTINCT FROM OLD.number_counts) THEN
    RAISE EXCEPTION 'the number counts are set by the indexing job' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER documents_number_counts BEFORE INSERT OR UPDATE OF number_counts ON documents
  FOR EACH ROW EXECUTE FUNCTION check_number_counts();
--> statement-breakpoint
-- What is already indexed was stored with its numbers as written: files go
-- back to the job (their old passages stay until each is indexed again), and
-- the plan's record passages are dropped, so the job writes them again,
-- tagged. Nothing else is lost: both are built from the files and records.
UPDATE documents SET text_status = 'pending', ocr_pages = '{}'
WHERE ai_indexable AND state <> 'archived' AND text_status <> 'pending';--> statement-breakpoint
DELETE FROM ai_chunks WHERE source_type IN ('recommendation', 'action');
