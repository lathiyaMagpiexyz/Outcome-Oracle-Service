import { config, getApiUrl } from "./config";
import { testConnection, closePool } from "./db/pgClient";
import {
  fetchOutcomeMeta,
  fetchAllMids,
  fetchUserState,
} from "./hyperliquid";

async function main() {
  console.log("Outcome Oracle Service - Smoke Test");
  console.log("------------------------------------");
  console.log("Network:", config.hyperliquid.useTestnet ? "TESTNET" : "MAINNET");
  console.log("API URL:", getApiUrl());
  console.log("Poll interval:", config.polling.intervalMs, "ms");
  console.log("Sentinel wallet:", config.sentinel.wallet);
  console.log("------------------------------------");

  const ok = await testConnection();
  if (!ok) {
    console.error("Database connection failed. Check your .env file.");
    process.exit(1);
  }

  try {
    const meta = await fetchOutcomeMeta();
    console.log(
      `outcomeMeta: ${meta.outcomes?.length ?? 0} outcomes, ${meta.questions?.length ?? 0} questions`
    );

    const mids = await fetchAllMids();
    const midKeys = Object.keys(mids);
    console.log(`allMids: ${midKeys.length} symbols (sample: ${midKeys.slice(0, 3).join(", ")})`);

    const state = await fetchUserState(config.sentinel.wallet);
    console.log(
      `clearinghouseState: ${state.assetPositions?.length ?? 0} positions, accountValue=${state.marginSummary?.accountValue}`
    );
  } catch (err) {
    console.error("Hyperliquid API smoke test failed:", err);
  }

  await closePool();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
