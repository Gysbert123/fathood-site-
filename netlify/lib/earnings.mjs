// Money in, for the admin's Earnings page:
//  - swap fees: Fathood's share of every Buy/Sell made through LI.FI (from LI.FI's public analytics, per chain)
//  - ad sales: every paid Fat List order (Spotlight, rows, banners, boosts, blue ticks, claims), not the free ones
import { sql } from "./db.mjs";
import { getJSON, setJSON } from "./coinlist.mjs";

const SINCE = Date.UTC(2026, 10, 13) / 1000; // the Buy button went live on 13 Nov 2026
const WINDOW = 89 * 86400;                    // LI.FI allows up to 90 days per request
const CHAIN_OF = { 4663: "robinhood", 1151111081099710: "solana" };

// Fathood's part of one LI.FI swap, in US dollars (at the price when the swap happened)
function ourShare(t) {
  let usd = 0;
  for (const f of t.feeCosts || []) {
    const s = f.feeSplit;
    if (!s) continue;
    const ours = Number(s.integratorFee || 0), all = ours + Number(s.lifiFee || 0);
    if (all > 0) usd += Number(f.amountUSD || 0) * (ours / all);
  }
  return usd;
}

async function swaps() {
  const ck = "cache/earnings-swaps";
  const c = await getJSON(ck).catch(() => null);
  if (c && Date.now() - c.at < 5 * 60000) return c.rows;
  const integrator = process.env.LIFI_INTEGRATOR || "fathood";
  const headers = { accept: "application/json" };
  if (process.env.LIFI_API_KEY) headers["x-lifi-api-key"] = process.env.LIFI_API_KEY;
  const now = Math.floor(Date.now() / 1000), rows = [];
  for (let from = SINCE; from < now; from += WINDOW) {
    const to = Math.min(now, from + WINDOW);
    const r = await fetch(`https://li.quest/v1/analytics/transfers?integrator=${encodeURIComponent(integrator)}&status=DONE&fromTimestamp=${from}&toTimestamp=${to}`,
      { headers, signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error("lifi analytics " + r.status);
    for (const t of (await r.json()).transfers || []) {
      const s = t.sending || {}, rc = t.receiving || {};
      rows.push({
        id: s.txHash || t.transactionId, at: (s.timestamp || 0) * 1000, chain: CHAIN_OF[s.chainId] || String(s.chainId || ""),
        from: s.token?.symbol || "", to: rc.token?.symbol || "", volumeUSD: Number(s.amountUSD || 0), feeUSD: ourShare(t),
        link: s.txLink || t.lifiExplorerLink || null,
      });
    }
  }
  rows.sort((a, b) => b.at - a.at);
  await setJSON(ck, { at: Date.now(), rows }).catch(() => {});
  return rows;
}

const TYPE = (o) => o.kind === "boost" ? "Boosts" : o.kind === "verify" ? "Blue tick" : o.kind === "claim" ? "Claims"
  : o.pkg === "spotlight" ? "Spotlight" : o.pkg === "row" ? "Promoted row" : o.pkg === "banner" ? "Banner ad" : o.pkg === "side" ? "Left side banner" : "Other";

export async function earnings() {
  const [orders, sw] = await Promise.all([
    sql()`select id, kind, pkg, usd, chain, token, label, coin_label, paid_at, tx_hash from orders
      where status = 'paid' and not comped and usd > 0 order by paid_at desc limit 2000`,
    swaps().then((r) => ({ ok: true, rows: r })).catch((e) => ({ ok: false, error: e.message, rows: [] })),
  ]);
  return {
    sales: orders.map((o) => ({ id: o.id, at: new Date(o.paid_at).getTime(), type: TYPE(o), label: o.label, coin: o.coin_label,
      usd: Number(o.usd), chain: o.chain, token: o.token, test: /TEST PRICE/.test(o.label || ""), manual: o.token === "MANUAL" })),
    swaps: sw.rows, swapsOk: sw.ok,
  };
}
