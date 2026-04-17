import { query } from './pgClient';
import { OutcomeRecord, OutcomeResultValue, MarketType } from '../types';

type OutcomeRow = Omit<OutcomeRecord, 'rawMeta'> & { rawMeta: Record<string, unknown> | string | null };

const SELECT_COLUMNS = `
  id, name, underlying, target, start_time as "startTime", expiry,
  result, settled_at as "settledAt", mark_px as "markPx",
  question_id as "questionId", market_type as "marketType",
  raw_meta as "rawMeta", sentinel_filled as "sentinelFilled"
`;

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
  sentinelFilled?: boolean;
}

export interface OutcomeUpdate {
  result?: OutcomeResultValue;
  settledAt?: Date | null;
  markPx?: number | null;
  rawMeta?: Record<string, unknown>;
  sentinelFilled?: boolean;
}

export async function insertOutcome(outcome: OutcomeInsert): Promise<void> {
  const sql = `
    INSERT INTO outcomes (
      id, name, underlying, target, start_time, expiry,
      result, settled_at, mark_px, question_id, market_type, raw_meta,
      sentinel_filled
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
    ON CONFLICT (id) DO NOTHING
  `;
  const values = [
    outcome.id,
    outcome.name,
    outcome.underlying,
    outcome.target,
    outcome.startTime,
    outcome.expiry,
    outcome.result ?? null,
    outcome.settledAt ?? null,
    outcome.markPx ?? null,
    outcome.questionId ?? null,
    outcome.marketType,
    outcome.rawMeta ? JSON.stringify(outcome.rawMeta) : null,
    outcome.sentinelFilled ?? false,
  ];
  await query(sql, values);
}

export async function updateOutcome(id: string, updates: OutcomeUpdate): Promise<number> {
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
  if (updates.sentinelFilled !== undefined) {
    fields.push(`sentinel_filled = $${paramIndex++}`);
    values.push(updates.sentinelFilled);
  }

  if (fields.length === 0) return 0;

  fields.push(`updated_at = NOW()`);

  const sql = `UPDATE outcomes SET ${fields.join(', ')} WHERE id = $${paramIndex}`;
  values.push(id);

  const result = await query(sql, values);
  return result.rowCount ?? 0;
}

/**
 * Get active (unsettled) outcomes.
 * @param sentinelOnly - if true, only return outcomes where sentinel bought (for API). Default true.
 */
export async function getActiveOutcomes(sentinelOnly = true): Promise<OutcomeRecord[]> {
  const where = sentinelOnly
    ? 'WHERE result IS NULL AND sentinel_filled = TRUE'
    : 'WHERE result IS NULL';
  const sql = `SELECT ${SELECT_COLUMNS} FROM outcomes ${where} ORDER BY start_time DESC`;
  const result = await query<OutcomeRow>(sql);
  return result.rows.map(mapRow);
}

/**
 * Get inactive (settled) outcomes where sentinel had a position.
 */
export async function getInactiveOutcomes(): Promise<OutcomeRecord[]> {
  const sql = `
    SELECT ${SELECT_COLUMNS}
    FROM outcomes
    WHERE result IS NOT NULL AND sentinel_filled = TRUE
    ORDER BY settled_at DESC
  `;
  const result = await query<OutcomeRow>(sql);
  return result.rows.map(mapRow);
}

/**
 * Bulk lookup outcomes by IDs (only sentinel-filled).
 */
export async function getOutcomesByIds(ids: string[]): Promise<OutcomeRecord[]> {
  if (ids.length === 0) return [];
  const sql = `
    SELECT ${SELECT_COLUMNS}
    FROM outcomes
    WHERE id = ANY($1) AND sentinel_filled = TRUE
  `;
  const result = await query<OutcomeRow>(sql, [ids]);
  return result.rows.map(mapRow);
}

/**
 * Get a single outcome by ID (no sentinel filter — used internally).
 */
export async function getOutcomeById(id: string): Promise<OutcomeRecord | null> {
  const sql = `SELECT ${SELECT_COLUMNS} FROM outcomes WHERE id = $1`;
  const result = await query<OutcomeRow>(sql, [id]);
  if (result.rows.length === 0) return null;
  return mapRow(result.rows[0]);
}
