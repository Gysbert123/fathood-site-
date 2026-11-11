import { sql, hit, slotsTaken } from "../lib/db.mjs";
import { db, json, newId, ID_RE, DAY, ipOf, clean, priceFor, prices, testPrices, PACKAGES, PAY_CHAINS, ORDER_MINUTES } from "../lib/coinlist.mjs";

export const config = { path: "/api/fatpay" };
const TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const pad = (a) => "0x" + a.toLowerCase().replace(/^0x/, "").padStart(64, "0");
const LIVE = ["approved", "indexed"];

async function rpc(chain, method, params) {
  const r = await fetch(PAY_CHAINS[chain].rpc(), { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: AbortSignal.timeout(10000) });
  const j = await r.json();
  if (j.error) throw new Error(`${method}: ${j.error.message}`);
  return j.result;
}
async function decimalsOf(chain, token) {
  const key = `cache/decimals/${chain}/${token.toLowerCase()}`;
  const c = await db().get(key); if (c) return Number(c);
  const d = Number(BigInt(await rpc(chain, "eth_call", [{ to: token, data: "0x313ce567" }, "latest"])));
  if (!(d >= 0 && d <= 36)) throw new Error("bad decimals");
  await db().set(key, String(d)); return d;
}
async function ethUsd() {
  try { const r = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd", { signal: AbortSignal.timeout(6000) });
    const p = (await r.json())?.ethereum?.usd; if (p > 0) return p; } catch {}
  const r = await fetch("https://api.coinbase.com/v2/prices/ETH-USD/spot", { signal: AbortSignal.timeout(6000) });
  const p = Number((await r.json())?.data?.amount); if (p > 0) return p;
  throw new Error("no ETH price");
}
function fmtUnits(raw, dec) {
  const s = raw.toString().padStart(dec + 1, "0"), whole = s.slice(0, s.length - dec), frac = s.slice(s.length - dec).replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole;
}
const ms = (d) => (d ? new Date(d).getTime() : null);
const publicOrder = (o) => ({
  id: o.id, kind: o.kind, label: o.label, coin: o.coin_label, usd: Number(o.usd), chain: o.chain, chainId: PAY_CHAINS[o.chain].chainId, token: o.token,
  tokenAddress: o.token_address, amount: o.amount, amountRaw: o.amount_raw, decimals: o.decimals, to: o.pay_to,
  expiresAt: ms(o.expires_at), status: o.status, txHash: o.tx_hash || null, explorer: o.tx_hash ? PAY_CHAINS[o.chain].explorer + o.tx_hash : null,
});

