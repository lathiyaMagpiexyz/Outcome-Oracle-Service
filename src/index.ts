import { config, getApiUrl } from "./config";
import { testConnection, closePool } from "./db/pgClient";

async function main() {
  console.log("Outcome Oracle Service - Day 1 Setup");
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

  console.log("Day 1 setup verified successfully.");
  await closePool();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
