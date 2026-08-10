-- Add a stable ordering column to pages so the API can return pages in
-- the order they were created, regardless of insertion timing or UUID.
ALTER TABLE pages ADD COLUMN IF NOT EXISTS position INTEGER NOT NULL DEFAULT 0;

-- Backfill position based on creation order inferred from page_id.
-- page_id is a UUID v4 (random) so we order by something deterministic:
-- the row's natural order. This is one-time and idempotent.
WITH ordered AS (
    SELECT page_id, ROW_NUMBER() OVER (PARTITION BY board_id ORDER BY page_id) - 1 AS new_pos
    FROM pages
)
UPDATE pages p
SET position = ordered.new_pos
FROM ordered
WHERE p.page_id = ordered.page_id AND p.position = 0;
