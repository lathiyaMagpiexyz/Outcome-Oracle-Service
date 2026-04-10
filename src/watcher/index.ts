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
} from "../db/outcomeRepository";
import {
  QuestionMetaItem,
  OutcomeResultValue,
  MarketType,
  AllMidsResponse,
} from "../types";

// ── In-memory set of outcome IDs seen in the last poll ──
let knownOutcomeIds: Set<number> = new Set();
let isFirstPoll = true;
let pollTimer: ReturnType<typeof setInterval> | null = null;

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

// ── Settlement result determination ──

async function determineResult(
  outcomeId: number,
  marketType: MarketType,
  mids: AllMidsResponse
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
      `[watcher] fills check failed for ${coin}, falling back to markPx:`,
      (err as Error).message
    );
  }

  // Fallback: use last known mid price
  const midStr = mids[coin];
  if (midStr) {
    const mid = parseFloat(midStr);
    if (marketType === "binary") {
      return { result: mid >= 0.5 ? "YES" : "NO", markPx: mid };
    }
    return { result: mid >= 0.5 ? "WINNER" : "LOSER", markPx: mid };
  }

  // No data at all — outcome vanished without price info
  console.warn(`[watcher] no price data for ${coin}, result unknown`);
  return { result: null, markPx: null };
}

// ── Core poll cycle ──

export async function poll(): Promise<{
  newCount: number;
  settledCount: number;
}> {
  const [meta, mids] = await Promise.all([fetchOutcomeMeta(), fetchAllMids()]);

  const currentIds = new Set(meta.outcomes.map((o) => o.outcome));
  let newCount = 0;
  let settledCount = 0;

  // ── 1. Detect NEW outcomes → insert into DB ──
  for (const o of meta.outcomes) {
    if (!knownOutcomeIds.has(o.outcome)) {
      const { underlying, target } = parseNameParts(o.name);
      const { marketType, questionId } = parseMarketType(
        o.outcome,
        meta.questions
      );

      await insertOutcome({
        id: outcomeCoin(o.outcome),
        name: o.name,
        underlying,
        target,
        startTime: new Date(),
        marketType,
        questionId,
        rawMeta: o as unknown as Record<string, unknown>,
      });

      newCount++;
      console.log(`[watcher] new outcome: ${outcomeCoin(o.outcome)} "${o.name}" (${marketType})`);
    }
  }

  // ── 2. Detect SETTLED outcomes (was known, now gone) ──
  if (!isFirstPoll) {
    for (const id of knownOutcomeIds) {
      if (!currentIds.has(id)) {
        const coin = outcomeCoin(id);
        const { marketType } = parseMarketType(id, meta.questions);

        // Also check DB for market type in case question info is gone too
        const dbActive = await getActiveOutcomes();
        const dbRecord = dbActive.find((r) => r.id === coin);
        const effectiveType = dbRecord?.marketType ?? marketType;

        const { result, markPx } = await determineResult(
          id,
          effectiveType,
          mids
        );

        await updateOutcome(coin, {
          result,
          settledAt: new Date(),
          markPx,
        });

        settledCount++;
        console.log(
          `[watcher] settled: ${coin} → ${result ?? "UNKNOWN"} (markPx=${markPx})`
        );
      }
    }
  } else {
    // First poll: also sync any outcomes in DB that are active but not in API
    const dbActive = await getActiveOutcomes();
    for (const record of dbActive) {
      const numericId = parseInt(record.id.replace("@", ""), 10);
      if (!currentIds.has(numericId)) {
        const { result, markPx } = await determineResult(
          numericId,
          record.marketType,
          mids
        );

        await updateOutcome(record.id, {
          result,
          settledAt: new Date(),
          markPx,
        });

        settledCount++;
        console.log(
          `[watcher] settled (startup sync): ${record.id} → ${result ?? "UNKNOWN"}`
        );
      }
    }
  }

  // ── 3. Update known set for next cycle ──
  knownOutcomeIds = currentIds;
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

  // Run first poll immediately
  poll()
    .then(({ newCount, settledCount }) => {
      console.log(
        `[watcher] initial poll: ${newCount} new, ${settledCount} settled`
      );
    })
    .catch((err) => {
      console.error("[watcher] initial poll failed:", err);
    });

  // Then poll on interval
  pollTimer = setInterval(async () => {
    try {
      const { newCount, settledCount } = await poll();
      console.log(
        `[watcher] poll: ${newCount} new, ${settledCount} settled, ${knownOutcomeIds.size} active`
      );
    } catch (err) {
      console.error("[watcher] poll error:", err);
    }
  }, config.polling.intervalMs);
}

export function stopWatcher(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
    console.log("[watcher] stopped");
  }
}
