// ============================================================
// THE FAT LIST: settings you can change
// ============================================================
// PROMOTE: placements booked by the day (US dollars per day).
// ADVERTISE: the banner ad at the top of every Fat List and Hood Talk page.
export const PACKAGES = {
  // Spotlight: 3 card spots at the top. Each spot rotates between up to `perSpot` coins, `rotateSeconds` each. Buyers pick their spot.
  spotlight: { group: "promote",   name: "Spotlight card", perDay: 74, spots: 3, perSpot: 4, rotateSeconds: 10, maxAtOnce: 12,
               blurb: "A big card at the top of the Fat List. Pick spot 1, 2 or 3. Each spot takes turns between up to 4 coins, 10 seconds each." },
  row:       { group: "promote",   name: "Promoted row",   perDay: 24.99,  maxAtOnce: 10, blurb: "Pinned above the Trending list with a lime highlight." },
  banner:    { group: "advertise", name: "Banner ad",      perDay: 199, maxAtOnce: 2,  blurb: "Your coin and a one-line message across the top of every page, including Hood Talk." },
  // A fixed package: one coin at a time gets the whole left side of every Fat List page for 3 days, plus boosts and votes.
  side:      { group: "advertise", name: "Left side banner", fixedUsd: 250, fixedDays: 3, perDay: 250, boosts: 100, votes: 50, maxAtOnce: 1,
               blurb: "Your banner down the whole left side of every Fat List and Hood Talk page for 3 days. Includes 100 boosts and 50 votes." },
};
// BOOST: instant push up the Trending ranking for the pack's hours. Boosts stack.
export const BOOSTS = {
  b10:  { name: "10 boosts",  boosts: 10,  hours: 12, usd: 4.99 },
  b30:  { name: "30 boosts",  boosts: 30,  hours: 24, usd: 9.99 },
  b100: { name: "100 boosts", boosts: 100, hours: 48, usd: 19.99 },
};
export const VERIFY_USD = 49;                  // verified badge check by the team
export const CLAIM_USD = 1.99;                 // claim an auto-listed coin and put your own logo, description and links on it
export const DISCOUNTS = { 1: 0, 3: 0, 7: 0.10, 14: 0.15 };
export const ORDER_MINUTES = 30;               // how long a price quote is valid
export const AUTO_LIST_MIN_LIQUIDITY = 5000;   // submitted coins with at least this much liquidity go live straight away
export const INDEX_MIN_LIQUIDITY = 3000;       // auto-indexed coins show on the board once they reach this much liquidity

// Chains whose new coins are pulled in automatically (DexScreener id: GeckoTerminal network id).
export const INDEX_CHAINS = { robinhood: "robinhood" };

