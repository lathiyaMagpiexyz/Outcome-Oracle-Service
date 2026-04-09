// Hyperliquid API response types

export interface OutcomeSideSpec {
  name: string;
}

export interface OutcomeMetaItem {
  outcome: number;
  name: string;
  description: string;
  sideSpecs: OutcomeSideSpec[];
}

export interface QuestionMetaItem {
  question: number;
  name: string;
  description: string;
  fallbackOutcome: number;
  namedOutcomes: number[];
  settledNamedOutcomes: number[];
}

export interface OutcomeMetaResponse {
  outcomes: OutcomeMetaItem[];
  questions: QuestionMetaItem[];
}

export interface UserFill {
  coin: string;
  px: string;
  sz: string;
  side: "A" | "B";
  time: number;
  startPosition: string;
  dir: string;
  closedPnl: string;
  hash: string;
  oid: number;
  crossed: boolean;
  fee: string;
  tid: number;
  feeToken: string;
  twapId: number | null;
}

export type MarketType = "binary" | "multi";
export type OutcomeResultValue = "YES" | "NO" | "WINNER" | "LOSER" | null;

export interface OutcomeResult {
  id: string;
  result: OutcomeResultValue;
  settledAt: Date | null;
  markPx: number | null;
}

// Hyperliquid /info responses

export type AllMidsResponse = Record<string, string>;

export interface AssetPosition {
  type: string;
  position: {
    coin: string;
    szi: string;
    entryPx: string | null;
    positionValue: string;
    unrealizedPnl: string;
    returnOnEquity: string;
    leverage: { type: string; value: number };
    liquidationPx: string | null;
    marginUsed: string;
    maxLeverage: number;
    cumFunding: { allTime: string; sinceOpen: string; sinceChange: string };
  };
}

export interface MarginSummary {
  accountValue: string;
  totalNtlPos: string;
  totalRawUsd: string;
  totalMarginUsed: string;
}

export interface UserStateResponse {
  marginSummary: MarginSummary;
  crossMarginSummary: MarginSummary;
  crossMaintenanceMarginUsed: string;
  withdrawable: string;
  assetPositions: AssetPosition[];
  time: number;
}

export interface OutcomeRecord {
  id: string;                  // e.g. "@3310"
  name: string;                // outcome name
  underlying: string | null;   // e.g. "BTC"
  target: number | null;       // e.g. 69473
  startTime: Date;
  expiry: Date | null;
  result: OutcomeResultValue;
  settledAt: Date | null;
  markPx: number | null;
  questionId: number | null;
  marketType: MarketType;
  rawMeta: Record<string, unknown>;
}
