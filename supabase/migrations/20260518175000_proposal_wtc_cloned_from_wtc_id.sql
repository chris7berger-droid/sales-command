-- Migration 1b — proposal_wtc.cloned_from_wtc_id lineage column
--
-- Closes F16 (sync-identity gap). Adds the self-FK that lets §5 sync RPCs
-- join sister WTC rows to their source by lineage instead of work_type_id.
--
-- Multi-generation chains (clone-of-clone) deferred to v2 — v1 sync walks
-- one generation only (source → direct sisters).
--
-- No backfill: zero active sisters exist in prod today. Every existing
-- proposal_wtc row is on a parent proposal (cloned_from_proposal_id IS NULL)
-- so the correct value is already NULL.
--
-- ON DELETE SET NULL (not CASCADE): if a source WTC is deleted, sister WTCs
-- become orphans-of-sync but remain valid standalone rows. CASCADE would
-- silently destroy sister data the rep never asked to lose.

ALTER TABLE public.proposal_wtc
  ADD COLUMN IF NOT EXISTS cloned_from_wtc_id uuid NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'proposal_wtc_cloned_from_wtc_id_fkey'
  ) THEN
    ALTER TABLE public.proposal_wtc
      ADD CONSTRAINT proposal_wtc_cloned_from_wtc_id_fkey
      FOREIGN KEY (cloned_from_wtc_id)
      REFERENCES public.proposal_wtc(id)
      ON DELETE SET NULL;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_proposal_wtc_cloned_from_wtc_id
  ON public.proposal_wtc (cloned_from_wtc_id)
  WHERE cloned_from_wtc_id IS NOT NULL;
