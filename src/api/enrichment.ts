import { OutcomeRecord, EnrichedOutcome, BulkResultItem } from "../types";

export function enrichOutcome(o: OutcomeRecord): EnrichedOutcome {
  const isBTC = o.underlying === "BTC";
  const isHYPE = o.underlying === "HYPE";
  const isCustom = !isBTC && !isHYPE;

  let yesLabel = "Yes";
  let noLabel = "No";
  if (o.marketType === "binary" && o.name.includes(">")) {
    yesLabel = "Above";
    noLabel = "Below";
  }

  return {
    id: o.id,
    name: o.name,
    underlying: o.underlying,
    targetPrice: o.target,
    expiry: o.expiry,
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
    name: o.name,
    settled,
    yesWon: settled ? (o.result === "YES" || o.result === "WINNER") : null,
    noWon: settled ? (o.result === "NO" || o.result === "LOSER") : null,
  };
}
