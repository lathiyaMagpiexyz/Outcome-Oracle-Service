import dotenv from "dotenv";

dotenv.config();

function required(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required env var: ${key}`);
  }
  return value;
}

function optional(key: string, fallback: string): string {
  return process.env[key] || fallback;
}

export const config = {
  postgres: {
    host: required("POSTGRES_HOST"),
    port: parseInt(optional("POSTGRES_PORT", "5432"), 10),
    database: required("POSTGRES_DB"),
    user: required("POSTGRES_USER"),
    password: required("POSTGRES_PASSWORD"),
    ssl: optional("POSTGRES_SSL", "true") === "true",
  },
  sentinel: {
    wallet: required("ORACLE_SENTINEL_WALLET"),
    privateKey: required("ORACLE_SENTINEL_PRIVATE_KEY"),
  },
  hyperliquid: {
    mainnetUrl: optional(
      "HYPERLIQUID_API_URL",
      "https://api.hyperliquid.xyz/info"
    ),
    testnetUrl: optional(
      "HYPERLIQUID_TESTNET_API_URL",
      "https://api.hyperliquid-testnet.xyz/info"
    ),
    mainnetExchangeUrl: "https://api.hyperliquid.xyz/exchange",
    testnetExchangeUrl: "https://api.hyperliquid-testnet.xyz/exchange",
    useTestnet: optional("USE_TESTNET", "true") === "true",
  },
  polling: {
    intervalMs: parseInt(optional("POLL_INTERVAL_MS", "30000"), 10),
  },
};

export function getApiUrl(): string {
  return config.hyperliquid.useTestnet
    ? config.hyperliquid.testnetUrl
    : config.hyperliquid.mainnetUrl;
}

export function getExchangeUrl(): string {
  return config.hyperliquid.useTestnet
    ? config.hyperliquid.testnetExchangeUrl
    : config.hyperliquid.mainnetExchangeUrl;
}
