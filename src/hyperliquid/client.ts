import { getApiUrl } from "../config";
import {
  AllMidsResponse,
  OutcomeMetaResponse,
  UserFill,
  UserStateResponse,
} from "../types";

interface RetryOptions {
  retries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
}

const DEFAULT_RETRIES = 3;
const DEFAULT_BASE_DELAY_MS = 500;
const DEFAULT_MAX_DELAY_MS = 5000;
const DEFAULT_TIMEOUT_MS = 15000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableStatus(status: number): boolean {
  // Retry on rate limits and 5xx server errors
  return status === 429 || (status >= 500 && status < 600);
}

/**
 * POST a JSON payload to the Hyperliquid /info endpoint with retry/backoff.
 */
async function postInfo<T>(
  body: Record<string, unknown>,
  options: RetryOptions = {}
): Promise<T> {
  const url = getApiUrl();
  const retries = options.retries ?? DEFAULT_RETRIES;
  const baseDelay = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const maxDelay = options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;

  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        const text = await response.text().catch(() => "");
        const err = new Error(
          `Hyperliquid API ${body.type} failed: ${response.status} ${response.statusText} ${text}`
        );
        if (attempt < retries && isRetryableStatus(response.status)) {
          lastError = err;
          const delay = Math.min(baseDelay * 2 ** attempt, maxDelay);
          console.warn(
            `[hyperliquid] retry ${attempt + 1}/${retries} after ${delay}ms: ${err.message}`
          );
          await sleep(delay);
          continue;
        }
        throw err;
      }

      return (await response.json()) as T;
    } catch (err) {
      lastError = err;
      const isAbort = (err as Error)?.name === "AbortError";
      const isLastAttempt = attempt >= retries;
      if (isLastAttempt) {
        throw err;
      }
      const delay = Math.min(baseDelay * 2 ** attempt, maxDelay);
      console.warn(
        `[hyperliquid] retry ${attempt + 1}/${retries} after ${delay}ms (${
          isAbort ? "timeout" : (err as Error).message
        })`
      );
      await sleep(delay);
    } finally {
      clearTimeout(timeout);
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Hyperliquid API request failed");
}

/**
 * Fetches all active outcome and question metadata for HIP-4 markets.
 */
export function fetchOutcomeMeta(): Promise<OutcomeMetaResponse> {
  return postInfo<OutcomeMetaResponse>({ type: "outcomeMeta" });
}

/**
 * Fetches all current mid prices keyed by coin (e.g. "@3310" or "BTC").
 */
export function fetchAllMids(): Promise<AllMidsResponse> {
  return postInfo<AllMidsResponse>({ type: "allMids" });
}

/**
 * Fetches the perps clearinghouse state for a user (positions, margin, etc).
 */
export function fetchUserState(user: string): Promise<UserStateResponse> {
  return postInfo<UserStateResponse>({
    type: "clearinghouseState",
    user: user.toLowerCase(),
  });
}

/**
 * Fetches fills for a user within a time range.
 * Used to check settlement fills on the sentinel wallet.
 */
export function fetchUserFillsByTime(
  user: string,
  startTime: number,
  endTime?: number
): Promise<UserFill[]> {
  const body: Record<string, unknown> = {
    type: "userFillsByTime",
    user: user.toLowerCase(),
    startTime,
  };
  if (endTime !== undefined) {
    body.endTime = endTime;
  }
  return postInfo<UserFill[]>(body);
}
