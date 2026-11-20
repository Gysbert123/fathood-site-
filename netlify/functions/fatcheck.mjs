// GET /api/fatcheck?id=<coin id>  ->  Fat Check for one coin (see netlify/lib/fatcheck.mjs).
// Netlify keeps a shared copy for an hour, so busy coin pages cost almost nothing.
import { sql } from "../lib/db.mjs";
import { json, ID_RE } from "../lib/coinlist.mjs";
import { fatCheck } from "../lib/fatcheck.mjs";

export const config = { path: "/api/fatcheck" };

export default async (req) => {
  const id = new URL(req.url).searchParams.get("id") || "";
  if (!ID_RE.test(id)) return json({ error: "Unknown coin." }, 400);
  try {
    const [c] = await sql()`select chain, address, liquidity from coins where id = ${id} and status in ('approved', 'indexed', 'pending')`;
    if (!c) return json({ error: "That coin isn’t on the Fat List." }, 404);
    const r = await fatCheck({ chain: c.chain, address: c.address, liquidity: c.liquidity == null ? null : Number(c.liquidity) });
    const keep = r.ok ? "public, durable, s-maxage=3600, stale-while-revalidate=21600" : "public, s-maxage=120";
    return json(r, 200, { "cache-control": "public, max-age=600", "netlify-cdn-cache-control": keep });
  } catch (e) {
    console.error("fatcheck", e);
    return json({ supported: true, ok: false, checks: [], verdict: null }, 200, { "cache-control": "no-store" });
  }
};
