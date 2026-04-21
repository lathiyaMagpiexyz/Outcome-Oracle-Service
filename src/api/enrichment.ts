import { OutcomeRecord, EnrichedOutcome, BulkResultItem } from "../types";

export function enrichOutcome(o: OutcomeRecord): EnrichedOutcome {
  const isBTC = o.underlying === "BTC";
  const isHYPE = o.underlying === "HYPE";
  const isCustom = !isBTC && !isHYPE;

  let period: string | null = null;
  const desc = (o.rawMeta as { description?: string } | null)?.description ?? "";
  const periodMatch = desc.match(/period:(\w+)/);
  if (periodMatch) period = periodMatch[1];

  let displayName = o.name;
  if (period && o.underlying) {
    const periodLabel = period === "1d" ? "daily" : period === "15m" ? "15min" : period;
    displayName = `${o.underlying} ${periodLabel}`;
  }

  let question = o.name;
  if (o.underlying && o.target !== null) {
    question = `Will ${o.underlying} be above $${o.target.toLocaleString()} at expiry?`;
  }

  let yesLabel = "Yes";
  let noLabel = "No";
  if (o.marketType === "binary" && o.name.includes(">")) {
    yesLabel = "Above";
    noLabel = "Below";
  }

  const outcomeId = parseInt(o.id.replace("@", ""), 10);
  const expiryTime = o.expiry ? Math.floor(o.expiry.getTime() / 1000) : null;

  return {
    id: o.id,
    outcomeId,
    name: o.name,
    displayName,
    question,
    underlying: o.underlying,
    targetPrice: o.target,
    expiry: o.expiry ? o.expiry.toISOString() : null,
    expiryTime,
    period,
    marketType: o.marketType,
    isBTC,
    isHYPE,
    isCustom,
    yesLabel,
    noLabel,
  };
}

export function toBulkResultItem(o: OutcomeRecord): BulkResultItem {
  const settled = o.result !== null;
  return {
    id: o.id,
    outcomeId: parseInt(o.id.replace("@", ""), 10),
    name: o.name,
    settled,
    yesWon: settled ? (o.result === "YES" || o.result === "WINNER") : null,
    noWon: settled ? (o.result === "NO" || o.result === "LOSER") : null,
    settledAt: o.settledAt ? o.settledAt.toISOString() : null,
  };
}
