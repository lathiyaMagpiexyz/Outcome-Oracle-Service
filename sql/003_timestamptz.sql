-- Migration: Convert timestamp columns to TIMESTAMPTZ (timestamp with time zone)
--
-- Why: TIMESTAMP (without TZ) stores naive wall-clock values. If the app
-- server's TZ env var differs across environments (e.g. UTC in prod, local TZ
-- in dev), reads and writes drift by the TZ offset. TIMESTAMPTZ stores an
-- absolute moment and is TZ-safe regardless of client settings.
--
-- Assumption: existing naive values were inserted by a UTC-configured process
-- (standard for cloud deployments). If any rows were inserted under a
-- different TZ they will shift by that offset — verify before running in prod.
--
-- Safe to re-run: ALTER COLUMN TYPE is a no-op if already TIMESTAMPTZ.

ALTER TABLE outcomes
  ALTER COLUMN start_time TYPE TIMESTAMPTZ USING start_time AT TIME ZONE 'UTC',
  ALTER COLUMN expiry     TYPE TIMESTAMPTZ USING expiry     AT TIME ZONE 'UTC',
  ALTER COLUMN settled_at TYPE TIMESTAMPTZ USING settled_at AT TIME ZONE 'UTC',
  ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at AT TIME ZONE 'UTC',
  ALTER COLUMN updated_at TYPE TIMESTAMPTZ USING updated_at AT TIME ZONE 'UTC';
