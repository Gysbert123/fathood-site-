// Counts one visit (sent once per browser session by site-nav.js). Answers with an empty 204.
import { sql } from "../lib/db.mjs";
import { db, ipOf } from "../lib/coinlist.mjs";
import { ensureVisits, sourceOf, pageOf, BOT_RE } from "../lib/visits.mjs";

export const config = { path: "/api/visit" };
const none = () => new Response(null, { status: 204, headers: { "cache-control": "no-store" } });

let salt = null;
async function getSalt() {
  if (salt) return salt;
  let s = await db().get("settings/visit-salt");
  if (!s) { s = crypto.randomUUID() + crypto.randomUUID(); await db().set("settings/visit-salt", s); }
  return (salt = s);
}
async function hash(text) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(d).slice(0, 12), (b) => b.toString(16).padStart(2, "0")).join("");
}

export default async (req, context) => {
  if (req.method !== "POST" || !process.env.DATABASE_URL) return none();
  try {
    const ua = req.headers.get("user-agent") || "";
    if (!ua || BOT_RE.test(ua)) return none();
    const b = JSON.parse((await req.text()).slice(0, 2000) || "{}");
    const host = new URL(req.url).hostname.replace(/^www\./, "");
    const day = new Date().toISOString().slice(0, 10);
    const page = pageOf(b.p), src = sourceOf(b.r, host);
    await ensureVisits();
    const h = await hash(`${await getSalt()}|${day}|${ipOf(context)}|${ua}`);
    const [isNew] = await sql()`insert into visit_seen (day, h) values (${day}, ${h}) on conflict do nothing returning 1`;
    await sql()`insert into visit_days (day, visits, visitors) values (${day}, 1, ${isNew ? 1 : 0})
      on conflict (day) do update set visits = visit_days.visits + 1, visitors = visit_days.visitors + ${isNew ? 1 : 0}`;
    await sql()`insert into visit_src (day, kind, name, n) values (${day}, 'src', ${src}, 1), (${day}, 'page', ${page}, 1)
      on conflict (day, kind, name) do update set n = visit_src.n + 1`;
    if (isNew && Math.random() < 0.02) await sql()`delete from visit_seen where day < ${day}::date - 1`;
  } catch (e) { console.error(e); }
  return none();
};
