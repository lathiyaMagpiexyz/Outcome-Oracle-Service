/**
 * Tests for poll() — settlement detection and retry logic.
 */

const mockFetchOutcomeMeta = jest.fn();
const mockFetchAllMids = jest.fn();
const mockFetchUserFillsByTime = jest.fn();
const mockInsertOutcome = jest.fn();
const mockUpdateOutcome = jest.fn().mockResolvedValue(1);
const mockGetActiveOutcomes = jest.fn().mockResolvedValue([]);
const mockGetOutcomeById = jest.fn().mockResolvedValue(null);
const mockBuyForNewOutcome = jest.fn().mockResolvedValue(true);

jest.mock("../config", () => ({
  config: {
    sentinel: { wallet: "0xSENTINEL" },
    polling: { intervalMs: 30000 },
  },
}));
jest.mock("../hyperliquid", () => ({
  fetchOutcomeMeta: (...args: unknown[]) => mockFetchOutcomeMeta(...args),
  fetchAllMids: (...args: unknown[]) => mockFetchAllMids(...args),
  fetchUserFillsByTime: (...args: unknown[]) =>
    mockFetchUserFillsByTime(...args),
}));
jest.mock("../db/outcomeRepository", () => ({
  insertOutcome: (...args: unknown[]) => mockInsertOutcome(...args),
  updateOutcome: (...args: unknown[]) => mockUpdateOutcome(...args),
  getActiveOutcomes: (...args: unknown[]) => mockGetActiveOutcomes(...args),
  getOutcomeById: (...args: unknown[]) => mockGetOutcomeById(...args),
}));
jest.mock("../sentinel", () => ({
  buyForNewOutcome: (...args: unknown[]) => mockBuyForNewOutcome(...args),
}));

// Must import AFTER mocks are set up
import { poll, _testExports } from "../watcher";

beforeEach(() => {
  jest.clearAllMocks();
  _testExports.resetState();
  mockInsertOutcome.mockResolvedValue(undefined);
  mockUpdateOutcome.mockResolvedValue(1);
  mockGetActiveOutcomes.mockResolvedValue([]);
  mockGetOutcomeById.mockResolvedValue(null);
  mockBuyForNewOutcome.mockResolvedValue(true);
  mockFetchUserFillsByTime.mockResolvedValue([]);
});

function makeOutcomeMeta(ids: number[]) {
  return {
    outcomes: ids.map((id) => ({
      outcome: id,
      name: "Recurring",
      description: `class:priceBinary|underlying:BTC|expiry:20260510-0300|targetPrice:${80000 + id}|period:1d`,
      sideSpecs: [],
    })),
    questions: [],
  };
}

function makeMids(ids: number[]) {
  const mids: Record<string, string> = { BTC: "84000" };
  for (const id of ids) {
    mids[`@${id}`] = "0.5";
  }
  return mids;
}

describe("poll — new outcome detection", () => {
  it("inserts new outcomes and calls sentinel buy", async () => {
    mockFetchOutcomeMeta.mockResolvedValue(makeOutcomeMeta([100, 101]));
    mockFetchAllMids.mockResolvedValue(makeMids([100, 101]));

    const result = await poll();
    expect(result.newCount).toBe(2);
    expect(mockInsertOutcome).toHaveBeenCalledTimes(2);
    expect(mockBuyForNewOutcome).toHaveBeenCalledTimes(2);
    // Should mark sentinel_filled=true after successful buy
    expect(mockUpdateOutcome).toHaveBeenCalledWith(
      "@100",
      expect.objectContaining({ sentinelFilled: true })
    );
    expect(mockUpdateOutcome).toHaveBeenCalledWith(
      "@101",
      expect.objectContaining({ sentinelFilled: true })
    );
  });

  it("does not re-insert known outcomes on subsequent polls", async () => {
    // First poll: outcomes 100, 101
    mockFetchOutcomeMeta.mockResolvedValue(makeOutcomeMeta([100, 101]));
    mockFetchAllMids.mockResolvedValue(makeMids([100, 101]));
    await poll();

    mockInsertOutcome.mockClear();
    mockBuyForNewOutcome.mockClear();

    // Second poll: same outcomes
    mockFetchOutcomeMeta.mockResolvedValue(makeOutcomeMeta([100, 101]));
    mockFetchAllMids.mockResolvedValue(makeMids([100, 101]));
    await poll();

    expect(mockInsertOutcome).not.toHaveBeenCalled();
    expect(mockBuyForNewOutcome).not.toHaveBeenCalled();
  });
});

describe("poll — sentinel buy failure tracking", () => {
  it("tracks failed buy and retries on next poll", async () => {
    // First poll: outcome 200 is new, buy always fails
    mockFetchOutcomeMeta.mockResolvedValue(makeOutcomeMeta([200]));
    mockFetchAllMids.mockResolvedValue(makeMids([200]));
    mockBuyForNewOutcome.mockResolvedValue(false);

    await poll();
    // Called for the new outcome + immediate retry in same cycle
    expect(mockBuyForNewOutcome).toHaveBeenCalledTimes(2);

    // Second poll: same outcome still active, retry should fire again
    mockBuyForNewOutcome.mockClear();
    mockBuyForNewOutcome.mockResolvedValue(true);
    mockFetchOutcomeMeta.mockResolvedValue(makeOutcomeMeta([200]));
    mockFetchAllMids.mockResolvedValue(makeMids([200]));

    await poll();
    // Should have retried the failed buy and succeeded
    expect(mockBuyForNewOutcome).toHaveBeenCalledTimes(1);
  });
});

describe("poll — settlement detection", () => {
  it("detects settled outcomes (was known, now gone)", async () => {
    // First poll: outcomes 100, 101
    mockFetchOutcomeMeta.mockResolvedValue(makeOutcomeMeta([100, 101]));
    mockFetchAllMids.mockResolvedValue(makeMids([100, 101]));
    await poll();

    // Second poll: outcome 101 is gone (settled)
    mockFetchOutcomeMeta.mockResolvedValue(makeOutcomeMeta([100]));
    mockFetchAllMids.mockResolvedValue(makeMids([100]));
    mockFetchUserFillsByTime.mockResolvedValue([
      { coin: "@101", px: "1.0", closedPnl: "0", sz: "15" },
    ]);

    const result = await poll();
    expect(result.settledCount).toBe(1);
    expect(mockUpdateOutcome).toHaveBeenCalledWith(
      "@101",
      expect.objectContaining({ result: "YES", markPx: 1 })
    );
  });

  it("returns null result when no sentinel fills for settled outcome", async () => {
    // First poll
    mockFetchOutcomeMeta.mockResolvedValue(makeOutcomeMeta([300]));
    mockFetchAllMids.mockResolvedValue(makeMids([300]));
    await poll();

    // Second poll: 300 is gone, no fills
    mockFetchOutcomeMeta.mockResolvedValue(makeOutcomeMeta([]));
    mockFetchAllMids.mockResolvedValue(makeMids([]));
    mockFetchUserFillsByTime.mockResolvedValue([]);

    const result = await poll();
    expect(result.settledCount).toBe(1);
    expect(mockUpdateOutcome).toHaveBeenCalledWith(
      "@300",
      expect.objectContaining({ result: null, markPx: null })
    );
  });
});
