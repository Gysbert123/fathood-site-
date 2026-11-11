import { sql, hit, toCoin, VISIBLE, LIVE_EXTRAS, liveAds } from "../lib/db.mjs";
import { getSnapshot } from "../lib/market.mjs";
import { lookup } from "../lib/lookup.mjs";
import { parseLogo, saveLogo, json, newId, ID_RE, ipOf, clean, cleanUrl, addrOk, chainName, testPrices, prices,
  CHAIN_NAMES, PAY_CHAINS, DISCOUNTS, AUTO_LIST_MIN_LIQUIDITY, INDEX_MIN_LIQUIDITY } from "../lib/coinlist.mjs";

export const config = { path: "/api/fatlist" };

const settings = async () => ({
  ...prices(await testPrices()), discounts: DISCOUNTS, chains: CHAIN_NAMES,
  payChains: Object.fromEntries(Object.entries(PAY_CHAINS).map(([k, c]) => [k, { name: c.name, chainId: c.chainId, tokens: Object.keys(c.tokens) }])),
  paymentsOn: /^0x[a-fA-F0-9]{40}$/.test(process.env.PAY_WALLET || ""), autoListMin: AUTO_LIST_MIN_LIQUIDITY,
});

async function findExisting(chain, address) {
  const [c] = await sql()`select id, status, source from coins where chain = ${chain} and address_lc = ${address.toLowerCase()}`;
  return c || null;
}
// DexScreener first; if it doesn't know the coin, fall back to a coin we already have (e.g. auto-listed from GeckoTerminal).
async function resolve(address) {
  const d = await lookup(address);
  if (d.found) return d;
  const [r] = await sql()`select chain, address, name, symbol, image, liquidity, pair_address from coins where address_lc = ${address.toLowerCase()}
    and status not in ('rejected', 'removed') order by (status = 'approved') desc limit 1`;
  if (!r) return d;
  return { found: true, fromDb: true, chain: r.chain, address: r.address, name: r.name, symbol: r.symbol, image: r.image || "",
    liquidity: r.liquidity || 0, pairAddress: r.pair_address, description: "", website: "", x: "", telegram: "", discord: "" };
}
async function claimPending(coinId) {
  const [c] = await sql()`select 1 from claims where coin_id = ${coinId} and status = 'pending' limit 1`;
  return !!c;
}

async function submit(b, context) {
  if (!(await hit("list", ipOf(context), 6))) return json({ error: "You’ve added several coins in the last hour. Try again later." }, 429);
  const address = clean(b.address, 90);
  if (!addrOk(address)) return json({ error: "That doesn’t look like a contract address.", fields: { address: "Paste the full contract address." } }, 400);
  const found = await resolve(address);
  const chain = found.found ? found.chain : clean(b.chain, 20);
  const addr = found.address || address;
  const f = {
    name: found.found ? found.name : clean(b.name, 40),
    symbol: (found.found ? found.symbol : clean(b.symbol, 12)).replace(/^\$/, "").toUpperCase(),
    description: clean(b.description, 1000), website: cleanUrl(b.website), x: cleanUrl(b.x), telegram: cleanUrl(b.telegram), discord: cleanUrl(b.discord),
    contact: clean(b.contact, 60),
  };
  const errs = {};
  if (!found.found) {
    if (!CHAIN_NAMES[chain]) errs.chain = "Pick the chain your coin is on.";
    if (f.name.length < 2) errs.name = "Enter the coin’s name.";
    if (!/^[A-Z0-9]{2,12}$/.test(f.symbol)) errs.symbol = "Enter a symbol of 2–12 letters or numbers.";
  }
  if (f.description.length < 30) errs.description = "Describe the coin in at least 30 characters.";
  if (!/^@\w{4,}$/.test(f.contact)) errs.contact = "Enter your Telegram handle, starting with @.";
  for (const k of ["website", "x", "telegram", "discord"]) if (clean(b[k], 300) && !f[k]) errs[k] = "Enter a full link starting with https://";
  let logo = null;
  if (b.logo) { logo = parseLogo(b.logo); if (!logo) errs.logo = "Upload a PNG, JPG or WebP image."; }
  if (Object.keys(errs).length) return json({ error: "Check the highlighted fields.", fields: errs }, 400);

  const existing = CHAIN_NAMES[chain] || found.found ? await findExisting(chain, addr) : null;
  if (existing) {
    // Coins we indexed automatically can be claimed by their team; the Fathood team reviews claims.
    if (existing.status !== "indexed") return json({ error: "That coin is already on the Fat List.", existing: existing.id }, 409);
    if (await claimPending(existing.id)) return json({ error: "Someone already asked to claim this coin. The team is reviewing it.", existing: existing.id }, 409);
    const id = newId();
    const data = { ...f };
    if (logo) data.image = await saveLogo(id, logo);
    await sql()`insert into claims (id, coin_id, data) values (${id}, ${existing.id}, ${sql().json(data)})`;
    return json({ ok: true, id: existing.id, status: "claim" });
  }
  const id = newId();
  const status = found.found && found.liquidity >= AUTO_LIST_MIN_LIQUIDITY ? "approved" : "pending";
  const row = { id, chain, address: addr, ...f, image: found.image || null, status, source: "submitted",
    pair_address: found.pairAddress || null, liquidity_at_listing: found.liquidity || 0, liquidity: found.liquidity || null,
    approved_at: status === "approved" ? new Date() : null };
  if (logo) row.image = await saveLogo(id, logo);
  await sql()`insert into coins ${sql()(row)}`;
  return json({ ok: true, id, status });
}

