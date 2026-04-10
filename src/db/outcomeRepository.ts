import { query } from './pgClient';
import { OutcomeRecord, OutcomeResultValue, MarketType } from '../types';

type OutcomeRow = Omit<OutcomeRecord, 'rawMeta'> & { rawMeta: Record<string, unknown> | string | null };

function mapRow(row: OutcomeRow): OutcomeRecord {
  let rawMeta: Record<string, unknown>;
  if (!row.rawMeta) {
    rawMeta = {};
  } else if (typeof row.rawMeta === "string") {
    rawMeta = JSON.parse(row.rawMeta);
  } else {
    rawMeta = row.rawMeta;
  }
  return { ...row, rawMeta };
}

export interface OutcomeInsert {
  id: string;
  name: string;
  underlying?: string | null;
  target?: number | null;
  startTime: Date;
  expiry?: Date | null;
  result?: OutcomeResultValue;
  settledAt?: Date | null;
  markPx?: number | null;
  questionId?: number | null;
  marketType: MarketType;
  rawMeta?: Record<string, unknown>;
}

export interface OutcomeUpdate {
  result?: OutcomeResultValue;
  settledAt?: Date | null;
  markPx?: number | null;
  rawMeta?: Record<string, unknown>;
}

export async function insertOutcome(outcome: OutcomeInsert): Promise<void> {
  const sql = `
    INSERT INTO outcomes (
      id, name, underlying, target, start_time, expiry,
      result, settled_at, mark_px, question_id, market_type, raw_meta
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
    ON CONFLICT (id) DO NOTHING
  `;
  const values = [
    outcome.id,
    outcome.name,
    outcome.underlying,
    outcome.target,
    outcome.startTime,
    outcome.expiry,
    outcome.result || null,
    outcome.settledAt || null,
    outcome.markPx || null,
    outcome.questionId || null,
    outcome.marketType,
    outcome.rawMeta ? JSON.stringify(outcome.rawMeta) : null,
  ];
  await query(sql, values);
}

export async function updateOutcome(id: string, updates: OutcomeUpdate): Promise<void> {
  const fields: string[] = [];
  const values: unknown[] = [];
  let paramIndex = 1;

  if (updates.result !== undefined) {
    fields.push(`result = $${paramIndex++}`);
    values.push(updates.result);
  }
  if (updates.settledAt !== undefined) {
    fields.push(`settled_at = $${paramIndex++}`);
    values.push(updates.settledAt);
  }
  if (updates.markPx !== undefined) {
    fields.push(`mark_px = $${paramIndex++}`);
    values.push(updates.markPx);
  }
  if (updates.rawMeta !== undefined) {
    fields.push(`raw_meta = $${paramIndex++}`);
    values.push(JSON.stringify(updates.rawMeta));
  }

  if (fields.length === 0) return;

  fields.push(`updated_at = NOW()`);

  const sql = `UPDATE outcomes SET ${fields.join(', ')} WHERE id = $${paramIndex}`;
  values.push(id);

  await query(sql, values);
}

export async function getTodayOutcomes(): Promise<OutcomeRecord[]> {
  const sql = `
    SELECT
      id, name, underlying, target, start_time as "startTime", expiry,
      result, settled_at as "settledAt", mark_px as "markPx",
      question_id as "questionId", market_type as "marketType", raw_meta as "rawMeta"
    FROM outcomes
    WHERE DATE(start_time) = CURRENT_DATE
    ORDER BY start_time DESC
  `;
  const result = await query<OutcomeRow>(sql);
  return result.rows.map(mapRow);
}

export async function getActiveOutcomes(): Promise<OutcomeRecord[]> {
  const sql = `
    SELECT
      id, name, underlying, target, start_time as "startTime", expiry,
      result, settled_at as "settledAt", mark_px as "markPx",
      question_id as "questionId", market_type as "marketType", raw_meta as "rawMeta"
    FROM outcomes
    WHERE result IS NULL
    ORDER BY start_time DESC
  `;
  const result = await query<OutcomeRow>(sql);
  return result.rows.map(mapRow);
}

export async function getOutcomeById(id: string): Promise<OutcomeRecord | null> {
  const sql = `
    SELECT
      id, name, underlying, target, start_time as "startTime", expiry,
      result, settled_at as "settledAt", mark_px as "markPx",
      question_id as "questionId", market_type as "marketType", raw_meta as "rawMeta"
    FROM outcomes
    WHERE id = $1
  `;
  const result = await query<OutcomeRow>(sql, [id]);
  if (result.rows.length === 0) return null;
  return mapRow(result.rows[0]);
}

export async function getHistoryByDays(days: number): Promise<OutcomeRecord[]> {
  const cappedDays = Math.min(days, 20); // Cap at 20 days
  const sql = `
    SELECT
      id, name, underlying, target, start_time as "startTime", expiry,
      result, settled_at as "settledAt", mark_px as "markPx",
      question_id as "questionId", market_type as "marketType", raw_meta as "rawMeta"
    FROM outcomes
    WHERE result IS NOT NULL
      AND settled_at >= NOW() - INTERVAL '${cappedDays} days'
    ORDER BY settled_at DESC
  `;
  const result = await query<OutcomeRow>(sql);
  return result.rows.map(mapRow);
}