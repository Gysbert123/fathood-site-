import { sql } from "../lib/db.mjs";
import { lookup } from "../lib/lookup.mjs";
import { parseLogo, saveLogo, testPrices, setTestPrices, TEST_PRICE_HOURS, db, json, newId, ID_RE, DAY, ipOf, isAdmin, clean, cleanUrl, addrOk, CHAIN_NAMES, PACKAGES, BOOSTS, PAY_CHAINS } from "../lib/coinlist.mjs";
import { slotsTaken } from "../lib/db.mjs";

export const config = { path: "/api/fatlist-admin" };
const ms = (d) => (d ? new Date(d).getTime() : null);
const listing = (r) => ({ id: r.id, name: r.name, symbol: r.symbol, chain: r.chain, address: r.address, image: r.image, description: r.description,
  website: r.website, x: r.x, telegram: r.telegram, discord: r.discord, contact: r.contact, status: r.status, source: r.source,
  verified: r.verified, verifyPaid: r.verify_paid, createdAt: ms(r.created_at), liquidityAtListing: r.liquidity_at_listing, liquidity: r.liquidity });
const order = (o) => ({ id: o.id, kind: o.kind, pkg: o.pkg, label: o.label, coin: o.coin_label, usd: Number(o.usd), start: ms(o.start_at), end: ms(o.end_at),
  adText: o.ad_text, amount: o.amount, token: o.token, chain: o.chain, payer: o.payer, paidAt: ms(o.paid_at), comped: o.comped, pulled: o.pulled,
  explorer: o.tx_hash ? PAY_CHAINS[o.chain].explorer + o.tx_hash : null, live: !o.pulled && ms(o.start_at) <= Date.now() && ms(o.end_at) > Date.now() });
const bust = () => db().delete("snapshot/board");