// One vote per person (by IP) per coin, for good. Voting again does nothing; "unvote" takes it back.
async function vote(b, context) {
  const id = String(b.id || "");
  if (!ID_RE.test(id)) return json({ error: "Unknown coin." }, 400);
  const ip = ipOf(context);
  if (!(await hit("vote", ip, 120))) return json({ error: "Too many votes. Try again later." }, 429);
  if (b.action === "unvote") {
    const del = await sql()`delete from votes where coin_id = ${id} and voter = ${ip} returning 1`;
    const [c] = del.length
      ? await sql()`update coins set votes = greatest(votes - ${del.length}, 0) where id = ${id} returning votes`
      : await sql()`select votes from coins where id = ${id}`;
    if (!c) return json({ error: "Unknown coin." }, 404);
    return json({ ok: true, voted: false, votes: c.votes });
  }
  const ins = await sql()`insert into votes (coin_id, voter, day) select ${id}, ${ip}, 0
    where exists (select 1 from coins c where c.id = ${id} and ${VISIBLE(INDEX_MIN_LIQUIDITY)})
      and not exists (select 1 from votes v where v.coin_id = ${id} and v.voter = ${ip}) on conflict do nothing returning 1`;
  if (!ins.length) {
    const [c] = await sql()`select votes from coins where id = ${id}`;
    if (!c) return json({ error: "Unknown coin." }, 404);
    return json({ ok: true, voted: true, already: true, votes: c.votes });
  }
  const [c] = await sql()`update coins set votes = votes + 1 where id = ${id} returning votes`;
  return json({ ok: true, voted: true, votes: c.votes });
}

export default async (req, context) => {
  try {
    const u = new URL(req.url);
    if (req.method === "GET") {
      if (u.searchParams.has("lookup")) {
        const a = clean(u.searchParams.get("lookup"), 90);
        if (!addrOk(a)) return json({ error: "That doesn’t look like a contract address." }, 400);
        if (!(await hit("lookup", ipOf(context), 40))) return json({ error: "Too many lookups. Try again in a few minutes." }, 429);
        const d = await resolve(a);
        if (d.found) {
          const ex = await findExisting(d.chain, d.address);
          if (ex) { d.existing = ex.id; d.claimable = ex.status === "indexed" && !(await claimPending(ex.id)); d.claimPending = ex.status === "indexed" && !d.claimable; }
        }
        return json({ ...d, chainName: d.found ? chainName(d.chain) : "" });
      }
      if (u.searchParams.has("coin")) {
        const id = u.searchParams.get("coin");
        if (!ID_RE.test(id)) return json({ error: "Unknown coin." }, 400);
        const [r] = await sql()`select c.*, coalesce(b.boosts, 0) as boosts, p.promo from coins c ${LIVE_EXTRAS()} where c.id = ${id}`;
        if (!r || r.status === "rejected" || r.status === "removed") return json({ error: "That coin isn’t on the Fat List." }, 404);
        return json({ coin: { ...toCoin(r), status: r.status, claimPending: r.status === "indexed" && (await claimPending(id)) }, ads: await liveAds(), settings: await settings() });
      }
      if (u.searchParams.has("q")) {
        const q = clean(u.searchParams.get("q"), 90).replace(/^\$/, "");
        if (q.length < 2) return json({ coins: [] });
        const like = `%${q.replace(/[%_\\]/g, "\\$&")}%`;
        const rows = await sql()`select c.*, coalesce(b.boosts, 0) as boosts, p.promo from coins c ${LIVE_EXTRAS()}
          where ${VISIBLE(INDEX_MIN_LIQUIDITY)} and (c.address_lc = ${q.toLowerCase()} or c.symbol ilike ${like} or c.name ilike ${like})
          order by (c.symbol ilike ${q}) desc, c.liquidity desc nulls last limit 40`;
        return json({ coins: rows.map(toCoin) }, 200, { "cache-control": "public, max-age=30" });
      }
      if (u.searchParams.has("mine")) {
        const rows = await sql()`select distinct coin_id from votes where voter = ${ipOf(context)}`;
        return json({ voted: rows.map((r) => r.coin_id) }, 200, { "cache-control": "private, no-store" });
      }
      const s = await getSnapshot();
      // The board snapshot can be a few minutes old; vote counts are read fresh so a vote never seems to vanish.
      const fresh = new Map((await sql()`select id, votes from coins where votes > 0`).map((r) => [r.id, r.votes]));
      s.coins = s.coins.map((c) => ({ ...c, votes: fresh.get(c.id) || 0 }));
      return json({ coins: s.coins, ads: s.ads, total: s.total, settings: await settings() }, 200,
        { "cache-control": "public, max-age=15", "netlify-cdn-cache-control": "public, s-maxage=20, stale-while-revalidate=60" });
    }
    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
    const b = await req.json().catch(() => ({}));
    if (b.action === "submit") return await submit(b, context);
    if (b.action === "vote" || b.action === "unvote") return await vote(b, context);
    return json({ error: "Unknown action." }, 400);
  } catch (e) {
    console.error(e);
    return json({ error: "Something went wrong on our side. Try again in a minute." }, 500);
  }
};
