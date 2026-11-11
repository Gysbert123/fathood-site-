import { verifyMessage } from "viem";
import { sql, hit, sessionOf } from "../lib/db.mjs";
import { json, newId, ID_RE, clean, shortAddr } from "../lib/coinlist.mjs";

export const config = { path: "/api/talk" };
const PAGE = 20;
const ms = (d) => new Date(d).getTime();
const excerpt = (body) => body.replace(/^##.*$/gm, "").replace(/\s+/g, " ").trim().slice(0, 220);
const loginMessage = (host, address, nonce, issued) =>
  `${host} wants you to sign in to Hood Talk with your wallet.\n\nAddress: ${address}\nNonce: ${nonce}\nIssued: ${issued}\n\nSigning is free. It doesn’t send a transaction or give access to your funds.`;

async function coinTags(ids) {
  if (!ids.length) return {};
  const rows = await sql()`select id, name, symbol, image from coins where id in ${sql()(ids)}`;
  return Object.fromEntries(rows.map((r) => [r.id, { id: r.id, name: r.name, symbol: r.symbol, image: r.image }]));
}
async function cards(posts) {
  const tags = await coinTags([...new Set(posts.flatMap((p) => p.coins))]);
  return posts.map((p) => ({ id: p.id, title: p.title, excerpt: excerpt(p.body), author: p.author, authorName: p.author_name || shortAddr(p.author),
    coins: p.coins.map((id) => tags[id]).filter(Boolean), disclosure: p.disclosure, likes: p.likes, comments: p.comments, createdAt: ms(p.created_at), body: p.body }));
}

async function feed(u) {
  const coin = u.searchParams.get("coin"), top = u.searchParams.get("sort") === "top", before = u.searchParams.get("before") || "";
  const posts = await sql()`select p.*, u.name as author_name from posts p left join users u on u.address = p.author
    where not p.removed ${coin && ID_RE.test(coin) ? sql()`and ${coin} = any(p.coins)` : sql()``}
      ${before && ID_RE.test(before) ? sql()`and p.id < ${before}` : sql()``}
      ${top ? sql()`and p.created_at > now() - interval '30 days'` : sql()``}
    order by ${top ? sql()`(p.likes * 2 + p.comments) / power(extract(epoch from now() - p.created_at) / 3600 + 2, 1.2) desc` : sql()`p.id desc`}
    limit ${PAGE + 1}`;
  const page = posts.slice(0, PAGE);
  const out = (await cards(page)).map(({ body, ...c }) => c);
  return json({ posts: out, next: !top && posts.length > PAGE ? page[page.length - 1].id : null });
}

async function one(id, me) {
  if (!ID_RE.test(id)) return json({ error: "That post doesn’t exist." }, 404);
  const [p] = await sql()`select p.*, u.name as author_name from posts p left join users u on u.address = p.author where p.id = ${id} and not p.removed`;
  if (!p) return json({ error: "That post doesn’t exist or was removed." }, 404);
  const [card] = await cards([p]);
  const comments = await sql()`select c.*, u.name as author_name from comments c left join users u on u.address = c.author
    where c.post_id = ${id} and not c.removed order by c.created_at limit 300`;
  const liked = me ? (await sql()`select 1 from post_likes where post_id = ${id} and address = ${me.address}`).length > 0 : false;
  return json({ post: { ...card, liked, mine: me?.address === p.author },
    comments: comments.map((c) => ({ id: c.id, text: c.text, author: c.author, authorName: c.author_name || shortAddr(c.author), createdAt: ms(c.created_at), mine: me?.address === c.author })) });
}

export default async (req) => {
  try {
    const u = new URL(req.url);
    const host = (req.headers.get("host") || u.host).replace(/[^a-zA-Z0-9.:-]/g, "");
    const me = await sessionOf(req);

    if (req.method === "GET") {
      if (u.searchParams.has("nonce")) {
        const address = String(u.searchParams.get("address") || "").toLowerCase();
        if (!/^0x[a-f0-9]{40}$/.test(address)) return json({ error: "Connect a wallet first." }, 400);
        const nonce = crypto.randomUUID().replace(/-/g, ""), issued = new Date().toISOString();
        await sql()`insert into nonces (nonce, address, issued, host, exp) values (${nonce}, ${address}, ${issued}, ${host}, now() + interval '10 minutes')`;
        return json({ nonce, message: loginMessage(host, address, nonce, issued) });
      }
      if (u.searchParams.has("me")) return json({ me: me ? { address: me.address, name: me.name } : null });
      if (u.searchParams.has("post")) return await one(u.searchParams.get("post"), me);
      return await feed(u);
    }
    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
    const b = await req.json().catch(() => ({}));

    if (b.action === "login") {
      const nonce = String(b.nonce || "");
      if (!/^[a-f0-9]{32}$/.test(nonce)) return json({ error: "Sign-in expired. Try again." }, 400);
      const [n] = await sql()`delete from nonces where nonce = ${nonce} and exp > now() returning *`;
      if (!n) return json({ error: "Sign-in expired. Try again." }, 400);
      const ok = await verifyMessage({ address: n.address, message: loginMessage(n.host, n.address, nonce, n.issued), signature: String(b.signature || "") }).catch(() => false);
      if (!ok) return json({ error: "That signature doesn’t match your wallet. Try again." }, 401);
      const [user] = await sql()`insert into users (address) values (${n.address}) on conflict (address) do update set address = excluded.address returning *`;
      if (user.banned) return json({ error: "This wallet can’t post on Hood Talk." }, 403);
      const token = [...crypto.getRandomValues(new Uint8Array(32))].map((x) => x.toString(16).padStart(2, "0")).join("");
      await sql()`insert into sessions (token, address, exp) values (${token}, ${n.address}, now() + interval '30 days')`;
      return json({ ok: true, token, me: { address: n.address, name: user.name || "" } });
    }

    if (!me) return json({ error: "Sign in with your wallet first." }, 401);
    if (b.action === "logout") { await sql()`delete from sessions where token = ${me.token}`; return json({ ok: true }); }

    if (b.action === "name") {
      const name = clean(b.name, 24);
      if (!/^[\w .-]{3,24}$/u.test(name)) return json({ error: "Use 3 to 24 letters, numbers, spaces, dots or dashes." }, 400);
      try { await sql()`update users set name = ${name} where address = ${me.address}`; }
      catch (e) { if (String(e.code) === "23505") return json({ error: "Someone already uses that name." }, 409); throw e; }
      return json({ ok: true, name });
    }

    if (b.action === "post") {
      const title = clean(b.title, 120), body = clean(b.body, 10000);
      if (title.length < 8) return json({ error: "Give the post a title of at least 8 characters.", field: "title" }, 400);
      if (body.length < 80) return json({ error: "Write at least 80 characters.", field: "body" }, 400);
      if (!(await hit("post", me.address, 5, 86400000))) return json({ error: "You can publish 5 posts a day. Come back tomorrow." }, 429);
      const want = [...new Set((Array.isArray(b.coins) ? b.coins : []).map(String).filter((x) => ID_RE.test(x)))].slice(0, 3);
      const coins = want.length ? (await sql()`select id from coins where id in ${sql()(want)}`).map((r) => r.id) : [];
      const id = newId();
      await sql()`insert into posts (id, author, title, body, coins, disclosure) values (${id}, ${me.address}, ${title}, ${body}, ${coins}, ${!!b.disclosure})`;
      return json({ ok: true, id });
    }

    const id = String(b.id || "");
    if (!ID_RE.test(id)) return json({ error: "That post doesn’t exist." }, 404);
    const [p] = await sql()`select id, author from posts where id = ${id} and not removed`;
    if (!p) return json({ error: "That post doesn’t exist or was removed." }, 404);

    if (b.action === "like") {
      const del = await sql()`delete from post_likes where post_id = ${id} and address = ${me.address} returning 1`;
      if (!del.length) await sql()`insert into post_likes (post_id, address) values (${id}, ${me.address}) on conflict do nothing`;
      const [r] = await sql()`update posts set likes = (select count(*) from post_likes where post_id = ${id}) where id = ${id} returning likes`;
      return json({ ok: true, liked: !del.length, likes: r.likes });
    }
    if (b.action === "comment") {
      const text = clean(b.text, 1000);
      if (text.length < 2) return json({ error: "Write a comment first." }, 400);
      if (!(await hit("comment", me.address, 30))) return json({ error: "Slow down a little. Try again in an hour." }, 429);
      await sql()`insert into comments (id, post_id, author, text) values (${newId()}, ${id}, ${me.address}, ${text})`;
      await sql()`update posts set comments = comments + 1 where id = ${id}`;
      return json({ ok: true });
    }
    if (b.action === "report") {
      await sql()`insert into post_reports (post_id, address) values (${id}, ${me.address}) on conflict do nothing`;
      await sql()`update posts set reports = (select count(*) from post_reports where post_id = ${id}) where id = ${id}`;
      return json({ ok: true });
    }
    if (b.action === "delete") {
      if (p.author !== me.address) return json({ error: "You can only delete your own posts." }, 403);
      await sql()`update posts set removed = true, removed_by = 'author' where id = ${id}`;
      return json({ ok: true });
    }
    if (b.action === "deleteComment") {
      const cid = String(b.commentId || "");
      const r = ID_RE.test(cid) ? await sql()`update comments set removed = true where id = ${cid} and post_id = ${id} and author = ${me.address} and not removed returning 1` : [];
      if (!r.length) return json({ error: "You can only delete your own comments." }, 403);
      await sql()`update posts set comments = greatest(0, comments - 1) where id = ${id}`;
      return json({ ok: true });
    }
    return json({ error: "Unknown action." }, 400);
  } catch (e) {
    console.error(e);
    return json({ error: "Something went wrong on our side. Try again in a minute." }, 500);
  }
};
