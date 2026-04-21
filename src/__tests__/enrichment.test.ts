/**
 * Tests for enrichment helpers: enrichOutcome and toBulkResultItem
 */

import { enrichOutcome, toBulkResultItem } from "../api/enrichment";
import { OutcomeRecord } from "../types";

function makeRecord(overrides: Partial<OutcomeRecord> = {}): OutcomeRecord {
  return {
    id: "@100",
    name: "BTC > 84000",
    underlying: "BTC",
    target: 84000,
    startTime: new Date("2026-04-16"),
    expiry: new Date("2026-04-16T08:00:00Z"),
    result: null,
    settledAt: null,
    markPx: null,
    questionId: null,
    marketType: "binary",
    rawMeta: {},
    sentinelFilled: true,
    ...overrides,
  };
}

describe("enrichOutcome", () => {
  it("enriches BTC binary outcome with Above/Below labels", () => {
    const result = enrichOutcome(makeRecord());
    expect(result).toEqual({
      id: "@100",
      outcomeId: 100,
      name: "BTC > 84000",
      displayName: "BTC > 84000",
      question: "Will BTC be above $84,000 at expiry?",
      underlying: "BTC",
      targetPrice: 84000,
      expiry: "2026-04-16T08:00:00.000Z",
      expiryTime: Math.floor(new Date("2026-04-16T08:00:00Z").getTime() / 1000),
      period: null,
      marketType: "binary",
      isBTC: true,
      isHYPE: false,
      isCustom: false,
      yesLabel: "Above",
      noLabel: "Below",
    });
  });

  it("parses period from rawMeta.description and builds displayName", () => {
    const result = enrichOutcome(makeRecord({
      rawMeta: { description: "class:priceBinary|underlying:BTC|expiry:20260414-0300|targetPrice:71238|period:1d" },
    }));
    expect(result.period).toBe("1d");
    expect(result.displayName).toBe("BTC daily");
  });

  it("maps 15m period to 15min displayName", () => {
    const result = enrichOutcome(makeRecord({
      underlying: "HYPE",
      rawMeta: { description: "period:15m" },
    }));
    expect(result.period).toBe("15m");
    expect(result.displayName).toBe("HYPE 15min");
  });

  it("enriches HYPE outcome", () => {
    const result = enrichOutcome(makeRecord({
      id: "@200",
      name: "HYPE > 25",
      underlying: "HYPE",
      target: 25,
    }));
    expect(result.isBTC).toBe(false);
    expect(result.isHYPE).toBe(true);
    expect(result.isCustom).toBe(false);
    expect(result.yesLabel).toBe("Above");
    expect(result.noLabel).toBe("Below");
  });

  it("marks custom underlying correctly", () => {
    const result = enrichOutcome(makeRecord({
      name: "ETH > 3500",
      underlying: "ETH",
      target: 3500,
    }));
    expect(result.isBTC).toBe(false);
    expect(result.isHYPE).toBe(false);
    expect(result.isCustom).toBe(true);
  });

  it("uses Yes/No labels for non-binary-comparison names", () => {
    const result = enrichOutcome(makeRecord({
      name: "Recurring",
      marketType: "binary",
    }));
    expect(result.yesLabel).toBe("Yes");
    expect(result.noLabel).toBe("No");
  });

  it("uses Yes/No labels for multi-market outcomes", () => {
    const result = enrichOutcome(makeRecord({
      name: "Who wins > final",
      marketType: "multi",
    }));
    expect(result.yesLabel).toBe("Yes");
    expect(result.noLabel).toBe("No");
  });

  it("handles null underlying", () => {
    const result = enrichOutcome(makeRecord({ underlying: null }));
    expect(result.isBTC).toBe(false);
    expect(result.isHYPE).toBe(false);
    expect(result.isCustom).toBe(true);
    expect(result.underlying).toBeNull();
  });
});

describe("toBulkResultItem", () => {
  it("returns unsettled outcome with null booleans", () => {
    const result = toBulkResultItem(makeRecord({ result: null }));
    expect(result).toEqual({
      id: "@100",
      outcomeId: 100,
      name: "BTC > 84000",
      settled: false,
      yesWon: null,
      noWon: null,
      settledAt: null,
    });
  });

  it("serializes settledAt as ISO string when present", () => {
    const settledAt = new Date("2026-04-17T12:00:00Z");
    const result = toBulkResultItem(makeRecord({ result: "YES", settledAt }));
    expect(result.settledAt).toBe("2026-04-17T12:00:00.000Z");
  });

  it("returns YES result as yesWon=true", () => {
    const result = toBulkResultItem(makeRecord({ result: "YES" }));
    expect(result.settled).toBe(true);
    expect(result.yesWon).toBe(true);
    expect(result.noWon).toBe(false);
  });

  it("returns NO result as noWon=true", () => {
    const result = toBulkResultItem(makeRecord({ result: "NO" }));
    expect(result.settled).toBe(true);
    expect(result.yesWon).toBe(false);
    expect(result.noWon).toBe(true);
  });

  it("returns WINNER result as yesWon=true", () => {
    const result = toBulkResultItem(makeRecord({ result: "WINNER" }));
    expect(result.settled).toBe(true);
    expect(result.yesWon).toBe(true);
    expect(result.noWon).toBe(false);
  });

  it("returns LOSER result as noWon=true", () => {
    const result = toBulkResultItem(makeRecord({ result: "LOSER" }));
    expect(result.settled).toBe(true);
    expect(result.yesWon).toBe(false);
    expect(result.noWon).toBe(true);
  });
});
