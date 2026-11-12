import { sql } from "../lib/db.mjs";
import { lookup } from "../lib/lookup.mjs";
import { parseLogo, saveLogo, testPrices, setTestPrices, TEST_PRICE_HOURS, db, json, newId, ID_RE, DAY, ipOf, isAdmin, clean, cleanUrl, addrOk, CHAIN_NAMES, PACKAGES, BOOSTS, PAY_CHAINS } from "../lib/coinlist.mjs";
import { slotsTaken } from "../lib/db.mjs";
import { TOPICS, ensureTickets, getPic, deletePics } from "../lib/tickets.mjs";
import { ensureVisits } from "../lib/visits.mjs";

export const config = { path: "/api/fatlist-admin" };
const ms = (d) => (d ? new Date(d).getTime() : null);
const listing = (r) => ({ id: r.id, name: r.name, symbol: r.symbol, chain: r.chain, address: r.address, image: r.image, description: r.description,
  website: r.website, x: r.x, telegram: r.telegram, discord: r.discord, contact: r.contact, status: r.status, source: r.source,
  verified: r.verified, verifyPaid: r.verify_paid, createdAt: ms(r.created_at), liquidityAtListing: r.liquidity_at_listing, liquidity: r.liquidity });
const order = (o) => ({ id: o.id, kind: o.kind, pkg: o.pkg, spot: o.spot == null ? null : Number(o.spot), label: o.label, coin: o.coin_label, usd: Number(o.usd), start: ms(o.start_at), end: ms(o.end_at),
  adText: o.ad_text, amount: o.amount, token: o.token, chain: o.chain, payer: o.payer, paidAt: ms(o.paid_at), comped: o.comped, pulled: o.pulled,
  explorer: o.tx_hash ? (PAY_CHAINS[o.chain]?.explorer || "https://solscan.io/tx/") + o.tx_hash : null, live: !o.pulled && ms(o.start_at) <= Date.now() && ms(o.end_at) > Date.now() });
const bust = () => db().delete("snapshot/board");
const ticket = (t) => ({ id: t.id, code: t.id.slice(-6).toUpperCase(), topic: t.topic, topicName: TOPICS[t.topic] || t.topic, name: t.name, contact: t.contact,
  coin: t.coin, tx: t.tx, orderId: t.order_id, body: t.body, links: t.links || [], pics: t.pics, status: t.status, note: t.note,
  createdAt: ms(t.created_at), closedAt: ms(t.closed_at) });
