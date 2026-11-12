// Simple, private visit counter. No cookies, no raw IP addresses stored.
// A "visit" is counted once per browser session (see site-nav.js), and a "visitor" once per day.
import { sql } from "./db.mjs";

let ready = null;
export function ensureVisits() {
  return (ready ||= (async () => {
    // one quick check; only build the tables the very first time (the database is slow, so skip needless steps)
    const [r] = await sql()`select to_regclass('visit_days') is not null and to_regclass('visit_src') is not null and to_regclass('visit_seen') is not null as ok`;
    if (r.ok) return;
    await sql()`create table if not exists visit_days (day date primary key, visits integer not null default 0, visitors integer not null default 0)`;
    await sql()`create table if not exists visit_src (day date not null, kind text not null, name text not null, n integer not null default 0, primary key (day, kind, name))`;
    // today's visitor fingerprints (a one-way hash); older days are deleted, only the daily totals stay
    await sql()`create table if not exists visit_seen (day date not null, h text not null, primary key (day, h))`;
    for (const t of ["visit_days", "visit_src", "visit_seen"]) await sql().unsafe(`alter table ${t} enable row level security`);
  })().catch((e) => { ready = null; throw e; }));
}

// Where the visit came from, as a short name: "x.com", "t.me", "google", "direct"...
export function sourceOf(ref, host) {
  let h = "";
  try { h = new URL(String(ref || "")).hostname.toLowerCase().replace(/^www\./, ""); } catch { return "direct"; }
  if (!h || h === host || h.endsWith(".fathood.org") || h === "fathood.org") return "direct";
  if (h === "t.co" || h === "twitter.com" || h === "x.com") return "x.com";
  if (h === "t.me" || h.endsWith("telegram.org")) return "telegram";
  if (/(^|\.)google\./.test(h)) return "google";
  if (/(^|\.)bing\.com$/.test(h)) return "bing";
  if (/(^|\.)dexscreener\.com$/.test(h)) return "dexscreener";
  if (/(^|\.)(facebook|fb)\.com$/.test(h)) return "facebook";
  if (/(^|\.)reddit\.com$/.test(h)) return "reddit";
  if (/(^|\.)youtube\.com$/.test(h)) return "youtube";
  if (/(^|\.)tiktok\.com$/.test(h)) return "tiktok";
  if (/(^|\.)discord(app)?\.com$/.test(h)) return "discord";
  return h.slice(0, 60);
}
export function pageOf(p) {
  const s = String(p || "/").toLowerCase();
  if (s === "/" || s.startsWith("/index")) return "Home";
  if (s.startsWith("/fatlist")) return "Fat List";
  if (s.startsWith("/contact")) return "Contact";
  if (s.startsWith("/beta") || s.startsWith("/play")) return "Game";
  return "Other";
}
export const BOT_RE = /bot|crawl|spider|slurp|preview|facebookexternalhit|embedly|headless|lighthouse|monitor|curl|wget|python|axios|node-fetch/i;
