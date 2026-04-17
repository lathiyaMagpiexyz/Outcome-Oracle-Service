/**
 * Tests for outcomeRepository:
 * - Falsy zero fix (?? vs ||)
 * - Parameterized SQL in getHistoryByDays
 *
 * These tests mock the pg query function to inspect SQL and params.
 */

const mockQuery = jest.fn().mockResolvedValue({ rows: [], rowCount: 0 });

jest.mock("../db/pgClient", () => ({
  query: (...args: unknown[]) => mockQuery(...args),
}));

import { insertOutcome, getHistoryByDays } from "../db/outcomeRepository";

beforeEach(() => {
  mockQuery.mockClear();
  mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });
});

describe("insertOutcome — falsy zero fix", () => {
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

  it("converts undefined markPx to null", async () => {
    await insertOutcome({
      id: "@100",
      name: "BTC > 84000",
      startTime: new Date("2026-04-16"),
      marketType: "binary",
      // markPx not provided → undefined
    });

    const values = mockQuery.mock.calls[0][1];
    expect(values[8]).toBeNull();
  });

  it("converts undefined questionId to null", async () => {
    await insertOutcome({
      id: "@100",
      name: "BTC > 84000",
      startTime: new Date("2026-04-16"),
      marketType: "binary",
      // questionId not provided → undefined
    });

    const values = mockQuery.mock.calls[0][1];
    expect(values[9]).toBeNull();
  });
});

describe("getHistoryByDays — parameterized query", () => {
  it("uses parameterized query instead of string interpolation", async () => {
    await getHistoryByDays(7);

    const [sql, params] = mockQuery.mock.calls[0];
    // SQL should contain $1 parameter placeholder, not interpolated value
    expect(sql).toContain("$1");
    expect(sql).not.toMatch(/INTERVAL '\d+ days'/);
    expect(params).toEqual([7]);
  });

  it("caps days at 20", async () => {
    await getHistoryByDays(100);

    const [, params] = mockQuery.mock.calls[0];
    expect(params).toEqual([20]);
  });

  it("passes through days <= 20 as-is", async () => {
    await getHistoryByDays(5);

    const [, params] = mockQuery.mock.calls[0];
    expect(params).toEqual([5]);
  });
});
