// Fathood Battlegrounds - burn $FATHOOD to unlock fighters / cosmetics.
//   GET  /api/unlock?id=<unlock id>       -> { unlocked: [item ids], items, chain }
//   POST /api/unlock {id, item, tx}       -> checks the burn on Robinhood Chain, then records the unlock
//
// How a burn is tied to one player: the unlock page sends a normal ERC-20 transfer of $FATHOOD to
// the burn address (0x...dEaD) with the player's 16-byte unlock id added to the end of the
// transaction data. The token ignores the extra bytes; this function reads them back from the
// chain, so nobody can claim someone else's burn. Each transaction can only be used once.
// The unlock id is a hash of the game's secret account id, so it is safe to have it on-chain.
//
// Dollar prices: items with `usd` cost that many dollars of $FATHOOD at the live price. When the
// page loads, the player gets a quote (token amount) that stays the same for 15 minutes; a burn
// made within 30 minutes of the quote only needs that amount, even if the price moved since.
import { getStore } from "@netlify/blobs";
import { ITEMS, CHAIN } from "../lib/unlock-items.mjs";
import { tokenUsd, tokensFor } from "../lib/token-price.mjs";

const QUOTE_KEEP_MS = 15 * 60 * 1000;  // the page shows the same amount for this long
const QUOTE_VALID_MS = 30 * 60 * 1000; // a burn this long after the quote may still use it

const ID_RE = /^[a-f0-9]{32}$/;
const TX_RE = /^0x[a-f0-9]{64}$/;
const TRANSFER_SIG = "0xa9059cbb";
const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", "access-control-allow-origin": "*" },
  });

const store = () => getStore({ name: "fathood-unlocks", consistency: "strong" });

