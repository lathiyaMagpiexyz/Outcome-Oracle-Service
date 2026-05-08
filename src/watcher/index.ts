import { config } from "../config";
import {
  fetchOutcomeMeta,
  fetchAllMids,
  fetchUserFillsByTime,
} from "../hyperliquid";
import {
  insertOutcome,
  updateOutcome,
  getActiveOutcomes,
  getOutcomeById,
} from "../db/outcomeRepository";
import { buyForNewOutcome } from "../sentinel";
import {
  QuestionMetaItem,
  OutcomeResultValue,
  MarketType,
} from "../types";

// ── In-memory state ──
let knownOutcomeIds: Set<number> = new Set();
let isFirstPoll = true;
let pollTimer: ReturnType<typeof setTimeout> | null = null;

// Track outcomes where sentinel buy failed, with retry counts
const failedBuys: Map<number, { attempts: number; mids: Record<string, string> }> = new Map();
const MAX_BUY_RETRIES = 3;

// ── Helpers ──

function outcomeCoin(outcomeId: number): string {
  return `@${outcomeId}`;
}

function parseMarketType(
  outcomeId: number,
  questions: QuestionMetaItem[]
): { marketType: MarketType; questionId: number | null } {
  for (const q of questions) {
    if (q.namedOutcomes.includes(outcomeId)) {
      return { marketType: "multi", questionId: q.question };
    }
  }
  return { marketType: "binary", questionId: null };
}

function parseNameParts(name: string): {
  underlying: string | null;
  target: number | null;
} {
  // e.g. "BTC > 69473 (Apr 10)" → underlying=BTC, target=69473
  const match = name.match(/^(\w+)\s*[><]=?\s*([\d.]+)/);
  if (match) {
    return {
      underlying: match[1],
      target: parseFloat(match[2]),
    };
  }
  return { underlying: null, target: null };
}

/**
 * Parse Recurring outcome description for underlying, target, and expiry.
 * Format: "class:priceBinary|underlying:BTC|expiry:20260414-0300|targetPrice:71238|period:1d"
 */
function parseDescription(description: string): {
  underlying: string | null;
  target: number | null;
  expiry: Date | null;
} {
  const fields = new Map<string, string>();
  for (const part of description.split("|")) {
    const idx = part.indexOf(":");
    if (idx > 0) {
      fields.set(part.slice(0, idx), part.slice(idx + 1));
    }
  }

  const underlying = fields.get("underlying") ?? null;
  const targetStr = fields.get("targetPrice");
  const target = targetStr ? parseFloat(targetStr) : null;

  let expiry: Date | null = null;
  const expiryStr = fields.get("expiry");
  if (expiryStr) {
    // "20260414-0300" → 2026-04-14T03:00:00Z
    const match = expiryStr.match(/^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})$/);
    if (match) {
      expiry = new Date(`${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:00Z`);
    }
  }

  return { underlying, target, expiry };
}

// ── Settlement result determination ──

async function determineResult(
  outcomeId: number,
  marketType: MarketType
): Promise<{ result: OutcomeResultValue; markPx: number | null }> {
  const coin = outcomeCoin(outcomeId);

  // Try sentinel fills first (Day 6-7 will buy contracts; for now this
  // returns empty if the sentinel has no position — falls through to markPx)
  try {
    const lookbackMs = 5 * 60 * 1000; // look back 5 minutes
    const now = Date.now();
    const fills = await fetchUserFillsByTime(
      config.sentinel.wallet,
      now - lookbackMs,
      now
    );

    const settlementFills = fills.filter((f) => f.coin === coin);

    if (settlementFills.length > 0) {
      const fill = settlementFills[settlementFills.length - 1];

      if (marketType === "binary") {
        const px = parseFloat(fill.px);
        if (px === 1.0) return { result: "YES", markPx: px };
        if (px === 0.0) return { result: "NO", markPx: px };
      } else {
        const pnl = parseFloat(fill.closedPnl);
        return {
          result: pnl > 0 ? "WINNER" : "LOSER",
          markPx: parseFloat(fill.px),
        };
      }
    }
  } catch (err) {
    console.warn(
      `[watcher] fills check failed for ${coin}:`,
      (err as Error).message
    );
  }

  // No sentinel fills — cannot determine result reliably.
  // Poll-time prices are NOT settlement-time prices and can produce wrong results.
  console.warn(`[watcher] no sentinel fills for ${coin}, result unknown — sentinel may not have a position`);
  return { result: null, markPx: null };
}

// ── Core poll cycle ──

