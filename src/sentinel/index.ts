import { ethers } from "ethers";
import { encode } from "@msgpack/msgpack";
import { config, getExchangeUrl } from "../config";
import { QuestionMetaItem } from "../types";

// ── Constants ──

const OUTCOME_ASSET_OFFSET = 10000; // outcome @N → asset index 10000 + N
const MIN_ORDER_VALUE = 10; // Hyperliquid requires minimum $10 order value
const SLIPPAGE = 0.05; // 5% above mid for IOC fill

const PHANTOM_DOMAIN = {
  name: "Exchange",
  version: "1",
  chainId: 1337,
  verifyingContract: "0x0000000000000000000000000000000000000000",
};

const AGENT_TYPES = {
  Agent: [
    { name: "source", type: "string" },
    { name: "connectionId", type: "bytes32" },
  ],
};

// ── State ──

let wallet: ethers.Wallet | null = null;

// ── Init / Teardown ──

export async function initSentinel(): Promise<void> {
  wallet = new ethers.Wallet(config.sentinel.privateKey);
  console.log(`[sentinel] initialized (wallet=${wallet.address})`);
}

function getWallet(): ethers.Wallet {
  if (!wallet) throw new Error("Sentinel not initialized");
  return wallet;
}

export function disconnectSentinel(): void {
  wallet = null;
  console.log("[sentinel] disconnected");
}

// ── Helpers ──

function stripTrailingZeros(s: string): string {
  if (!s.includes(".")) return s;
  let result = s.replace(/0+$/, "").replace(/\.$/, "");
  if (result === "-0") result = "0";
  return result;
}

function floatToWire(x: number): string {
  // Round to 5 significant figures, max 6 decimals
  const rounded = parseFloat(x.toPrecision(5));
  return stripTrailingZeros(rounded.toFixed(6));
}

function outcomeToAssetIndex(outcomeId: number): number {
  return OUTCOME_ASSET_OFFSET + outcomeId;
}

function outcomeCoin(outcomeId: number): string {
  return `@${outcomeId}`;
}

// ── EIP-712 signing (phantom agent pattern) ──

function normalizeAction(obj: unknown): unknown {
  if (obj === null || obj === undefined || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map(normalizeAction);
  const result: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(obj as Record<string, unknown>)) {
    if ((key === "p" || key === "s") && typeof val === "string") {
      result[key] = stripTrailingZeros(val);
    } else if (typeof val === "object") {
      result[key] = normalizeAction(val);
    } else {
      result[key] = val;
    }
  }
  return result;
}

function actionHash(
  action: unknown,
  vaultAddress: string | null,
  nonce: number
): string {
  const msgPackBytes = encode(normalizeAction(action));
  const extraLen = vaultAddress === null ? 9 : 29;
  const data = new Uint8Array(msgPackBytes.length + extraLen);
  data.set(msgPackBytes);
  const view = new DataView(data.buffer);
  view.setBigUint64(msgPackBytes.length, BigInt(nonce), false);
  if (vaultAddress === null) {
    view.setUint8(msgPackBytes.length + 8, 0);
  } else {
    view.setUint8(msgPackBytes.length + 8, 1);
    data.set(ethers.getBytes(vaultAddress), msgPackBytes.length + 9);
  }
  return ethers.keccak256(data);
}

async function signL1Action(
  action: unknown,
  nonce: number
): Promise<{ r: string; s: string; v: number }> {
  const w = getWallet();
  const hash = actionHash(action, null, nonce);
  const isMainnet = !config.hyperliquid.useTestnet;
  const phantomAgent = {
    source: isMainnet ? "a" : "b",
    connectionId: hash,
  };
  const sig = await w.signTypedData(PHANTOM_DOMAIN, AGENT_TYPES, phantomAgent);
  const { r, s, v } = ethers.Signature.from(sig);
  return { r, s, v };
}

// ── Exchange POST ──

async function postExchange(action: unknown): Promise<Record<string, unknown>> {
  const nonce = Date.now();
  const signature = await signL1Action(action, nonce);

  const resp = await fetch(getExchangeUrl(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, nonce, signature, vaultAddress: null }),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`Exchange API failed: ${resp.status} ${text}`);
  }
  return (await resp.json()) as Record<string, unknown>;
}

// ── Order placement ──

async function buyOneContract(
  outcomeId: number,
  mids: Record<string, string>
): Promise<boolean> {
  const coin = outcomeCoin(outcomeId);
  const midStr = mids[coin];

  if (!midStr) {
    console.warn(`[sentinel] no mid price for ${coin}, skipping buy`);
    return false;
  }

  const midPx = parseFloat(midStr);
  const limitPx = midPx * (1 + SLIPPAGE);

  // Calculate size to meet minimum $10 order value, with buffer
  const minSize = Math.ceil((MIN_ORDER_VALUE * 1.5) / limitPx);
  const buySize = String(Math.max(minSize, 15));

  const assetIdx = outcomeToAssetIndex(outcomeId);

  try {
    const orderWire = {
      a: assetIdx,
      b: true,
      p: floatToWire(limitPx),
      s: buySize,
      r: false,
      t: { limit: { tif: "Ioc" as const } },
    };

    const action = {
      type: "order",
      orders: [orderWire],
      grouping: "na",
    };

    const result = await postExchange(action);
    const response = result.response as Record<string, unknown> | undefined;
    const data = response?.data as Record<string, unknown> | undefined;
    const statuses = data?.statuses as Array<Record<string, unknown>> | undefined;
    const status = statuses?.[0];

    if (status?.filled) {
      const filled = status.filled as { avgPx: string; totalSz: string };
      console.log(
        `[sentinel] bought ${coin} @ ${filled.avgPx} (sz=${filled.totalSz})`
      );
      return true;
    } else if (status?.resting) {
      const resting = status.resting as { oid: number };
      console.log(
        `[sentinel] order resting for ${coin} (oid=${resting.oid})`
      );
      return true;
    } else if (status?.error) {
      console.warn(`[sentinel] buy ${coin} rejected: ${status.error}`);
      return false;
    } else {
      console.warn(
        `[sentinel] buy ${coin} status:`,
        JSON.stringify(result).slice(0, 200)
      );
      return false;
    }
  } catch (err) {
    console.error(
      `[sentinel] failed to buy ${coin}:`,
      (err as Error).message
    );
    return false;
  }
}

// ── Public API ──

export async function buyForNewOutcome(
  outcomeId: number,
  mids: Record<string, string>
): Promise<void> {
  await buyOneContract(outcomeId, mids);
}

export async function buyForNewQuestion(
  question: QuestionMetaItem,
  mids: Record<string, string>
): Promise<void> {
  for (const outcomeId of question.namedOutcomes) {
    await buyOneContract(outcomeId, mids);
  }
}
