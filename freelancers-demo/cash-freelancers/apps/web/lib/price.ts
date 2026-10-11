/**
 * BCH spot price, used only for the "≈ $47.50" courtesy line the reference
 * design shows next to a BCH amount.
 *
 * Deliberately fail-soft: a price is a nicety, and a marketplace must not show
 * a stale or missing price as if it were a real one. Every failure path returns
 * `null` and the UI omits the fiat line entirely rather than rendering
 * something wrong.
 */

const COINGECKO_URL = "https://api.coingecko.com/api/v3/simple/price";
const CACHE_TTL_MS = 10 * 60 * 1000;
const TIMEOUT_MS = 4000;

let cached: { price: number; at: number } | null = null;
let inFlight: Promise<number | null> | null = null;

async function fetchOnce(): Promise<number | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const url = `${COINGECKO_URL}?ids=bitcoin-cash&vs_currencies=usd`;
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) return null;
    const body = (await response.json()) as { "bitcoin-cash"?: { usd?: number } };
    const price = body["bitcoin-cash"]?.usd;
    return typeof price === "number" && Number.isFinite(price) ? price : null;
  } catch {
    // Offline, rate-limited, blocked by an ad blocker, aborted on timeout: all
    // equally "no price to show".
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function getBchUsdPrice(): Promise<number | null> {
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.price;
  // Collapse concurrent callers onto one request rather than letting every
  // component that mounts at once fire its own.
  inFlight ??= fetchOnce().then((price) => {
    if (price !== null) cached = { price, at: Date.now() };
    inFlight = null;
    return price;
  });
  return inFlight;
}

/** Convenience for the common `sats → usd` case; null when the price is unknown. */
export async function satsToUsd(sats: number): Promise<number | null> {
  const price = await getBchUsdPrice();
  if (price === null) return null;
  return (sats / 1e8) * price;
}
