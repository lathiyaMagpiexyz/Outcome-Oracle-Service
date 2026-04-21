-- Outcome Oracle Database Schema
-- Run this in Supabase SQL Editor to create the outcomes table

CREATE TABLE IF NOT EXISTS outcomes (
  id VARCHAR(50) PRIMARY KEY,  -- e.g. "@3310"
  name VARCHAR(255) NOT NULL,   -- outcome name
  underlying VARCHAR(50),       -- e.g. "BTC"
  target NUMERIC,               -- e.g. 69473
  start_time TIMESTAMPTZ NOT NULL,
  expiry TIMESTAMPTZ,
  result VARCHAR(20) CHECK (result IN ('YES', 'NO', 'WINNER', 'LOSER') OR result IS NULL),
  settled_at TIMESTAMPTZ,
  mark_px NUMERIC,
  question_id INTEGER,
  market_type VARCHAR(10) NOT NULL CHECK (market_type IN ('binary', 'multi')),
  raw_meta JSONB,               -- full outcome meta as JSON
  sentinel_filled BOOLEAN NOT NULL DEFAULT FALSE,  -- true when sentinel wallet successfully bought
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for faster queries
CREATE INDEX IF NOT EXISTS idx_outcomes_market_type ON outcomes(market_type);
CREATE INDEX IF NOT EXISTS idx_outcomes_result ON outcomes(result);
CREATE INDEX IF NOT EXISTS idx_outcomes_settled_at ON outcomes(settled_at);
CREATE INDEX IF NOT EXISTS idx_outcomes_question_id ON outcomes(question_id);
CREATE INDEX IF NOT EXISTS idx_outcomes_start_time ON outcomes(start_time);
CREATE INDEX IF NOT EXISTS idx_outcomes_sentinel_filled ON outcomes(sentinel_filled);