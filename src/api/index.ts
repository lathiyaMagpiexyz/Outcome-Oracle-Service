import express from "express";
import { config } from "../config";
import {
  getTodayOutcomes,
  getActiveOutcomes,
  getOutcomeById,
  getHistoryByDays,
} from "../db/outcomeRepository";

const app = express();
app.use(express.json());

// GET /oracle/today
app.get("/oracle/today", async (_req, res) => {
  try {
    const outcomes = await getTodayOutcomes();
    res.json(
      outcomes.map((o) => ({
        id: o.id,
        name: o.name,
        startTime: o.startTime,
        expiry: o.expiry,
      }))
    );
  } catch (err) {
    console.error("[api] /oracle/today error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /oracle/active
app.get("/oracle/active", async (_req, res) => {
  try {
    const outcomes = await getActiveOutcomes();
    res.json(
      outcomes.map((o) => ({
        id: o.id,
        name: o.name,
        startTime: o.startTime,
        expiry: o.expiry,
      }))
    );
  } catch (err) {
    console.error("[api] /oracle/active error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /oracle/result
app.post("/oracle/result", async (req, res) => {
  try {
    const { id } = req.body;
    if (!id || typeof id !== "string") {
      res.status(400).json({ error: "Missing or invalid 'id' in request body" });
      return;
    }

    const outcome = await getOutcomeById(id);
    if (!outcome) {
      res.status(404).json({ error: `Outcome ${id} not found` });
      return;
    }

    res.json({
      id: outcome.id,
      result: outcome.result,
      settledAt: outcome.settledAt,
      markPx: outcome.markPx,
    });
  } catch (err) {
    console.error("[api] /oracle/result error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /oracle/history
app.post("/oracle/history", async (req, res) => {
  try {
    const { days } = req.body;
    if (!days || typeof days !== "number" || days < 1) {
      res.status(400).json({ error: "Missing or invalid 'days' in request body (1-20)" });
      return;
    }

    const outcomes = await getHistoryByDays(days);
    res.json(
      outcomes.map((o) => ({
        id: o.id,
        name: o.name,
        startTime: o.startTime,
        expiry: o.expiry,
        result: o.result,
        settledAt: o.settledAt,
      }))
    );
  } catch (err) {
    console.error("[api] /oracle/history error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export function startApi(): Promise<void> {
  return new Promise((resolve) => {
    app.listen(config.api.port, () => {
      console.log(`[api] listening on port ${config.api.port}`);
      resolve();
    });
  });
}

export { app };
