-- Subcontractor Job No. on call_log.
--
-- Customer-facing job identifier used on pay apps (e.g. "6359" for HDSP's
-- internal job tracking number for a job that's "10039" in Sales Command).
-- Not the same as display_job_number (Sales Command's proposal/job ID) or
-- job_number (legacy/archive field that may or may not be populated).
--
-- Edited per-job on the Call Log detail. Pay apps pull this value into the
-- DA Builders "Subcontractor Job No.:" slot on the template.

ALTER TABLE public.call_log
  ADD COLUMN IF NOT EXISTS subcontractor_job_no text;