async function quote(b, context) {
  const wallet = process.env.PAY_WALLET || "";
  if (!/^0x[a-fA-F0-9]{40}$/.test(wallet)) return json({ error: "Payments aren’t switched on yet. Message the team on Telegram to book." }, 503);
  if (!(await hit("quote", ipOf(context), 30))) return json({ error: "Too many payment attempts. Try again in an hour." }, 429);
  const chain = String(b.chain || ""), token = String(b.token || ""), pc = PAY_CHAINS[chain];
  if (!pc || !(token in pc.tokens)) return json({ error: "Pick a payment network and coin from the list." }, 400);
  const payer = String(b.payer || "").toLowerCase();
  if (!/^0x[a-f0-9]{40}$/.test(payer)) return json({ error: "Connect your wallet first." }, 400);
  if (!ID_RE.test(String(b.listingId || ""))) return json({ error: "Pick a coin." }, 400);
  const [coin] = await sql()`select id, name, symbol, status, verified, verify_paid from coins where id = ${b.listingId}`;
  if (!coin) return json({ error: "That coin isn’t on the Fat List." }, 404);

  const now = Date.now();
  const test = !!(await testPrices()), P = prices(test);
  const o = { id: newId(), kind: b.kind, coin_id: coin.id, coin_label: `${coin.name} (${coin.symbol})`, chain, token, payer,
    pay_to: wallet.toLowerCase(), expires_at: new Date(now + ORDER_MINUTES * 60000), status: "awaiting" };
  if (b.kind === "verify") {
    if (coin.status === "rejected" || coin.status === "removed") return json({ error: "This coin was taken off the Fat List." }, 409);
    if (coin.verified || coin.verify_paid) return json({ error: "A blue tick check is already paid for this coin." }, 409);
    Object.assign(o, { usd: P.verifyUsd, label: "Blue tick check" });
  } else if (b.kind === "boost") {
    if (!LIVE.includes(coin.status)) return json({ error: "This coin needs to be live on the Fat List before it can be boosted." }, 409);
    const pack = P.boosts[b.pack];
    if (!pack) return json({ error: "Pick a boost pack." }, 400);
    Object.assign(o, { pack: b.pack, boosts: pack.boosts, hours: pack.hours, usd: pack.usd, label: `${pack.name} for ${pack.hours} hours` });
  } else if (b.kind === "promo") {
    if (!LIVE.includes(coin.status)) return json({ error: "This coin needs to be live on the Fat List before it can be promoted." }, 409);
    const days = Number(b.days), usd = priceFor(b.pkg, days, test);
    if (!usd) return json({ error: "Pick a placement and duration." }, 400);
    if (b.pkg === "banner") {
      const t = clean(b.adText, 70);
      if (t.length < 8) return json({ error: "Write a banner message of 8 to 70 characters." }, 400);
      if (/(https?:|www\.|t\.me|\.com\b)/i.test(t)) return json({ error: "Leave links out of the banner message. The ad already links to your coin page." }, 400);
      o.ad_text = t;
    }
    const start = Date.parse(String(b.start || "") + "T00:00:00Z"), today = Math.floor(now / DAY) * DAY;
    if (!(start >= today) || start > today + 90 * DAY) return json({ error: "Pick a start date between today and 90 days from now." }, 400);
    const end = start + days * DAY;
    if (await slotsTaken(b.pkg, start, end) >= PACKAGES[b.pkg].maxAtOnce)
      return json({ error: `All ${PACKAGES[b.pkg].name.toLowerCase()} slots are booked for those dates. Try a later start date.` }, 409);
    Object.assign(o, { pkg: b.pkg, days, start_at: new Date(start), end_at: new Date(end), usd, label: `${PACKAGES[b.pkg].name}, ${days} day${days > 1 ? "s" : ""}` });
  } else return json({ error: "Unknown order type." }, 400);
  if (test) o.label += " (TEST PRICE)";

  const tokenAddr = pc.tokens[token];
  if (tokenAddr) {
    const dec = await decimalsOf(chain, tokenAddr);
    Object.assign(o, { decimals: dec, token_address: tokenAddr.toLowerCase(), amount_raw: (BigInt(Math.round(o.usd * 100)) * 10n ** BigInt(dec) / 100n).toString() });
  } else {
    const p = await ethUsd();
    Object.assign(o, { decimals: 18, token_address: null, eth_price: p, amount_raw: (BigInt(Math.ceil((o.usd / p) * 1e6)) * 10n ** 12n).toString() });
  }
  o.amount = fmtUnits(BigInt(o.amount_raw), o.decimals);
  const [row] = await sql()`insert into orders ${sql()(o)} returning *`;
  return json({ ok: true, order: publicOrder(row) });
}

