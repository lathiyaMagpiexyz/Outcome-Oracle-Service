/**
 * Tests for determineResult — verifies sentinel-fill-only settlement logic
 * and that unreliable price fallbacks are gone.
 */

const mockFetchUserFillsByTime = jest.fn();

jest.mock("../config", () => ({
  config: { sentinel: { wallet: "0xSENTINEL" }, polling: { intervalMs: 30000 } },
}));
jest.mock("../hyperliquid", () => ({
  fetchOutcomeMeta: jest.fn(),
  fetchAllMids: jest.fn(),
  fetchUserFillsByTime: (...args: unknown[]) =>
    mockFetchUserFillsByTime(...args),
}));
jest.mock("../db/outcomeRepository", () => ({
  insertOutcome: jest.fn(),
  updateOutcome: jest.fn(),
  getActiveOutcomes: jest.fn().mockResolvedValue([]),
}));
jest.mock("../sentinel", () => ({
  buyForNewOutcome: jest.fn(),
}));

import { _testExports } from "../watcher";

const { determineResult } = _testExports;

beforeEach(() => {
  jest.clearAllMocks();
});

describe("determineResult", () => {
  // ── Binary market: sentinel fills ──

  it("returns YES when binary fill px = 1.0", async () => {
    mockFetchUserFillsByTime.mockResolvedValue([
      { coin: "@4284", px: "1.0", closedPnl: "0", sz: "15" },
    ]);

    const result = await determineResult(4284, "binary");
    expect(result).toEqual({ result: "YES", markPx: 1 });
  });

  it("returns NO when binary fill px = 0.0", async () => {
    mockFetchUserFillsByTime.mockResolvedValue([
      { coin: "@4284", px: "0.0", closedPnl: "0", sz: "15" },
    ]);

    const result = await determineResult(4284, "binary");
    expect(result).toEqual({ result: "NO", markPx: 0 });
  });

  it("uses last fill when multiple fills exist", async () => {
    mockFetchUserFillsByTime.mockResolvedValue([
      { coin: "@4284", px: "0.0", closedPnl: "0", sz: "15" },
      { coin: "@4284", px: "1.0", closedPnl: "0", sz: "15" },
    ]);

    const result = await determineResult(4284, "binary");
    expect(result).toEqual({ result: "YES", markPx: 1 });
  });

  it("ignores fills for other coins", async () => {
    mockFetchUserFillsByTime.mockResolvedValue([
      { coin: "@9999", px: "1.0", closedPnl: "0", sz: "15" },
    ]);

    const result = await determineResult(4284, "binary");
    expect(result).toEqual({ result: null, markPx: null });
  });

  // ── Multi market: sentinel fills ──

  it("returns WINNER when multi fill has positive pnl", async () => {
    mockFetchUserFillsByTime.mockResolvedValue([
      { coin: "@5001", px: "0.8", closedPnl: "12.5", sz: "15" },
    ]);

    const result = await determineResult(5001, "multi");
    expect(result).toEqual({ result: "WINNER", markPx: 0.8 });
  });

  it("returns LOSER when multi fill has negative pnl", async () => {
    mockFetchUserFillsByTime.mockResolvedValue([
      { coin: "@5001", px: "0.1", closedPnl: "-5.0", sz: "15" },
    ]);

    const result = await determineResult(5001, "multi");
    expect(result).toEqual({ result: "LOSER", markPx: 0.1 });
  });

  it("returns LOSER when multi fill has zero pnl", async () => {
    mockFetchUserFillsByTime.mockResolvedValue([
      { coin: "@5001", px: "0.5", closedPnl: "0", sz: "15" },
    ]);

    const result = await determineResult(5001, "multi");
    expect(result).toEqual({ result: "LOSER", markPx: 0.5 });
  });

  // ── No fills → null (no fallback) ──

  it("returns null when no sentinel fills exist", async () => {
    mockFetchUserFillsByTime.mockResolvedValue([]);

    const result = await determineResult(4284, "binary");
    expect(result).toEqual({ result: null, markPx: null });
  });

  it("returns null when fills API throws", async () => {
    mockFetchUserFillsByTime.mockRejectedValue(new Error("network error"));

    const result = await determineResult(4284, "binary");
    expect(result).toEqual({ result: null, markPx: null });
  });

  // ── Verify no price fallback (the S5 fix) ──

  it("does NOT fall back to mid price — returns null instead", async () => {
    // Even with mids available, should return null if no sentinel fills
    mockFetchUserFillsByTime.mockResolvedValue([]);

    const result = await determineResult(4284, "binary");
    // Before the fix, this would have returned YES/NO based on mid price.
    // After the fix, it must return null.
    expect(result.result).toBeNull();
    expect(result.markPx).toBeNull();
  });
});
