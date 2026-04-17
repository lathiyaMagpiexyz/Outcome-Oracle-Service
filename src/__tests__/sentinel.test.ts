/**
 * Tests for sentinel buy guards:
 * - midPx = 0 → skip (no Infinity order)
 * - Missing mid price → skip
 * - buyForNewOutcome returns boolean
 */

// We can't easily test postExchange (requires signing), so we test
// buyForNewOutcome's early guards which return before reaching postExchange.

jest.mock("../config", () => ({
  config: {
    sentinel: { privateKey: "0x" + "ab".repeat(32) },
    hyperliquid: { useTestnet: true },
  },
  getExchangeUrl: () => "https://api.hyperliquid-testnet.xyz/exchange",
}));

import { buyForNewOutcome } from "../sentinel";

describe("sentinel buy guards", () => {
  it("returns false when mid price is missing", async () => {
    const mids = { "@9999": "0.5" }; // no entry for @4284
    const result = await buyForNewOutcome(4284, mids);
    expect(result).toBe(false);
  });

  it("returns false when mid price is '0'", async () => {
    const mids = { "@4284": "0" };
    const result = await buyForNewOutcome(4284, mids);
    expect(result).toBe(false);
  });

  it("returns false when mid price is negative", async () => {
    const mids = { "@4284": "-0.5" };
    const result = await buyForNewOutcome(4284, mids);
    expect(result).toBe(false);
  });

  it("returns false for empty mids object", async () => {
    const result = await buyForNewOutcome(4284, {});
    expect(result).toBe(false);
  });
});