export default async (req, context) => {
  if (!process.env.DATABASE_URL) return json({ error: "The Fat List database isn’t connected yet. Add DATABASE_URL in Netlify.", noDb: true }, 503);
  const w = Math.floor(Date.now() / 3600000), failKey = `adminfail/${w}/${ipOf(context)}`;
  const [f] = await sql()`select n from rate where key = ${failKey}`;
  if (f && f.n >= 10) return json({ error: "Too many wrong passwords. Try again in an hour." }, 429);
  if (!isAdmin(req)) {
    await sql()`insert into rate (key, n, until) values (${failKey}, 1, ${new Date((w + 1) * 3600000)}) on conflict (key) do update set n = rate.n + 1`;
    return json({ error: "Wrong password." }, 401);
  }
  try {
    if (req.method === "GET") {
      const q = clean(new URL(req.url).searchParams.get("q"), 90).replace(/^\$/, "");
      const like = `%${q.replace(/[%_\\]/g, "\\$&")}%`;
      const [pending, live, claims, orders, posts, [stats]] = await Promise.all([
        sql()`select * from coins where status = 'pending' or (verify_paid and not verified and status not in ('rejected', 'removed')) order by verify_paid desc, created_at desc limit 300`,
        q ? sql()`select * from coins where status in ('approved', 'indexed') and (address_lc = ${q.toLowerCase()} or symbol ilike ${like} or name ilike ${like}) order by liquidity desc nulls last limit 100`
          : sql()`select * from coins where status = 'approved' order by coalesce(approved_at, created_at) desc limit 200`,
        sql()`select cl.*, c.name as coin_name, c.symbol as coin_symbol, c.chain, c.address, c.image as coin_image, c.liquidity from claims cl join coins c on c.id = cl.coin_id where cl.status = 'pending' order by cl.created_at`,
        sql()`select * from orders where status = 'paid' order by paid_at desc limit 300`,
        sql()`select id, title, author, reports, removed, created_at, disclosure, left(body, 300) as excerpt from posts order by reports desc, created_at desc limit 150`,
        sql()`select (select count(*) from coins where status = 'approved')::int as approved, (select count(*) from coins where status = 'indexed')::int as indexed,
               (select coalesce(sum(usd), 0) from orders where status = 'paid' and not comped and paid_at > now() - interval '30 days')::float as revenue30`,
      ]);
      const tp = await testPrices();
      return json({
        testPrices: tp ? { on: true, until: tp.until } : { on: false }, testHours: TEST_PRICE_HOURS,
        listings: [...pending, ...live].map(listing), stats,
        claims: claims.map((c) => ({ id: c.id, coinId: c.coin_id, name: c.coin_name, symbol: c.coin_symbol, chain: c.chain, address: c.address, liquidity: c.liquidity, image: c.coin_image, data: c.data, createdAt: ms(c.created_at) })),
        orders: orders.map(order),
        posts: posts.map((p) => ({ id: p.id, title: p.title, author: p.author, reports: p.reports, removed: p.removed, createdAt: ms(p.created_at), disclosure: p.disclosure, excerpt: p.excerpt })),
      });
    }
    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
    const b = await req.json().catch(() => ({}));
    const id = String(b.id || "");

    if (b.action === "testPrices") {
      const v = await setTestPrices(!!b.on);
      return json({ ok: true, testPrices: v ? { on: true, until: v.until } : { on: false } });
    }
    if (b.action === "lookup") {
      const a = clean(b.address, 90);
      if (!addrOk(a)) return json({ error: "That doesn’t look like a contract address." }, 400);
      const d = await lookup(a);
      if (d.found) { const [ex] = await sql()`select id from coins where chain = ${d.chain} and address_lc = ${d.address.toLowerCase()}`; if (ex) d.existing = ex.id; }
      return json(d);
    }
    if (b.action === "addCoin") {
      const address = clean(b.address, 90);
      if (!addrOk(address)) return json({ error: "That doesn’t look like a contract address." }, 400);
      const found = await lookup(address);
      const chain = clean(b.chain, 20) || found.chain;
      if (!CHAIN_NAMES[chain]) return json({ error: "Pick the chain the coin is on." }, 400);
      const same = found.found && found.chain === chain;
      const row = { id: newId(), chain, address: same ? found.address : address, status: "approved", source: "admin", approved_at: new Date(),
        verified: !!b.verified, pair_address: same ? found.pairAddress || null : null, image: cleanUrl(b.image) || (same ? found.image || null : null),
        name: clean(b.name, 40) || found.name || "", symbol: (clean(b.symbol, 12) || found.symbol || "").replace(/^\$/, "").toUpperCase(),
        description: clean(b.description, 1000), website: cleanUrl(b.website), x: cleanUrl(b.x), telegram: cleanUrl(b.telegram), discord: cleanUrl(b.discord),
        liquidity_at_listing: found.liquidity || 0, liquidity: same ? found.liquidity || null : null };
      if (row.name.length < 2 || !/^[A-Z0-9]{2,12}$/.test(row.symbol)) return json({ error: "Enter a name and a symbol of 2–12 letters or numbers." }, 400);
      if (b.logo) { const logo = parseLogo(b.logo); if (!logo) return json({ error: "Upload a PNG, JPG or WebP logo." }, 400); row.image = await saveLogo(row.id, logo); }
      // An auto-indexed copy becomes this listing
      const [ex] = await sql()`select id, status from coins where chain = ${chain} and address_lc = ${row.address.toLowerCase()}`;
      if (ex && ex.status !== "indexed") return json({ error: "That coin is already on the Fat List." }, 409);
      if (ex) { const { id: _drop, ...upd } = row; await sql()`update coins set ${sql()(upd)} where id = ${ex.id}`; }
      else await sql()`insert into coins ${sql()(row)}`;
      await bust();
      return json({ ok: true });
    }
    if (b.action === "comp") {
      const [c] = ID_RE.test(id) ? await sql()`select id, name, symbol, status from coins where id = ${id}` : [];
      if (!c || !["approved", "indexed"].includes(c.status)) return json({ error: "That coin isn’t live." }, 404);
      const now = Date.now();
      const o = { id: newId(), coin_id: c.id, coin_label: `${c.name} (${c.symbol})`, status: "paid", comped: true, usd: 0, chain: "robinhood", token: "FREE", amount: "0", payer: "admin", paid_at: new Date() };
      if (BOOSTS[b.what]) {
        const p = BOOSTS[b.what];
        Object.assign(o, { kind: "boost", pack: b.what, boosts: p.boosts, hours: p.hours, start_at: new Date(now), end_at: new Date(now + p.hours * 3600000), label: `${p.name} for ${p.hours} hours (free)` });
      } else if (PACKAGES[b.what]) {
        const days = Number(b.days); if (!(days >= 1 && days <= 90)) return json({ error: "Pick 1 to 90 days." }, 400);
        const start = Date.parse(String(b.start || "") + "T00:00:00Z"); if (!(start >= Math.floor(now / DAY) * DAY)) return json({ error: "Pick a start date from today onwards." }, 400);
        const end = start + days * DAY;
        if (await slotsTaken(b.what, start, end) >= PACKAGES[b.what].maxAtOnce) return json({ error: `All ${PACKAGES[b.what].name.toLowerCase()} slots are taken on those dates.` }, 409);
        Object.assign(o, { kind: "promo", pkg: b.what, days, start_at: new Date(start), end_at: new Date(end), label: `${PACKAGES[b.what].name}, ${days} day${days > 1 ? "s" : ""} (free)` });
        if (b.what === "banner") { o.ad_text = clean(b.adText, 70); if (o.ad_text.length < 8) return json({ error: "Write a banner message of 8 to 70 characters." }, 400); }
      } else return json({ error: "Pick what to give." }, 400);
      await sql()`insert into orders ${sql()(o)}`; await bust();
      return json({ ok: true });
    }
    if (b.action === "pullAd") { await sql()`update orders set pulled = true where id = ${id}`; await bust(); return json({ ok: true }); }
    if (b.action === "removePost" || b.action === "restorePost") {
      const r = await sql()`update posts set removed = ${b.action === "removePost"}, removed_by = ${b.action === "removePost" ? "admin" : null} where id = ${id} returning 1`;
      return r.length ? json({ ok: true }) : json({ error: "Unknown post." }, 404);
    }
    if (b.action === "ban") {
      const a = String(b.address || "").toLowerCase();
      if (!/^0x[a-f0-9]{40}$/.test(a)) return json({ error: "Unknown wallet." }, 400);
      await sql()`insert into users (address, banned) values (${a}, true) on conflict (address) do update set banned = true`;
      await sql()`update posts set removed = true, removed_by = 'admin' where author = ${a}`;
      await sql()`delete from sessions where address = ${a}`;
      return json({ ok: true });
    }
    if (b.action === "approveClaim" || b.action === "rejectClaim") {
      const [cl] = await sql()`select * from claims where id = ${id} and status = 'pending'`;
      if (!cl) return json({ error: "That claim was already handled." }, 404);
      if (b.action === "approveClaim") {
        const d = cl.data, upd = { status: "approved", approved_at: new Date() };
        for (const k of ["name", "symbol", "description", "website", "x", "telegram", "discord", "contact", "image"]) if (d[k]) upd[k] = d[k];
        await sql()`update coins set ${sql()(upd)} where id = ${cl.coin_id}`;
      }
      await sql()`update claims set status = ${b.action === "approveClaim" ? "approved" : "rejected"} where id = ${id}`;
      await bust();
      return json({ ok: true });
    }

    if (!ID_RE.test(id)) return json({ error: "Unknown coin." }, 400);
    if (b.action === "setLogo") {
      const logo = parseLogo(b.logo); if (!logo) return json({ error: "Upload a PNG, JPG or WebP logo." }, 400);
      await sql()`update coins set image = ${await saveLogo(id, logo)} where id = ${id}`; await bust(); return json({ ok: true });
    }
    const set = { approve: sql()`status = 'approved', approved_at = coalesce(approved_at, now())`, reject: sql()`status = 'rejected'`, remove: sql()`status = 'removed'`,
      verify: sql()`verified = true, status = 'approved', approved_at = coalesce(approved_at, now())`, unverify: sql()`verified = false` }[b.action];
    if (b.action === "delete") { await sql()`delete from coins where id = ${id}`; await bust(); return json({ ok: true }); }
    if (!set) return json({ error: "Unknown action." }, 400);
    const r = await sql()`update coins set ${set} where id = ${id} returning 1`;
    if (!r.length) return json({ error: "Unknown coin." }, 404);
    await bust();
    return json({ ok: true });
  } catch (e) {
    console.error(e);
    return json({ error: "Something went wrong: " + e.message }, 500);
  }
};
