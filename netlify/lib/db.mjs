import postgres from "postgres";
import { DAY } from "./coinlist.mjs";

let client;
export function sql() {
  if (!client) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    client = postgres(url, {
      prepare: false,                      // required by Supabase's connection pooler
      max: 3, idle_timeout: 20, connect_timeout: 10,
      ssl: /localhost|127\.0\.0\.1/.test(url) ? false : "require",
    });
  }
  return client;
}

// Rate limit: true if this is within `max` hits for the window.
export async function hit(bucket, who, max, windowMs = 3600000) {
  const w = Math.floor(Date.now() / windowMs);
  const [r] = await sql()`insert into rate (key, n, until) values (${`${bucket}/${w}/${who}`}, 1, ${new Date((w + 1) * windowMs)})
    on conflict (key) do update set n = rate.n + 1 returning n`;
  return r.n <= max;
}

const num = (v) => (v == null ? null : Number(v));
const ms = (d) => (d ? new Date(d).getTime() : null);

// Database row -> what the browser sees
export function toCoin(r) {
  return {
    id: r.id, name: r.name, symbol: r.symbol, chain: r.chain, address: r.address, image: r.image || null,
    website: r.website || "", x: r.x || "", telegram: r.telegram || "", discord: r.discord || "", description: r.description || "",
    launchedAt: ms(r.created_at), votes: r.votes || 0, verified: !!r.verified, unclaimed: r.status === "indexed",
    price: num(r.price), change: num(r.change24), mcap: num(r.mcap), liquidity: num(r.liquidity), volume: num(r.volume24),
    pairCreatedAt: ms(r.pair_created_at), pairAddress: r.pair_address || null, url: r.dex_url || null,
    promo: r.promo || null, boosts: Number(r.boosts || 0),
  };
}

export const VISIBLE = (min) => sql()`(c.status = 'approved' or (c.status = 'indexed' and coalesce(c.liquidity, 0) >= ${min}))`;

// Live boosts and promotions joined onto coins
export const LIVE_EXTRAS = () => sql()`
  left join (select coin_id, sum(boosts) as boosts from orders
             where (kind = 'boost' or (kind = 'promo' and pkg = 'side')) and status = 'paid' and not pulled and start_at <= now() and end_at > now() group by coin_id) b on b.coin_id = c.id
  left join (select coin_id, case when bool_or(pkg = 'spotlight') then 'spotlight' else 'row' end as promo from orders
             where kind = 'promo' and pkg in ('spotlight', 'row') and status = 'paid' and not pulled and start_at <= now() and end_at > now() group by coin_id) p on p.coin_id = c.id`;

export async function liveAds() {
  return (await sql()`select o.coin_id, o.ad_text, c.name, c.symbol, c.image from orders o join coins c on c.id = o.coin_id
    where o.kind = 'promo' and o.pkg = 'banner' and o.status = 'paid' and not o.pulled and o.start_at <= now() and o.end_at > now()
      and c.status in ('approved', 'indexed') order by o.paid_at`)
    .map((r) => ({ coinId: r.coin_id, text: r.ad_text, name: r.name, symbol: r.symbol, image: r.image }));
}

// The left side banner that's running right now (one at a time). ad_image is read through to_jsonb so this works
// even before the column exists.
export async function liveSide() {
  const [r] = await sql()`select o.coin_id, o.ad_text, to_jsonb(o) ->> 'ad_image' as ad_image, c.name, c.symbol, c.image, c.price, c.change24
    from orders o join coins c on c.id = o.coin_id
    where o.kind = 'promo' and o.pkg = 'side' and o.status = 'paid' and not o.pulled and o.start_at <= now() and o.end_at > now()
      and c.status in ('approved', 'indexed') order by o.paid_at limit 1`;
  return r ? { coinId: r.coin_id, text: r.ad_text || "", image: r.ad_image || null, name: r.name, symbol: r.symbol, logo: r.image,
    price: r.price == null ? null : Number(r.price), change: r.change24 == null ? null : Number(r.change24) } : null;
}

export async function slotsTaken(pkg, start, end) {
  const [r] = await sql()`select count(*)::int as n from orders where kind = 'promo' and pkg = ${pkg} and not pulled
    and start_at < ${new Date(end)} and end_at > ${new Date(start)}
    and (status = 'paid' or (status = 'awaiting' and expires_at > now()))`;
  return r.n;
}

export async function sessionOf(req) {
  const m = /^Bearer ([a-f0-9]{64})$/.exec(req.headers.get("authorization") || "");
  if (!m) return null;
  const [s] = await sql()`select s.address, u.name, u.banned from sessions s left join users u on u.address = s.address
    where s.token = ${m[1]} and s.exp > now()`;
  if (!s || s.banned) return null;
  return { token: m[1], address: s.address, name: s.name || "" };
}

export const dayNumber = () => Math.floor(Date.now() / DAY);
