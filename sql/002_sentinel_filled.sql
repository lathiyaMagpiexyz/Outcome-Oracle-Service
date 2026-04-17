-- Migration: Add sentinel_filled column to outcomes table
-- Run this on existing databases to add the new column

ALTER TABLE outcomes ADD COLUMN IF NOT EXISTS sentinel_filled BOOLEAN NOT NULL DEFAULT FALSE;
CREATE INDEX IF NOT EXISTS idx_outcomes_sentinel_filled ON outcomes(sentinel_filled);
