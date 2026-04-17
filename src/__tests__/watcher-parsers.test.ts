/**
 * Tests for watcher helper/parser functions:
 * - parseNameParts
 * - parseDescription
 * - parseMarketType
 * - outcomeCoin
 */

// Mock all external deps so the module loads without config/DB/network
jest.mock("../config", () => ({
  config: { sentinel: { wallet: "0x0000" }, polling: { intervalMs: 30000 } },
}));
jest.mock("../hyperliquid", () => ({}));
jest.mock("../db/outcomeRepository", () => ({}));
jest.mock("../sentinel", () => ({}));

import { _testExports } from "../watcher";

const { parseNameParts, parseDescription, parseMarketType, outcomeCoin } =
  _testExports;

// ── outcomeCoin ──

describe("outcomeCoin", () => {
  it("formats outcome ID with @ prefix", () => {
    expect(outcomeCoin(3310)).toBe("@3310");
    expect(outcomeCoin(0)).toBe("@0");
    expect(outcomeCoin(99999)).toBe("@99999");
  });
});

// ── parseNameParts ──

describe("parseNameParts", () => {
  it("parses 'BTC > 69473 (Apr 10)' correctly", () => {
    const result = parseNameParts("BTC > 69473 (Apr 10)");
    expect(result).toEqual({ underlying: "BTC", target: 69473 });
  });

  it("parses 'ETH >= 3500.50' with decimal target", () => {
    const result = parseNameParts("ETH >= 3500.50");
    expect(result).toEqual({ underlying: "ETH", target: 3500.5 });
  });

  it("parses 'HYPE < 25' with less-than operator", () => {
    const result = parseNameParts("HYPE < 25");
    expect(result).toEqual({ underlying: "HYPE", target: 25 });
  });

  it("parses names without spaces around operator", () => {
    const result = parseNameParts("BTC>84000");
    expect(result).toEqual({ underlying: "BTC", target: 84000 });
  });

  it("returns nulls for non-matching names", () => {
    expect(parseNameParts("Recurring")).toEqual({
      underlying: null,
      target: null,
    });
    expect(parseNameParts("Some random market")).toEqual({
      underlying: null,
      target: null,
    });
  });

  it("returns nulls for empty string", () => {
    expect(parseNameParts("")).toEqual({ underlying: null, target: null });
  });
});

// ── parseDescription ──

describe("parseDescription", () => {
  it("parses full recurring description", () => {
    const desc =
      "class:priceBinary|underlying:BTC|expiry:20260414-0300|targetPrice:71238|period:1d";
    const result = parseDescription(desc);
    expect(result.underlying).toBe("BTC");
    expect(result.target).toBe(71238);
    expect(result.expiry).toEqual(new Date("2026-04-14T03:00:00Z"));
  });

  it("parses description with HYPE underlying", () => {
    const desc =
      "class:priceBinary|underlying:HYPE|expiry:20260415-1200|targetPrice:25.5|period:15m";
    const result = parseDescription(desc);
    expect(result.underlying).toBe("HYPE");
    expect(result.target).toBe(25.5);
    expect(result.expiry).toEqual(new Date("2026-04-15T12:00:00Z"));
  });

  it("returns nulls for missing fields", () => {
    const result = parseDescription("class:priceBinary|period:1d");
    expect(result).toEqual({ underlying: null, target: null, expiry: null });
  });

  it("handles malformed expiry gracefully", () => {
    const desc = "underlying:BTC|expiry:badformat|targetPrice:80000";
    const result = parseDescription(desc);
    expect(result.underlying).toBe("BTC");
    expect(result.target).toBe(80000);
    expect(result.expiry).toBeNull();
  });

  it("handles empty string", () => {
    const result = parseDescription("");
    expect(result).toEqual({ underlying: null, target: null, expiry: null });
  });
});

// ── parseMarketType ──

describe("parseMarketType", () => {
  const questions = [
    {
      question: 100,
      name: "Who wins?",
      description: "",
      fallbackOutcome: 5001,
      namedOutcomes: [5001, 5002, 5003],
      settledNamedOutcomes: [],
    },
  ];

  it("returns multi when outcome is in a question's namedOutcomes", () => {
    const result = parseMarketType(5002, questions);
    expect(result).toEqual({ marketType: "multi", questionId: 100 });
  });

  it("returns binary when outcome is not in any question", () => {
    const result = parseMarketType(9999, questions);
    expect(result).toEqual({ marketType: "binary", questionId: null });
  });

  it("returns binary for empty questions array", () => {
    const result = parseMarketType(5002, []);
    expect(result).toEqual({ marketType: "binary", questionId: null });
  });
});