async function rpc(method, params) {
  const r = await fetch(CHAIN.rpc, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const j = await r.json();
  if (j.error) throw new Error(j.error.message || "rpc error");
  return j.result;
}

const pad = (addr) => addr.toLowerCase().replace(/^0x/, "").padStart(64, "0");
const units = (whole) => BigInt(whole) * 10n ** BigInt(CHAIN.decimals);

// Token amount for an item right now (whole tokens), or null if it has no price / price unknown.
async function currentAmount(item, priceUsd) {
  const it = ITEMS[item];
  if (it.usd != null) return priceUsd ? tokensFor(it.usd, priceUsd) : null;
  return it.price ?? null;
}

// Items with the amount this player should burn. Saves a 15-minute quote for usd items.
async function publicItems(id) {
  const s = store();
  const priceUsd = await tokenUsd(s);
  const out = {};
  for (const [k, v] of Object.entries(ITEMS)) {
    let price = await currentAmount(k, priceUsd);
    let until = null;
    if (v.usd != null && id) {
      const q = await s.get(`q/${id}/${k}`, { type: "json" });
      if (q && Date.now() - q.at < QUOTE_KEEP_MS) {
        price = price == null ? q.amount : Math.min(price, q.amount);
        until = q.at + QUOTE_KEEP_MS;
      } else if (price != null) {
        const at = Date.now();
        // keep the previous quote too, so a burn made just before this one replaced it still counts
        await s.setJSON(`q/${id}/${k}`, { amount: price, at, prev: q ? { amount: q.amount, at: q.at } : null });
        until = at + QUOTE_KEEP_MS;
      }
    }
    out[k] = { kind: v.kind, name: v.name, price, usd: v.usd ?? null, until };
  }
  return { items: out, priceUsd };
}

// Smallest amount (whole tokens) a burn made at `blockMs` must have, or null if unknown.
async function requiredAmount(id, item, blockMs) {
  const s = store();
  const it = ITEMS[item];
  if (it.usd == null) return it.price ?? null;
  const opts = [];
  const now = await currentAmount(item, await tokenUsd(s));
  if (now != null) opts.push(now);
  const q = await s.get(`q/${id}/${item}`, { type: "json" });
  for (const x of q ? [q, q.prev] : []) {
    if (x && blockMs - x.at > -120000 && blockMs - x.at < QUOTE_VALID_MS) opts.push(x.amount);
  }
  return opts.length ? Math.min(...opts) : null;
}

async function unlockedFor(id) {
  const rec = await store().get(`id/${id}`, { type: "json" });
  return rec ? rec.items.map((x) => x.item) : [];
}

// Returns null if the burn is good, otherwise a reason a player can read.
async function checkBurn(tx, id, item) {
  const t = await rpc("eth_getTransactionByHash", [tx]);
  if (!t) return { wait: true, why: "Transaction not found yet." };
  const rc = await rpc("eth_getTransactionReceipt", [tx]);
  if (!rc) return { wait: true, why: "Transaction is still confirming." };
  if (rc.status !== "0x1") return { why: "That transaction failed on-chain, so nothing was burned." };
  if (String(t.to || "").toLowerCase() !== CHAIN.token.toLowerCase()) return { why: "That transaction isn't a $FATHOOD transfer." };

  const input = String(t.input || "").toLowerCase();
  // selector (4 bytes) + recipient (32) + amount (32) + unlock id (16)
  if (input.length !== 2 + 8 + 64 + 64 + 32 || !input.startsWith(TRANSFER_SIG)) return { why: "That transaction wasn't made by the unlock page." };
  const to = input.slice(10, 74);
  const amount = BigInt("0x" + input.slice(74, 138));
  const tag = input.slice(138);
  if (to !== pad(CHAIN.burn)) return { why: "Those tokens weren't sent to the burn address." };
  if (tag !== id) return { why: "That burn belongs to a different player." };

  const blk = await rpc("eth_getBlockByNumber", [rc.blockNumber, false]);
  const need = await requiredAmount(id, item, blk ? Number(BigInt(blk.timestamp)) * 1000 : Date.now());
  if (need == null) return { wait: true, why: "Can't read the $FATHOOD price right now. Trying again…" };
  // 1% slack for rounding
  if (amount * 100n < units(need) * 99n) return { why: `That burn was too small for ${ITEMS[item].name} (needs ${need.toLocaleString("en-US")} $FATHOOD).` };

  // the token's own Transfer event must show the burn really happened
  const ok = (rc.logs || []).some(
    (l) =>
      String(l.address).toLowerCase() === CHAIN.token.toLowerCase() &&
      l.topics?.[0] === TRANSFER_TOPIC &&
      String(l.topics?.[2] || "").toLowerCase() === "0x" + pad(CHAIN.burn) &&
      BigInt(l.data) >= amount
  );
  if (!ok) return { why: "Couldn't find the burn in that transaction." };
  return { from: String(t.from).toLowerCase(), amount: amount.toString() };
}

export default async (req) => {
  const url = new URL(req.url);
  if (req.method === "OPTIONS") return json({});
  if (req.method === "GET") {
    const id = String(url.searchParams.get("id") || "").toLowerCase();
    const ok = ID_RE.test(id);
    const { items, priceUsd } = await publicItems(ok ? id : null);
    return json({ unlocked: ok ? await unlockedFor(id) : [], items, priceUsd, chain: CHAIN });
  }
  if (req.method !== "POST") return json({ error: "method" }, 405);

  let b;
  try {
    b = await req.json();
  } catch {
    return json({ error: "bad json" }, 400);
  }
  const id = String(b.id || "").toLowerCase();
  const item = String(b.item || "");
  const tx = String(b.tx || "").toLowerCase();
  if (!ID_RE.test(id)) return json({ error: "Bad player id. Open this page from the game." }, 400);
  if (!ITEMS[item]) return json({ error: "Unknown item." }, 400);
  if (ITEMS[item].price == null && ITEMS[item].usd == null) return json({ error: "This unlock has no price yet." }, 400);
  if (!TX_RE.test(tx)) return json({ error: "Bad transaction hash." }, 400);

  const s = store();
  const used = await s.get(`tx/${tx}`, { type: "json" });
  if (used) {
    if (used.id === id && used.item === item) return json({ ok: true, unlocked: await unlockedFor(id) });
    return json({ error: "That transaction was already used for an unlock." }, 409);
  }

  let res;
  try {
    res = await checkBurn(tx, id, item);
  } catch (e) {
    return json({ error: "Couldn't reach Robinhood Chain. Try again in a minute.", wait: true }, 503);
  }
  if (res.why) return json({ error: res.why, wait: !!res.wait }, res.wait ? 202 : 400);

  const at = new Date().toISOString();
  await s.setJSON(`tx/${tx}`, { id, item, from: res.from, amount: res.amount, at });
  const rec = (await s.get(`id/${id}`, { type: "json" })) || { items: [] };
  if (!rec.items.some((x) => x.item === item)) rec.items.push({ item, tx, at });
  await s.setJSON(`id/${id}`, rec);
  return json({ ok: true, unlocked: rec.items.map((x) => x.item) });
};

export const config = { path: "/api/unlock" };