export async function poll(): Promise<{
  newCount: number;
  settledCount: number;
}> {
  const [meta, mids] = await Promise.all([fetchOutcomeMeta(), fetchAllMids()]);

  // Only track Recurring priceBinary outcomes (skip custom, fallback, named)
  const recurringOutcomes = meta.outcomes.filter((o) => o.name === "Recurring");
  const currentIds = new Set(recurringOutcomes.map((o) => o.outcome));
  const previousKnownIds = new Set(knownOutcomeIds);
  let newCount = 0;
  let settledCount = 0;

  // Update known set early so it's never stale even if later steps throw
  knownOutcomeIds = currentIds;

  // ── 1. Detect NEW outcomes → insert into DB ──
  for (const o of recurringOutcomes) {
    if (previousKnownIds.has(o.outcome)) continue;

    // Guard: skip if we already successfully bought this outcome in a prior run.
    // Without this, every Railway restart re-buys every live outcome (drains funds).
    const existing = await getOutcomeById(outcomeCoin(o.outcome));
    if (existing?.sentinelFilled) continue;

    if (!existing) {
      let { underlying, target } = parseNameParts(o.name);
      let expiry: Date | null = null;

      if (o.name === "Recurring" && o.description) {
        const parsed = parseDescription(o.description);
        underlying = parsed.underlying ?? underlying;
        target = parsed.target ?? target;
        expiry = parsed.expiry;
      }

      const { marketType, questionId } = parseMarketType(
        o.outcome,
        meta.questions
      );

      await insertOutcome({
        id: outcomeCoin(o.outcome),
        name: o.name,
        underlying,
        target,
        expiry,
        startTime: new Date(),
        marketType,
        questionId,
        rawMeta: o as unknown as Record<string, unknown>,
      });

      newCount++;
      console.log(`[watcher] new outcome: ${outcomeCoin(o.outcome)} "${o.name}" (${marketType})`);
    }

    // Sentinel: buy 1 contract (for new outcomes or DB rows where prior buy failed)
    try {
      const bought = await buyForNewOutcome(o.outcome, mids);
      if (bought) {
        await updateOutcome(outcomeCoin(o.outcome), { sentinelFilled: true });
      } else {
        failedBuys.set(o.outcome, { attempts: 1, mids });
      }
    } catch (err) {
      console.error(`[watcher] sentinel buy failed for ${outcomeCoin(o.outcome)}:`, (err as Error).message);
      failedBuys.set(o.outcome, { attempts: 1, mids });
    }
  }

  // ── 1b. Retry failed sentinel buys ──
  for (const [outcomeId, state] of failedBuys) {
    if (!currentIds.has(outcomeId)) {
      // Outcome already settled/gone, no point retrying
      failedBuys.delete(outcomeId);
      continue;
    }
    if (state.attempts >= MAX_BUY_RETRIES) {
      console.warn(`[watcher] sentinel buy for ${outcomeCoin(outcomeId)} exhausted ${MAX_BUY_RETRIES} retries, giving up`);
      failedBuys.delete(outcomeId);
      continue;
    }
    try {
      console.log(`[watcher] retrying sentinel buy for ${outcomeCoin(outcomeId)} (attempt ${state.attempts + 1}/${MAX_BUY_RETRIES})`);
      const bought = await buyForNewOutcome(outcomeId, mids);
      if (bought) {
        console.log(`[watcher] sentinel retry succeeded for ${outcomeCoin(outcomeId)}`);
        await updateOutcome(outcomeCoin(outcomeId), { sentinelFilled: true });
        failedBuys.delete(outcomeId);
      } else {
        state.attempts++;
      }
    } catch (err) {
      state.attempts++;
      console.error(`[watcher] sentinel retry failed for ${outcomeCoin(outcomeId)}:`, (err as Error).message);
    }
  }

  // ── 2. Detect SETTLED outcomes (was known, now gone) ──
  const dbActive = await getActiveOutcomes(false);

  if (!isFirstPoll) {
    for (const id of previousKnownIds) {
      if (!currentIds.has(id)) {
        const coin = outcomeCoin(id);
        const { marketType } = parseMarketType(id, meta.questions);

        // Also check DB for market type in case question info is gone too
        const dbRecord = dbActive.find((r) => r.id === coin);
        const effectiveType = dbRecord?.marketType ?? marketType;

        const { result, markPx } = await determineResult(
          id,
          effectiveType
        );

        const rowsUpdated = await updateOutcome(coin, {
          result,
          settledAt: new Date(),
          markPx,
        });

        settledCount++;
        console.log(
          `[watcher] settled: ${coin} → ${result ?? "UNKNOWN"} (markPx=${markPx}) [${rowsUpdated} row(s) updated]`
        );
      }
    }
  } else {
    // First poll: also sync any outcomes in DB that are active but not in API
    for (const record of dbActive) {
      const numericId = parseInt(record.id.replace("@", ""), 10);
      if (!currentIds.has(numericId)) {
        const { result, markPx } = await determineResult(
          numericId,
          record.marketType
        );

        const rowsUpdated = await updateOutcome(record.id, {
          result,
          settledAt: new Date(),
          markPx,
        });

        settledCount++;
        console.log(
          `[watcher] settled (startup sync): ${record.id} → ${result ?? "UNKNOWN"} [${rowsUpdated} row(s)]`
        );
      }
    }
  }

  // Known set already updated early (before step 1) to avoid staleness on errors
  isFirstPoll = false;

  return { newCount, settledCount };
}

// ── Lifecycle ──

export function startWatcher(): void {
  if (pollTimer) {
    console.warn("[watcher] already running");
    return;
  }

  console.log(
    `[watcher] starting, poll interval: ${config.polling.intervalMs}ms`
  );

  async function schedulePoll(): Promise<void> {
    try {
      const { newCount, settledCount } = await poll();
      console.log(
        `[watcher] poll: ${newCount} new, ${settledCount} settled, ${knownOutcomeIds.size} active`
      );
    } catch (err) {
      console.error("[watcher] poll error:", err);
    }
    // Schedule next poll only after current one finishes
    if (pollTimer !== null) {
      pollTimer = setTimeout(schedulePoll, config.polling.intervalMs);
    }
  }

  // Run first poll immediately, then chain via setTimeout
  pollTimer = setTimeout(schedulePoll, 0);
}

export function stopWatcher(): void {
  if (pollTimer !== null) {
    clearTimeout(pollTimer);
    pollTimer = null;
    console.log("[watcher] stopped");
  }
}

// Exported for testing only
export const _testExports = {
  parseNameParts,
  parseDescription,
  parseMarketType,
  determineResult,
  outcomeCoin,
  resetState() {
    knownOutcomeIds = new Set();
    isFirstPoll = true;
    failedBuys.clear();
  },
};
