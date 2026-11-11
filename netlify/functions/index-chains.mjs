// Runs every 30 minutes (kept slow to save Netlify credits): pulls brand-new and trending coins on the chains in INDEX_CHAINS from GeckoTerminal,
// so the Fat List has every coin, not only the ones people add. Also tidies up old rows.
import { sql } from "../lib/db.mjs";
import { INDEX_CHAINS, newId, clean, cleanUrl } from "../lib/coinlist.mjs";

export const config = { schedule: "*/30 * * * *" };
const QUOTES = new Set(["WETH", "ETH", "USDG", "USDC", "USDT", "SYRUPUSDG", "DAI"]);
const n = (v) => (v == null || v === "" || isNaN(Number(v)) ? null : Number(v));

export async function indexChain(chain, network, pages) {
  const rows = [];
  for (const path of pages) {
    try {
      const r = await fetch(`https://api.geckoterminal.com/api/v2/networks/${network}/${path}`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(8000) });
      if (!r.ok) continue;
      const j = await r.json();
      const tokens = Object.fromEntries((j.included || []).filter((t) => t.type === "token").map((t) => [t.id, t.attributes || {}]));
      for (const p of j.data || []) {
        const a = p.attributes || {};
        const t = tokens[p.relationships?.base_token?.data?.id] || {};
        const address = clean(t.address, 90);
        const symbol = clean(t.symbol, 12).replace(/^\$/, "");
        if (!/^0x[a-fA-F0-9]{40}$/.test(address) || !symbol || QUOTES.has(symbol.toUpperCase())) continue;
        const img = cleanUrl(t.image_url);
        rows.push({
          id: newId(), chain, address, name: clean(t.name, 40) || symbol, symbol: symbol.toUpperCase(),
          image: img && !/missing/i.test(img) ? img : null, status: "indexed", source: "indexed",
          pair_address: clean(a.address, 90) || null, price: n(a.base_token_price_usd), mcap: n(a.market_cap_usd) ?? n(a.fdv_usd),
          liquidity: n(a.reserve_in_usd), volume24: n(a.volume_usd?.h24), change24: n(a.price_change_percentage?.h24),
          pair_created_at: a.pool_created_at ? new Date(a.pool_created_at) : null, market_at: new Date(),
        });
      }
    } catch (e) { console.error("index", network, path, e.message); }
  }
  const seen = new Set(), uniq = rows.filter((r) => !seen.has(r.address.toLowerCase()) && seen.add(r.address.toLowerCase()));
  if (!uniq.length) return 0;
  const cols = ["id", "chain", "address", "name", "symbol", "image", "status", "source", "pair_address", "price", "mcap", "liquidity", "volume24", "change24", "pair_created_at", "market_at"];
  const res = await sql()`insert into coins ${sql()(uniq, cols)}
    on conflict (chain, address_lc) do update set
      image = coalesce(coins.image, excluded.image), pair_address = coalesce(coins.pair_address, excluded.pair_address),
      liquidity = case when coins.market_at is null or coins.market_at < now() - interval '2 minutes' then excluded.liquidity else coins.liquidity end
    returning (xmax = 0) as inserted`;
  return res.filter((r) => r.inserted).length;
}

export default async () => {
  const minute = new Date().getUTCMinutes();
  for (const [chain, network] of Object.entries(INDEX_CHAINS)) {
    const pages = ["new_pools?page=1&include=base_token", "new_pools?page=2&include=base_token", "new_pools?page=3&include=base_token"];
    if (minute % 10 === 0) pages.push("trending_pools?page=1&include=base_token");
    try { console.log("indexed", chain, await indexChain(chain, network, pages)); } catch (e) { console.error("index failed", chain, e); }
  }
  try {
    await sql()`delete from rate where until < now() - interval '1 hour'`;
    await sql()`delete from nonces where exp < now()`;
    await sql()`delete from sessions where exp < now()`;
    await sql()`delete from orders where status = 'awaiting' and expires_at < now() - interval '1 day'`;
  } catch (e) { console.error("cleanup failed", e); }
  return new Response("ok");
};
