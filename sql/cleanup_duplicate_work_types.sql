-- ============================================================
-- Cleanup duplicate work_types entries
-- Run this in Supabase SQL Editor (Dashboard > SQL Editor)
-- ============================================================

-- STEP 1: Preview duplicates (run this first to see what we're dealing with)
SELECT name, array_agg(id ORDER BY id) AS ids, count(*) AS cnt
FROM work_types
GROUP BY name
HAVING count(*) > 1
ORDER BY name;

-- STEP 2: Preview which proposal_wtc rows reference duplicate (non-canonical) IDs
-- The "canonical" ID is the lowest ID for each name
WITH dupes AS (
  SELECT id, name,
    min(id) OVER (PARTITION BY name) AS keep_id
  FROM work_types
),
to_update AS (
  SELECT pw.id AS proposal_wtc_id, pw.work_type_id AS old_id, d.keep_id AS new_id, d.name
  FROM proposal_wtc pw
  JOIN dupes d ON d.id = pw.work_type_id
  WHERE d.id != d.keep_id
)
SELECT * FROM to_update ORDER BY name, proposal_wtc_id;

-- STEP 3: Also check job_work_types references
WITH dupes AS (
  SELECT id, name,
    min(id) OVER (PARTITION BY name) AS keep_id
  FROM work_types
),
to_update AS (
  SELECT jw.id AS job_work_types_id, jw.work_type_id AS old_id, d.keep_id AS new_id, d.name
  FROM job_work_types jw
  JOIN dupes d ON d.id = jw.work_type_id
  WHERE d.id != d.keep_id
)
SELECT * FROM to_update ORDER BY name, job_work_types_id;

-- ============================================================
-- After reviewing the above, run STEP 4 + 5 + 6 together:
-- ============================================================

-- STEP 4: Update proposal_wtc to point to canonical (lowest) IDs
WITH dupes AS (
  SELECT id, name,
    min(id) OVER (PARTITION BY name) AS keep_id
  FROM work_types
)
UPDATE proposal_wtc
SET work_type_id = d.keep_id
FROM dupes d
WHERE proposal_wtc.work_type_id = d.id
  AND d.id != d.keep_id;

-- STEP 5: Update job_work_types to point to canonical (lowest) IDs
WITH dupes AS (
  SELECT id, name,
    min(id) OVER (PARTITION BY name) AS keep_id
  FROM work_types
)
UPDATE job_work_types
SET work_type_id = d.keep_id
FROM dupes d
WHERE job_work_types.work_type_id = d.id
  AND d.id != d.keep_id;

-- STEP 6: Delete duplicate rows (keep only the lowest ID per name)
DELETE FROM work_types
WHERE id IN (
  SELECT id FROM (
    SELECT id, name,
      row_number() OVER (PARTITION BY name ORDER BY id) AS rn
    FROM work_types
  ) numbered
  WHERE rn > 1
);

-- STEP 7: Verify — should show no duplicates
SELECT name, count(*) AS cnt
FROM work_types
GROUP BY name
HAVING count(*) > 1;
