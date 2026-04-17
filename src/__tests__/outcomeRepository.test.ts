/**
 * Tests for outcomeRepository:
 * - Falsy zero fix (?? vs ||)
 * - sentinel_filled column support
 * - getActiveOutcomes filtering
 * - getOutcomesByIds bulk lookup
 */

const mockQuery = jest.fn().mockResolvedValue({ rows: [], rowCount: 0 });

jest.mock("../db/pgClient", () => ({
  query: (...args: unknown[]) => mockQuery(...args),
}));

import {
  insertOutcome,
  updateOutcome,
  getActiveOutcomes,
  getInactiveOutcomes,
  getOutcomesByIds,
} from "../db/outcomeRepository";

beforeEach(() => {
  mockQuery.mockClear();
  mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });
});

describe("insertOutcome", () => {
  it("preserves markPx = 0 (not null)", async () => {
    await insertOutcome({
      id: "@100",
      name: "BTC > 84000",
      startTime: new Date("2026-04-16"),
      marketType: "binary",
      markPx: 0,
    });

    const values = mockQuery.mock.calls[0][1];
    // markPx is the 9th parameter (index 8)
    expect(values[8]).toBe(0);
  });

  it("preserves questionId = 0 (not null)", async () => {
    await insertOutcome({
      id: "@100",
      name: "BTC > 84000",
      startTime: new Date("2026-04-16"),
      marketType: "binary",
      questionId: 0,
    });

    const values = mockQuery.mock.calls[0][1];
    // questionId is the 10th parameter (index 9)
    expect(values[9]).toBe(0);
  });

  it("passes sentinel_filled as 13th parameter (defaults to false)", async () => {
    await insertOutcome({
      id: "@100",
      name: "BTC > 84000",
      startTime: new Date("2026-04-16"),
      marketType: "binary",
    });

    const values = mockQuery.mock.calls[0][1];
    expect(values[12]).toBe(false);
  });

  it("passes sentinel_filled=true when provided", async () => {
    await insertOutcome({
      id: "@100",
      name: "BTC > 84000",
      startTime: new Date("2026-04-16"),
      marketType: "binary",
      sentinelFilled: true,
    });

    const values = mockQuery.mock.calls[0][1];
    expect(values[12]).toBe(true);
  });
});

describe("updateOutcome — sentinelFilled", () => {
  it("includes sentinel_filled in update when provided", async () => {
    mockQuery.mockResolvedValue({ rowCount: 1 });
    await updateOutcome("@100", { sentinelFilled: true });

    const [sql, values] = mockQuery.mock.calls[0];
    expect(sql).toContain("sentinel_filled");
    expect(values).toContain(true);
  });
});

describe("getActiveOutcomes", () => {
  it("filters by sentinel_filled=TRUE by default", async () => {
    await getActiveOutcomes();
    const sql = mockQuery.mock.calls[0][0] as string;
    expect(sql).toContain("sentinel_filled = TRUE");
  });

  it("does not filter by sentinel_filled when sentinelOnly=false", async () => {
    await getActiveOutcomes(false);
    const sql = mockQuery.mock.calls[0][0] as string;
    expect(sql).not.toContain("sentinel_filled = TRUE");
  });
});

describe("getInactiveOutcomes", () => {
  it("queries settled outcomes with sentinel_filled=TRUE", async () => {
    await getInactiveOutcomes();
    const sql = mockQuery.mock.calls[0][0] as string;
    expect(sql).toContain("result IS NOT NULL");
    expect(sql).toContain("sentinel_filled = TRUE");
  });
});

describe("getOutcomesByIds", () => {
  it("passes ids array as parameter with sentinel filter", async () => {
    await getOutcomesByIds(["@100", "@200"]);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("id = ANY($1)");
    expect(sql).toContain("sentinel_filled = TRUE");
    expect(params).toEqual([["@100", "@200"]]);
  });

  it("returns empty array for empty ids", async () => {
    const result = await getOutcomesByIds([]);
    expect(result).toEqual([]);
    expect(mockQuery).not.toHaveBeenCalled();
  });
});
