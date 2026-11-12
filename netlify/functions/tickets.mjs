// Public: send a help ticket (with up to 3 pictures and some links). Only the admin can read tickets.
import { hit } from "../lib/db.mjs";
import { sql } from "../lib/db.mjs";
import { json, newId, ipOf, clean, cleanUrl } from "../lib/coinlist.mjs";
import { TOPICS, MAX_PICS, ensureTickets, parsePic, savePic } from "../lib/tickets.mjs";

export const config = { path: "/api/tickets" };

export default async (req, context) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!process.env.DATABASE_URL) return json({ error: "Tickets aren’t switched on yet. Message the team on Telegram." }, 503);
  try {
    const len = Number(req.headers.get("content-length") || 0);
    if (len > 2_000_000) return json({ error: "Those pictures are too big. Try smaller ones." }, 413);
    const b = await req.json().catch(() => null);
    if (!b) return json({ error: "Something went wrong. Try again." }, 400);
    if (String(b.website2 || "")) return json({ ok: true, ticket: "OK" }); // bots fill the hidden field

    const t = {
      topic: TOPICS[b.topic] ? b.topic : "other",
      name: clean(b.name, 60),
      contact: clean(b.contact, 120),
      coin: clean(b.coin, 120),
      tx: clean(b.tx, 140),
      order_id: clean(b.orderId, 40) || null,
      body: clean(b.body, 3000),
      links: (Array.isArray(b.links) ? b.links : String(b.links || "").split(/\s+/)).map(cleanUrl).filter(Boolean).slice(0, 6),
    };
    if (t.contact.length < 3) return json({ error: "Tell us how to reach you (Telegram, X or email).", field: "contact" }, 400);
    if (t.body.length < 10) return json({ error: "Describe the problem in a sentence or two.", field: "body" }, 400);
    const pics = (Array.isArray(b.pics) ? b.pics : []).slice(0, MAX_PICS).map(parsePic);
    if (pics.some((p) => !p)) return json({ error: "One of the pictures couldn’t be read. Use PNG, JPG or WebP.", field: "pics" }, 400);

    if (!(await hit("ticket", ipOf(context), 5))) return json({ error: "You’ve sent several tickets in the last hour. We’ll get back to you soon." }, 429);
    await ensureTickets();
    const id = newId();
    for (let n = 0; n < pics.length; n++) await savePic(id, n, pics[n]);
    await sql()`insert into tickets ${sql()({ id, ...t, pics: pics.length, ip: ipOf(context) })}`;
    return json({ ok: true, ticket: id.slice(-6).toUpperCase() });
  } catch (e) {
    console.error(e);
    return json({ error: "Something went wrong. Try again, or message the team on Telegram." }, 500);
  }
};
