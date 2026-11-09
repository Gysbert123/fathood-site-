// Live $FATHOOD price in USD, from DEX Screener (the pool with the most liquidity).
// Pump guard: uses the LOWEST of the price now, 5 minutes ago and 1 hour ago, so a quick
// price pump can't make an unlock cheap. A dump just means more tokens get burned.
// Cached for 60 s; if DEX Screener is down, the last known price (up to 3 days old) is used.
import { CHAIN } from "./unlock-items.mjs";

const URL = `https://api.dexscreener.com/tokens/v1/robinhood/${CHAIN.token}`;
const FRESH_MS = 60 * 1000;
const STALE_MS = 3 * 24 * 3600 * 1000;

async function fetchPrice() {
  const r = await fetch(URL, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(6000) });
  if (!r.ok) throw new Error("dexscreener " + r.status);
  const pairs = (await r.json()).filter(
    (p) => String(p?.baseToken?.address || "").toLowerCase() === CHAIN.token.toLowerCase() && Number(p.priceUsd) > 0
  );
  if (!pairs.length) throw new Error("no pairs");
  pairs.sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0));
  const p = pairs[0];
  const now = Number(p.priceUsd);
  const back = (chg) => (Number.isFinite(Number(chg)) && Number(chg) > -99 ? now / (1 + Number(chg) / 100) : now);
  return Math.min(now, back(p.priceChange?.m5), back(p.priceChange?.h1));
}

/** USD price of one token, or null if it is unknown. `s` is the blobs store. */
export async function tokenUsd(s) {
  const cached = await s.get("price/now", { type: "json" }).catch(() => null);
  if (cached && Date.now() - cached.at < FRESH_MS) return cached.usd;
  try {
    const usd = await fetchPrice();
    await s.setJSON("price/now", { usd, at: Date.now() });
    return usd;
  } catch {
    return cached && Date.now() - cached.at < STALE_MS ? cached.usd : null;
  }
}

/** Whole tokens to burn for `usd` dollars, rounded UP to a tidy number. */
export function tokensFor(usd, priceUsd) {
  const raw = Math.ceil(usd / priceUsd);
  const step = raw >= 1e6 ? 10000 : raw >= 1e5 ? 1000 : raw >= 1e4 ? 100 : 10;
  return Math.ceil(raw / step) * step;
}
