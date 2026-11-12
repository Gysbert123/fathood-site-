// Help tickets: people contact the team from /contact.html; the team reads them in the admin page.
import { sql } from "./db.mjs";
import { db } from "./coinlist.mjs";

export const TOPICS = {
  payment: "I paid but it didn’t show up",
  ad: "Advertising or a promotion",
  profile: "My coin’s details or logo",
  listing: "Adding or removing a coin",
  other: "Something else",
};
export const MAX_PICS = 3;
const MAX_PIC_BYTES = 450000;

let ready = null;
export function ensureTickets() {
  return (ready ||= (async () => {
    const [r] = await sql()`select to_regclass('tickets') is not null as ok`;
    if (r.ok) return;
    await sql()`create table if not exists tickets (
      id text primary key, topic text not null, name text, contact text not null, coin text, tx text, order_id text,
      body text not null, links text[] not null default '{}', pics integer not null default 0,
      status text not null default 'open', note text, ip text,
      created_at timestamptz not null default now(), closed_at timestamptz)`;
    // Keep the table private: only the site's own functions can read it, never the public Supabase API.
    await sql()`alter table tickets enable row level security`;
  })().catch((e) => { ready = null; throw e; }));
}

// A picture from the browser: data:image/jpeg|png|webp;base64,...
export function parsePic(dataUrl) {
  const m = /^data:image\/(webp|png|jpeg);base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ""));
  if (!m) return null;
  const bytes = Math.floor(m[2].length * 0.75);
  if (bytes < 100 || bytes > MAX_PIC_BYTES) return null;
  return { type: m[1], b64: m[2] };
}
export const picKey = (id, n) => `tickets/${id}/${n}`;
export async function savePic(id, n, pic) { await db().set(picKey(id, n), JSON.stringify(pic)); }
export async function getPic(id, n) { const v = await db().get(picKey(id, n)); return v ? JSON.parse(v) : null; }
export async function deletePics(id, count) { for (let n = 0; n < count; n++) await db().delete(picKey(id, n)).catch(() => {}); }
