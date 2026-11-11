import { sql, toCoin, VISIBLE, LIVE_EXTRAS, liveAds, liveSide } from "./db.mjs";
import { db, cleanUrl, INDEX_MIN_LIQUIDITY, fakeVolume } from "./coinlist.mjs";

const same = (a, b) => String(a || "").toLowerCase() === String(b || "").toLowerCase();

// Refresh prices for the coins that matter most, oldest first. DexScreener allows 300 calls a minute;
// each call covers up to 30 coins. We use at most ~60 calls a run.
export async function refreshMarket({ budgetMs = 22000 } = {}) {
  const t0 = Date.now();
  const main = await sql()`select id, chain, address from coins c where ${VISIBLE(INDEX_MIN_LIQUIDITY)} order by market_at nulls first limit 1500`;
  const tail = await sql()`select id, chain, address from coins where status = 'indexed' and coalesce(liquidity, 0) < ${INDEX_MIN_LIQUIDITY}
    and (market_at is null or market_at < now() - interval '30 minutes') order by market_at nulls first limit 300`;
  const coins = [...main, ...tail];
  const chunks = [];
  const byChain = {};
  for (const c of coins) (byChain[c.chain] ||= []).push(c);
  for (const list of Object.values(byChain)) for (let i = 0; i < list.length; i += 30) chunks.push(list.slice(i, i + 30));

  const updates = [], fakes = [];
  let next = 0;
  async function worker() {
    while (next < chunks.length && Date.now() - t0 < budgetMs) {
      const chunk = chunks[next++];
      try {
        const r = await fetch(`https://api.dexscreener.com/tokens/v1/${chunk[0].chain}/${chunk.map((c) => c.address).join(",")}`, { signal: AbortSignal.timeout(8000) });
        if (r.status === 429) { next = chunks.length; return; }
        const pairs = r.ok ? await r.json() : [];
        for (const c of chunk) {
          const p = (Array.isArray(pairs) ? pairs : []).filter((x) => same(x?.baseToken?.address, c.address))
            .sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0))[0];
          updates.push(p ? [c.id, num(p.priceUsd), num(p.priceChange?.h24), num(p.marketCap || p.fdv), num(p.liquidity?.usd), num(p.volume?.h24),
            p.pairCreatedAt ? new Date(p.pairCreatedAt).toISOString() : null, p.pairAddress || null, p.url || null, cleanUrl(p.info?.imageUrl) || null]
            : [c.id, null, null, null, null, null, null, null, null, null]);
          if (!p) updates[updates.length - 1].push("missing");
          else if (fakeVolume(p.volume?.h24, (p.txns?.h24?.buys || 0) + (p.txns?.h24?.sells || 0))) fakes.push(c.id);
        }
      } catch {}
    }
  }
  await Promise.all(Array.from({ length: 6 }, worker));
  const found = updates.filter((u) => u.length === 10).map((u) => u.map((v) => (v == null ? null : String(v))));
  const missing = updates.filter((u) => u.length === 11).map((u) => u[0]);
  if (found.length) {
    await sql()`update coins set price = u.price::float8, change24 = u.change24::float8, mcap = u.mcap::float8, liquidity = u.liquidity::float8,
        volume24 = u.volume24::float8, pair_created_at = coalesce(u.pca::timestamptz, coins.pair_created_at),
        pair_address = coalesce(u.pair, coins.pair_address), dex_url = coalesce(u.url, coins.dex_url),
        image = case when coins.image like '/api/logo/%' then coins.image else coalesce(u.img, coins.image) end, market_at = now()
      from (values ${sql()(found)}) as u(id, price, change24, mcap, liquidity, volume24, pca, pair, url, img) where coins.id = u.id`;
  }
  if (missing.length) await sql()`update coins set market_at = now() where id in ${sql()(missing)}`;
  // Only auto-listed coins are hidden this way; coins the team approved are left alone.
  if (fakes.length) await sql()`update coins set status = 'rejected' where id in ${sql()(fakes)} and status = 'indexed'`;
  return { checked: coins.length, updated: found.length, missing: missing.length, fake: fakes.length, ms: Date.now() - t0 };
}
const num = (v) => (v == null || v === "" || isNaN(Number(v)) ? null : Number(v));

// The board everybody loads: top coins by trending score, plus top gainers, newest and most voted.
export async function buildSnapshot() {
  const v = sql()`select c.*, coalesce(b.boosts, 0) as boosts, p.promo from coins c ${LIVE_EXTRAS()} where ${VISIBLE(INDEX_MIN_LIQUIDITY)}`;
  const rows = await sql()`with v as (${v})
    (select * from v order by (promo is not null) desc,
       boosts desc,
       (votes * 3 + ln(coalesce(volume24, 0) + 1) * 8.686 + ln(coalesce(liquidity, 0) + 1) * 3.474
        + greatest(0, 2 - extract(epoch from now() - coalesce(pair_created_at, created_at)) / 86400) * 5) desc limit 400)
    union (select * from v order by change24 desc nulls last limit 100)
    union (select * from v order by coalesce(pair_created_at, created_at) desc limit 100)
    union (select * from v order by votes desc limit 100)
    union (select * from v order by mcap desc nulls last limit 150)
    union (select * from v order by volume24 desc nulls last limit 150)
    union (select * from v order by price desc nulls last limit 50)`;
  const [{ n }] = await sql()`select count(*)::int as n from coins c where ${VISIBLE(INDEX_MIN_LIQUIDITY)}`;
  const snap = { at: Date.now(), total: n, coins: rows.map(toCoin), ads: await liveAds(), side: await liveSide() };
  await db().set("snapshot/board", JSON.stringify(snap));
  return snap;
}

export async function getSnapshot(maxAgeMs = 180000) {
  const raw = await db().get("snapshot/board");
  const s = raw ? JSON.parse(raw) : null;
  if (s && Date.now() - s.at < maxAgeMs) return s;
  return buildSnapshot();
}
