import express from "express";
import cors from "cors";
import { config } from "../config";
import {
  getActiveOutcomes,
  getInactiveOutcomes,
  getOutcomesByIds,
} from "../db/outcomeRepository";
import { enrichOutcome, toBulkResultItem } from "./enrichment";

const app = express();
app.use(cors());
app.use(express.json());

// GET /oracle/active — enriched active outcomes (sentinel-filled only)
app.get("/oracle/active", async (_req, res) => {
  try {
    const outcomes = await getActiveOutcomes();
    res.json(outcomes.map(enrichOutcome));
  } catch (err) {
    console.error("[api] /oracle/active error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /oracle/inactive — enriched settled outcomes (sentinel-filled only)
app.get("/oracle/inactive", async (_req, res) => {
  try {
    const outcomes = await getInactiveOutcomes();
    res.json(outcomes.map((o) => ({
      ...enrichOutcome(o),
      result: o.result,
      settledAt: o.settledAt ? o.settledAt.toISOString() : null,
    })));
  } catch (err) {
    console.error("[api] /oracle/inactive error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /oracle/results — bulk settlement lookup
app.post("/oracle/results", async (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      res.status(400).json({ error: "Missing or invalid 'ids' array in request body" });
      return;
    }

    // Validate format and cap size
    const validIds = ids
      .filter((id): id is string => typeof id === "string" && /^@\d+$/.test(id))
      .slice(0, 100);

    if (validIds.length === 0) {
      res.status(400).json({ error: "No valid outcome IDs provided (expected format: @{number})" });
      return;
    }

    const outcomes = await getOutcomesByIds(validIds);
    res.json(outcomes.map(toBulkResultItem));
  } catch (err) {
    console.error("[api] /oracle/results error:", err);
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