const TX_RE = /^0x[a-fA-F0-9]{64}$|^[1-9A-HJ-NP-Za-km-z]{64,90}$/;

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
      // a ticket picture: ?timg=<ticket id>/<n>
      const timg = new URL(req.url).searchParams.get("timg");
      if (timg) {
        const [tid, n] = timg.split("/");
        const p = ID_RE.test(tid) && /^[0-2]$/.test(n) ? await getPic(tid, Number(n)) : null;
        if (!p) return new Response("Not found", { status: 404 });
        return new Response(Uint8Array.from(atob(p.b64), (c) => c.charCodeAt(0)), { headers: { "content-type": `image/${p.type}`, "cache-control": "private, max-age=3600",
          "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'" } });
      }
      const sp = new URL(req.url).searchParams;
      // a quick "wake up" call the admin page makes before loading, so the big load doesn't start cold
      if (sp.get("ping")) return json({ ok: true });
      const q = clean(sp.get("q"), 90).replace(/^\$/, "");
      const like = `%${q.replace(/[%_\\]/g, "\\$&")}%`;
      const liveQ = () => q ? sql()`select * from coins where status in ('approved', 'indexed') and (address_lc = ${q.toLowerCase()} or symbol ilike ${like} or name ilike ${like}) order by liquidity desc nulls last limit 100`
        : sql()`select * from coins where status = 'approved' order by coalesce(approved_at, created_at) desc limit 200`;
      // coin search on its own: small and fast. Finds coins in every state, including taken-down ones, so they can be put back.
      if (sp.get("only") === "live") {
        if (!q) return json({ listings: (await liveQ()).map(listing) });
        const rows = await sql()`select * from coins where (address_lc = ${q.toLowerCase()} or symbol ilike ${like} or name ilike ${like})
          order by (status in ('approved', 'indexed')) desc, liquidity desc nulls last limit 100`;
        return json({ listings: rows.map(listing) });
      }
      // The admin page loads in three parts at once (?part=coins|orders|extra), each its own request,
      // so one slow part can't stop the rest. Each part is timed and answers before Netlify's 10-second limit.
      const JOBS = {
        coins: {
          pending: () => sql()`(select * from coins where status = 'pending' order by created_at desc limit 300)
            union all (select * from coins where verify_paid and not verified and status in ('approved', 'indexed') limit 100)`,
          live: liveQ,
          claims: () => sql()`select cl.*, c.name as coin_name, c.symbol as coin_symbol, c.chain, c.address, c.image as coin_image, c.liquidity from claims cl join coins c on c.id = cl.coin_id where cl.status = 'pending' order by cl.created_at`,
          stats: () => sql()`select (select count(*) from coins where status = 'approved')::int as approved, (select count(*) from coins where status = 'indexed')::int as indexed,
               (select coalesce(sum(usd), 0) from orders where status = 'paid' and not comped and paid_at > now() - interval '30 days')::float as revenue30`,
          rejected: () => sql()`select * from coins where status in ('rejected', 'removed') and source <> 'indexed' order by created_at desc limit 100`,
        },
        orders: {
          orders: () => sql()`select * from orders where status = 'paid' order by paid_at desc limit 300`,
          posts: () => sql()`select id, title, author, reports, removed, created_at, disclosure, left(body, 300) as excerpt from posts order by reports desc, created_at desc limit 150`,
          tp: () => testPrices(),
        },
        extra: {
          tickets: () => ensureTickets().then(() => sql()`(select * from tickets where status = 'open' order by created_at limit 200)
            union all (select * from tickets where status <> 'open' order by closed_at desc nulls last limit 100)`),
          visits: () => ensureVisits().then(() => Promise.all([
            sql()`select to_char(day, 'YYYY-MM-DD') as day, visits, visitors from visit_days where day > current_date - 30 order by day`,
            sql()`select kind, name, sum(n)::int as n from visit_src where day > current_date - 30 group by kind, name order by n desc limit 40`,
          ])),
        },
      };
      const LABEL = { pending: "coins to review", live: "live coins", claims: "claims", stats: "totals", rejected: "rejected coins", orders: "payments", posts: "Hood Talk", tp: "test prices", tickets: "help tickets", visits: "visits" };
      const part = sp.get("part");
      const jobs = JOBS[part] || Object.assign({}, ...Object.values(JOBS));
      const T0 = Date.now(), took = {}, out = {};
      const all = Promise.all(Object.entries(jobs).map(([k, f]) => f().then((v) => { out[k] = v; took[k] = Date.now() - T0; })));
      let timer;
      const done = await Promise.race([all.then(() => true), new Promise((r) => { timer = setTimeout(() => r(false), 8500); })]);
      clearTimeout(timer);
      if (!done) {
        all.catch(() => {});
        const slow = Object.keys(jobs).filter((k) => !(k in took));
        console.error("admin load slow", part, took, slow);
        return json({ error: `The database is slow right now (still waiting for: ${slow.map((k) => LABEL[k]).join(", ")}).`, slow, took }, 503);
      }
      const r = {};
      if ("pending" in out) {
        const seen = new Set();
        r.listings = [...out.pending, ...out.live, ...out.rejected].filter((c) => !seen.has(c.id) && seen.add(c.id)).map(listing);
        r.stats = out.stats[0];
        r.claims = out.claims.map((c) => ({ id: c.id, coinId: c.coin_id, name: c.coin_name, symbol: c.coin_symbol, chain: c.chain, address: c.address, liquidity: c.liquidity, image: c.coin_image, data: c.data, createdAt: ms(c.created_at) }));
      }
      if ("orders" in out) {
        r.orders = out.orders.map(order);
        r.posts = out.posts.map((p) => ({ id: p.id, title: p.title, author: p.author, reports: p.reports, removed: p.removed, createdAt: ms(p.created_at), disclosure: p.disclosure, excerpt: p.excerpt }));
        r.testPrices = out.tp ? { on: true, until: out.tp.until } : { on: false }; r.testHours = TEST_PRICE_HOURS;
      }
      if ("tickets" in out) {
        r.tickets = out.tickets.map(ticket);
        const [vdays, vsrc] = out.visits;
        r.visits = { days: vdays, sources: vsrc.filter((x) => x.kind === "src").slice(0, 12), pages: vsrc.filter((x) => x.kind === "page") };
      }
      return json(r);
    }
    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
    const b = await req.json().catch(() => ({}));
    const id = String(b.id || "");

    if (b.action === "testPrices") {
      const v = await setTestPrices(!!b.on);
      return json({ ok: true, testPrices: v ? { on: true, until: v.until } : { on: false } });
    }
    if (b.action === "resetVotes") {
      await sql()`delete from votes`;
      await sql()`update coins set votes = 0 where votes <> 0`;
      await bust();
      return json({ ok: true });
    }
    if (b.action === "ticketDone" || b.action === "ticketOpen") {
      await ensureTickets();
      const r = await sql()`update tickets set status = ${b.action === "ticketDone" ? "done" : "open"}, closed_at = ${b.action === "ticketDone" ? new Date() : null}
        where id = ${id} returning 1`;
      return r.length ? json({ ok: true }) : json({ error: "Unknown ticket." }, 404);
    }
    if (b.action === "ticketNote") {
      await ensureTickets();
      const r = await sql()`update tickets set note = ${clean(b.note, 2000) || null} where id = ${id} returning 1`;
      return r.length ? json({ ok: true }) : json({ error: "Unknown ticket." }, 404);
    }
    if (b.action === "ticketDelete") {
      await ensureTickets();
      const [t] = await sql()`delete from tickets where id = ${id} returning pics`;
      if (!t) return json({ error: "Unknown ticket." }, 404);
      await deletePics(id, t.pics);
      return json({ ok: true });
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
      // "They paid but it didn't show up": record what they paid so it counts as a sale and the same payment can't be used again.
      const paidUsd = Math.round(Number(b.paidUsd || 0) * 100) / 100, tx = clean(b.tx, 140);
      if (isNaN(paidUsd) || paidUsd < 0 || paidUsd > 100000) return json({ error: "Enter what they paid in dollars, or leave it empty." }, 400);
      if (tx && !TX_RE.test(tx)) return json({ error: "That doesn’t look like a transaction hash. Paste just the hash, or leave it empty." }, 400);
      if (tx) {
        const [used] = await sql()`select id from orders where tx_hash = ${tx}`;
        if (used) return json({ error: "That transaction is already linked to an order. Check Payments: it may have gone through after all." }, 409);
        Object.assign(o, { chain: tx.startsWith("0x") ? "robinhood" : "solana", tx_hash: tx });
      }
      if (paidUsd > 0) Object.assign(o, { comped: false, usd: paidUsd, token: "MANUAL", amount: String(paidUsd), payer: "admin (paid, added by hand)" });
      if (BOOSTS[b.what]) {
        const p = BOOSTS[b.what];
        Object.assign(o, { kind: "boost", pack: b.what, boosts: p.boosts, hours: p.hours, start_at: new Date(now), end_at: new Date(now + p.hours * 3600000), label: `${p.name} for ${p.hours} hours (free)` });
      } else if (PACKAGES[b.what]) {
        const days = PACKAGES[b.what].fixedDays || Number(b.days); if (!(days >= 1 && days <= 90)) return json({ error: "Pick 1 to 90 days." }, 400);
        const start = Date.parse(String(b.start || "") + "T00:00:00Z"); if (!(start >= Math.floor(now / DAY) * DAY)) return json({ error: "Pick a start date from today onwards." }, 400);
        const end = start + days * DAY;
        if (b.what === "spotlight") {
          // free Spotlight: the spot the admin picked, or the first spot with room
          let spot = 0;
          const want = Number(b.spot) || 0;
          if (want) {
            if (!(want >= 1 && want <= PACKAGES.spotlight.spots)) return json({ error: "Pick spot 1, 2 or 3." }, 400);
            if (await slotsTaken("spotlight", start, end, want) >= PACKAGES.spotlight.perSpot) return json({ error: `Spot ${want} is full on those dates. Pick another spot.` }, 409);
            spot = want;
          } else for (let s = 1; s <= PACKAGES.spotlight.spots && !spot; s++) if (await slotsTaken("spotlight", start, end, s) < PACKAGES.spotlight.perSpot) spot = s;
          if (!spot) return json({ error: "All Spotlight spots are full on those dates." }, 409);
          await sql()`alter table orders add column if not exists spot integer`;
          o.spot = spot;
        } else if (await slotsTaken(b.what, start, end) >= PACKAGES[b.what].maxAtOnce) return json({ error: `All ${PACKAGES[b.what].name.toLowerCase()} slots are taken on those dates.` }, 409);
        Object.assign(o, { kind: "promo", pkg: b.what, days, start_at: new Date(start), end_at: new Date(end), label: `${PACKAGES[b.what].name}, ${days} day${days > 1 ? "s" : ""} (free)` });
        if (b.what === "banner") { o.ad_text = clean(b.adText, 70); if (o.ad_text.length < 8) return json({ error: "Write a banner message of 8 to 70 characters." }, 400); }
        if (b.what === "side") {
          o.ad_text = clean(b.adText, 70) || null; o.boosts = PACKAGES.side.boosts;
          if (b.adImage) { const img = parseLogo(b.adImage); if (!img) return json({ error: "The banner picture couldn’t be read. Use PNG, JPG or WebP under 300 KB." }, 400);
            await sql()`alter table orders add column if not exists ad_image text`; o.ad_image = await saveLogo(o.id, img); }
        }
      } else return json({ error: "Pick what to give." }, 400);
      await sql()`insert into orders ${sql()(o)}`;
      if (b.what === "side") await sql()`update coins set votes = votes + ${PACKAGES.side.votes} where id = ${c.id}`;
      if (ID_RE.test(String(b.ticket || ""))) {
        await ensureTickets();
        await sql()`update tickets set status = 'done', closed_at = now(), note = concat_ws(E'\n', note, ${"Added " + o.label + " for " + o.coin_label + "."}) where id = ${b.ticket}`;
      }
      await bust();
      return json({ ok: true });
    }
    if (b.action === "setSpot") {
      // move a Spotlight card (paid or free) to another spot
      const spot = Number(b.spot), S = PACKAGES.spotlight;
      if (!(spot >= 1 && spot <= S.spots)) return json({ error: "Pick spot 1, 2 or 3." }, 400);
      const [o] = ID_RE.test(id) ? await sql()`select id, start_at, end_at, coalesce((to_jsonb(orders) ->> 'spot')::int, 1) as spot from orders where id = ${id} and kind = 'promo' and pkg = 'spotlight'` : [];
      if (!o) return json({ error: "That isn’t a Spotlight card." }, 404);
      if (o.spot === spot) return json({ ok: true });
      if (await slotsTaken("spotlight", new Date(o.start_at).getTime(), new Date(o.end_at).getTime(), spot) >= S.perSpot) return json({ error: `Spot ${spot} is full on those dates.` }, 409);
      await sql()`alter table orders add column if not exists spot integer`;
      await sql()`update orders set spot = ${spot} where id = ${id}`;
      await bust(); return json({ ok: true });
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
    if (b.action === "editCoin") {
      const upd = { name: clean(b.name, 40), symbol: clean(b.symbol, 12).replace(/^\$/, "").toUpperCase(), description: clean(b.description, 1000),
        website: cleanUrl(b.website) || null, x: cleanUrl(b.x) || null, telegram: cleanUrl(b.telegram) || null, discord: cleanUrl(b.discord) || null, contact: clean(b.contact, 120) || null };
      if (upd.name.length < 2 || !/^[A-Z0-9]{2,12}$/.test(upd.symbol)) return json({ error: "Enter a name and a symbol of 2–12 letters or numbers." }, 400);
      // Saving details by hand makes it a team-approved listing, so the auto-lister never hides it.
      const r = await sql()`update coins set ${sql()(upd)}, status = case when status = 'indexed' then 'approved' else status end,
        approved_at = coalesce(approved_at, now()) where id = ${id} returning 1`;
      if (!r.length) return json({ error: "Unknown coin." }, 404);
      await bust(); return json({ ok: true });
    }
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