async function verify(b, context) {
  if (!(await hit("paycheck", ipOf(context), 240))) return json({ error: "Too many payment checks. Wait a few minutes and try again." }, 429);
  if (!ID_RE.test(String(b.orderId || ""))) return json({ error: "Unknown order." }, 400);
  const [o] = await sql()`select * from orders where id = ${b.orderId}`;
  if (!o) return json({ error: "Unknown order." }, 404);
  if (o.status === "paid") return json({ ok: true, paid: true, order: publicOrder(o) });
  const hash = String(b.txHash || "").toLowerCase();
  if (!/^0x[a-f0-9]{64}$/.test(hash)) return json({ error: "That isn’t a valid transaction hash." }, 400);
  const [used] = await sql()`select id from orders where chain = ${o.chain} and tx_hash = ${hash}`;
  if (used && used.id !== o.id) return json({ error: "That transaction was already used for another order." }, 409);

  const receipt = await rpc(o.chain, "eth_getTransactionReceipt", [hash]);
  if (!receipt) return json({ ok: true, paid: false, waiting: "Waiting for the network to include your payment." });
  if (receipt.status !== "0x1") return json({ error: "That transaction failed on-chain, so no payment went through." }, 400);
  const head = Number(BigInt(await rpc(o.chain, "eth_blockNumber", [])));
  const conf = head - Number(BigInt(receipt.blockNumber)) + 1, need = PAY_CHAINS[o.chain].confirmations;
  if (conf < need) return json({ ok: true, paid: false, waiting: `Confirming (${Math.max(conf, 0)} of ${need})…` });
  const [tx, block] = await Promise.all([rpc(o.chain, "eth_getTransactionByHash", [hash]), rpc(o.chain, "eth_getBlockByNumber", [receipt.blockNumber, false])]);
  const ts = Number(BigInt(block.timestamp)) * 1000;
  if (ts < new Date(o.created_at).getTime() - 30000) return json({ error: "That payment was sent before this order was created." }, 400);
  if (ts > new Date(o.expires_at).getTime() + 15 * 60000) return json({ error: "This price quote expired before the payment arrived. Message the team on Telegram with your transaction link." }, 400);
  if (tx.from.toLowerCase() !== o.payer) return json({ error: "That payment came from a different wallet than the one you connected." }, 400);
  const needAmt = BigInt(o.amount_raw);
  if (!o.token_address) {
    if ((tx.to || "").toLowerCase() !== o.pay_to) return json({ error: "That payment wasn’t sent to the Fathood wallet." }, 400);
    if (BigInt(tx.value) < needAmt) return json({ error: `That payment was less than the ${o.amount} ETH quoted.` }, 400);
  } else {
    let got = 0n;
    for (const log of receipt.logs || []) if (log.address.toLowerCase() === o.token_address && log.topics?.[0] === TRANSFER &&
      log.topics[1]?.toLowerCase() === pad(o.payer) && log.topics[2]?.toLowerCase() === pad(o.pay_to)) got += BigInt(log.data);
    if (got === 0n) return json({ error: `No ${o.token} transfer to the Fathood wallet was found in that transaction.` }, 400);
    if (got < needAmt) return json({ error: `That payment was less than the ${o.amount} ${o.token} quoted.` }, 400);
  }
  let row;
  try {
    [row] = await sql()`update orders set status = 'paid', tx_hash = ${hash}, paid_at = now(),
        start_at = case when kind = 'boost' then now() else start_at end,
        end_at = case when kind = 'boost' then now() + make_interval(hours => hours) else end_at end
      where id = ${o.id} and status = 'awaiting' returning *`;
  } catch (e) {
    if (String(e.code) === "23505") return json({ error: "That transaction was already used for another order." }, 409);
    throw e;
  }
  if (!row) [row] = await sql()`select * from orders where id = ${o.id}`;
  if (row.kind === "verify") await sql()`update coins set verify_paid = true where id = ${row.coin_id}`;
  await db().delete("snapshot/board");
  return json({ ok: true, paid: true, order: publicOrder(row) });
}

export default async (req, context) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const b = await req.json().catch(() => ({}));
    if (b.action === "quote") return await quote(b, context);
    if (b.action === "verify") return await verify(b, context);
    return json({ error: "Unknown action." }, 400);
  } catch (e) {
    console.error(e);
    return json({ error: "Couldn’t reach the blockchain just now. Wait a minute and try again; your payment is safe." }, 502);
  }
};
