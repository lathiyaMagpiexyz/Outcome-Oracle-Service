import { config, getApiUrl } from "./config";
import { startApi } from "./api";
import { testConnection, closePool } from "./db/pgClient";
import { initSentinel, disconnectSentinel } from "./sentinel";
import { startWatcher, stopWatcher } from "./watcher";

async function main() {
  console.log("Outcome Oracle Service");
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

  await initSentinel();
  await startApi();
  startWatcher();

  // Graceful shutdown
  const shutdown = async () => {
    console.log("\nShutting down...");
    stopWatcher();
    disconnectSentinel();
    await closePool();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
