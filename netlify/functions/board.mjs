// Fathood Battlegrounds - shared weekly leaderboard for the beta.
//   GET  /api/board            -> { week, reset_in, rows: [{name, points, wins, kills, games}] }
//   POST /api/board  {id, name, kills, place}  -> records one finished match, returns the board
// Points are worked out here (not trusted from the game): K.O. = 10, placement as in the game.
// One stored record per player per week ("<week>/<player id>"), so two players saving at
// the same moment never overwrite each other. The week starts Monday 00:00 UTC.
import { getStore } from "@netlify/blobs";

const KILL_POINTS = 10;
const PLACE_POINTS = [[1, 100], [2, 70], [3, 55], [5, 40], [10, 25], [20, 10]];
const MIN_GAP_MS = 45 * 1000; // a match can't finish faster than this

function placePoints(place) {
  for (const [p, pts] of PLACE_POINTS) if (place <= p) return pts;
  return 0;
}

function weekStart(now = Date.now()) {
  const d = new Date(now);
  const day = (d.getUTCDay() + 6) % 7; // 0 = Monday
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day);
}

function weekKey(now = Date.now()) {
  return new Date(weekStart(now)).toISOString().slice(0, 10);
}

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

async function board(store, week) {
  const { blobs } = await store.list({ prefix: week + "/" });
  const rows = [];
  for (const b of blobs) {
    const r = await store.get(b.key, { type: "json" });
    if (r) rows.push({ name: r.name, points: r.points, wins: r.wins, kills: r.kills, games: r.games });
  }
  rows.sort((a, b) => b.points - a.points || b.wins - a.wins || b.kills - a.kills);
  return { week, reset_in: Math.floor((weekStart() + 7 * 86400000 - Date.now()) / 1000), rows: rows.slice(0, 100) };
}

export default async (req) => {
  const store = getStore({ name: "fathood-board", consistency: "strong" });
  const week = weekKey();
  if (req.method === "GET") return json(await board(store, week));
  if (req.method !== "POST") return json({ error: "method" }, 405);

  let b;
  try {
    b = await req.json();
  } catch {
    return json({ error: "bad json" }, 400);
  }
  const id = String(b.id || "");
  const name = String(b.name || "").trim();
  const kills = Number(b.kills);
  const place = Number(b.place);
  if (!/^[a-f0-9]{16,40}$/.test(id)) return json({ error: "bad id" }, 400);
  if (!/^[A-Za-z0-9_ ]{3,14}$/.test(name)) return json({ error: "bad name" }, 400);
  if (!Number.isInteger(kills) || kills < 0 || kills > 39) return json({ error: "bad kills" }, 400);
  if (!Number.isInteger(place) || place < 1 || place > 40) return json({ error: "bad place" }, 400);

  const key = `${week}/${id}`;
  const row = (await store.get(key, { type: "json" })) || { points: 0, wins: 0, kills: 0, games: 0, last: 0 };
  const now = Date.now();
  if (now - (row.last || 0) < MIN_GAP_MS) return json({ error: "too fast" }, 429);
  const pts = kills * KILL_POINTS + placePoints(place);
  row.name = name;
  row.points += pts;
  row.kills += kills;
  row.games += 1;
  if (place === 1) row.wins += 1;
  row.last = now;
  await store.setJSON(key, row);
  const out = await board(store, week);
  out.added = pts;
  out.rank = out.rows.findIndex((r) => r.name === name) + 1;
  return json(out);
};

export const config = { path: "/api/board" };