// Where payments can be made. Token addresses checked against public sources Nov 2026.
// The server also reads each token's decimals on-chain.
// Beware copycats: on Robinhood Chain a fake "USDG" exists at 0x3eb2…FE16.
export const PAY_CHAINS = {
  robinhood: {
    name: "Robinhood Chain", chainId: 4663, confirmations: 2,
    rpc: () => process.env.ROBINHOOD_RPC_URL || "https://rpc.mainnet.chain.robinhood.com",
    explorer: "https://robinhoodchain.blockscout.com/tx/",
    tokens: { ETH: null, USDG: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168", USDC: "0x80e0e24718dbFcad49ECAA6F1e6C89A190586cA8" },
  },
  ethereum: {
    name: "Ethereum", chainId: 1, confirmations: 3,
    rpc: () => process.env.ETH_RPC_URL || "https://ethereum-rpc.publicnode.com",
    explorer: "https://etherscan.io/tx/",
    tokens: { ETH: null, USDG: "0xe343167631d89B6Ffc58B88d6b7fB0228795491D", USDT: "0xdAC17F958D2ee523a2206206994597C13D831ec7", USDC: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" },
  },
};

// Chain names (DexScreener chain ids) and the matching GeckoTerminal network ids.
export const CHAIN_NAMES = {
  robinhood: "Robinhood Chain", solana: "Solana", ethereum: "Ethereum", base: "Base", bsc: "BNB Chain",
  arbitrum: "Arbitrum", polygon: "Polygon", avalanche: "Avalanche", sui: "Sui", ton: "TON", tron: "Tron", hyperevm: "HyperEVM",
};
export const GT_NETWORK = { robinhood: "robinhood", solana: "solana", ethereum: "eth", base: "base", bsc: "bsc", arbitrum: "arbitrum",
  polygon: "polygon_pos", avalanche: "avax", sui: "sui-network", ton: "ton", tron: "tron", hyperevm: "hyperevm" };
export const chainName = (c) => CHAIN_NAMES[c] || (c ? c[0].toUpperCase() + c.slice(1) : "");

// ============================================================
// helpers
// ============================================================
import { getStore } from "@netlify/blobs";
export const db = () => getStore({ name: "fatlist", consistency: "strong" });

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", "cache-control": "no-store", ...headers } });
}
export const newId = () => `${Date.now()}-${crypto.randomUUID().replace(/-/g, "").slice(0, 8)}`;
export const ID_RE = /^\d{13}-[a-f0-9]{8}$/;
export const DAY = 86400000;
export const ipOf = (context) => String(context?.ip || "unknown").replace(/[^a-zA-Z0-9.:]/g, "_");

export function isAdmin(req) {
  const want = process.env.ADMIN_PASSWORD || "";
  const got = req.headers.get("x-admin-key") || "";
  if (want.length < 8 || got.length !== want.length) return false;
  let d = 0; for (let i = 0; i < want.length; i++) d |= want.charCodeAt(i) ^ got.charCodeAt(i);
  return d === 0;
}

export async function getJSON(key) { const v = await db().get(key); return v ? JSON.parse(v) : null; }
export async function setJSON(key, val) { await db().set(key, JSON.stringify(val)); }

export function priceFor(pkg, days, test = false) {
  const p = PACKAGES[pkg]; if (!p) return null;
  if (p.fixedDays) return days === p.fixedDays ? (test ? TEST_PRICE_USD : p.fixedUsd) : null;
  if (!(days in DISCOUNTS)) return null;
  if (test) return TEST_PRICE_USD;
  return Math.round(p.perDay * days * (1 - DISCOUNTS[days]) * 100) / 100; // keep cents (e.g. $24.99)
}

// ---------- TEST PRICES: the admin can switch every paid item to $1 for a real end-to-end test.
// Stored server-side (no deploy needed) and switches itself off after TEST_PRICE_HOURS.
export const TEST_PRICE_USD = 1;
export const TEST_PRICE_HOURS = 2;
export async function testPrices() {
  try { const v = await getJSON("settings/test-prices"); return v && v.until > Date.now() ? v : null; } catch { return null; }
}
export async function setTestPrices(on) {
  if (on) await setJSON("settings/test-prices", { at: Date.now(), until: Date.now() + TEST_PRICE_HOURS * 3600000 });
  else await db().delete("settings/test-prices");
  return testPrices(); // read back, so the admin always sees what is really stored
}
// The prices to show and charge right now.
export function prices(test) {
  if (!test) return { packages: PACKAGES, boosts: BOOSTS, verifyUsd: VERIFY_USD, claimUsd: CLAIM_USD, testPrices: false };
  const one = (o, k) => Object.fromEntries(Object.entries(o).map(([id, v]) => [id, { ...v, [k]: TEST_PRICE_USD }]));
  return { packages: one(PACKAGES, "perDay"), boosts: one(BOOSTS, "usd"), verifyUsd: TEST_PRICE_USD, claimUsd: TEST_PRICE_USD, testPrices: true };
}

export const clean = (s, n) => String(s ?? "").replace(/[\u0000-\u0008\u000b-\u001f<>]/g, "").trim().slice(0, n);
export const cleanUrl = (s) => { const u = clean(s, 300); return /^https:\/\/[^\s/]+\.[^\s]+$/.test(u) ? u : ""; };

export function addrOk(a) {
  return /^0x[a-fA-F0-9]{40}$/.test(a) || /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a) ||
    /^0x[a-fA-F0-9]{64}(::\w+::\w+)?$/.test(a) || /^[A-Za-z0-9_-]{48}$/.test(a) || /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(a);
}

export const shortAddr = (a) => `${a.slice(0, 6)}…${a.slice(-4)}`;

// ---------- uploaded logos (sent by the browser already shrunk to 256×256)
export function parseLogo(dataUrl) {
  const m = /^data:image\/(webp|png|jpeg);base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ""));
  if (!m) return null;
  const bytes = Uint8Array.from(atob(m[2]), (c) => c.charCodeAt(0));
  if (bytes.length < 100 || bytes.length > 300000) return null;
  const hex = [...bytes.slice(0, 4)].map((b) => b.toString(16).padStart(2, "0")).join("");
  const isPng = hex === "89504e47", isJpg = hex.startsWith("ffd8ff");
  const isWebp = hex === "52494646" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP";
  const type = isPng ? "png" : isJpg ? "jpeg" : isWebp ? "webp" : null;
  return type ? { type, b64: m[2] } : null;
}
export async function saveLogo(id, logo) {
  await setJSON(`logos/${id}`, { type: logo.type, b64: logo.b64, at: Date.now() });
  return `/api/logo/${id}?v=${Date.now().toString(36)}`;
}
