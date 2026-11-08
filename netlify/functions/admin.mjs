import { getStore } from "@netlify/blobs";

const memes = () => getStore({ name: "memes", consistency: "strong" });
const ID_RE = /^\d{13}-[a-f0-9]{8}$/;

function newId() {
  return `${Date.now()}-${crypto.randomUUID().replace(/-/g, "").slice(0, 8)}`;
}

async function listIds(prefix) {
  const { blobs } = await memes().list({ prefix: `${prefix}/` });
  return blobs.map((b) => b.key.slice(prefix.length + 1)).filter((id) => ID_RE.test(id)).sort().reverse();
}

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", ...headers } });
}

function isAdmin(req) {
  const want = process.env.ADMIN_PASSWORD || "";
  const got = req.headers.get("x-admin-key") || "";
  if (want.length < 8 || got.length !== want.length) return false;
  let diff = 0;
  for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ got.charCodeAt(i);
  return diff === 0;
}


const STATES = ["pending", "approved"];

const MAX_FAILS = 10;

export default async (req, context) => {
  if (!process.env.ADMIN_PASSWORD || process.env.ADMIN_PASSWORD.length < 8)
    return json({ error: "ADMIN_PASSWORD is not set on Netlify (it needs at least 8 characters)." }, 500);
  const ip = String((context && context.ip) || "unknown").replace(/[^a-zA-Z0-9.:]/g, "_");
  const guard = getStore("ratelimit");
  const failKey = `adminfail/${Math.floor(Date.now() / 3600000)}/${ip}`;
  const fails = Number((await guard.get(failKey)) || 0);
  if (fails >= MAX_FAILS) return json({ error: "Too many wrong passwords. Try again in an hour." }, 429);
  if (!isAdmin(req)) {
    await guard.set(failKey, String(fails + 1));
    return json({ error: "Wrong password." }, 401);
  }

  const url = new URL(req.url);
  if (req.method === "GET") {
    const image = url.searchParams.get("image");
    if (image) {
      const [state, id] = image.split("/");
      if (!STATES.includes(state) || !ID_RE.test(id || "")) return json({ error: "Bad image" }, 400);
      const data = await memes().get(`${state}/${id}`, { type: "arrayBuffer" });
      if (!data) return json({ error: "Not found" }, 404);
      return new Response(data, { headers: { "content-type": "image/jpeg", "cache-control": "no-store" } });
    }
    const state = url.searchParams.get("list") || "pending";
    if (!STATES.includes(state)) return json({ error: "Bad list" }, 400);
    return json({ ids: await listIds(state) }, 200, { "cache-control": "no-store" });
  }

  if (req.method === "POST") {
    const { action, id, from } = await req.json().catch(() => ({}));
    if (!ID_RE.test(id || "")) return json({ error: "Bad id" }, 400);
    const store = memes();
    if (action === "approve") {
      const data = await store.get(`pending/${id}`, { type: "arrayBuffer" });
      if (!data) return json({ error: "Not found" }, 404);
      await store.set(`approved/${id}`, data, { metadata: { approved: Date.now() } });
      await store.delete(`pending/${id}`);
      return json({ ok: true });
    }
    if (action === "delete") {
      if (!STATES.includes(from)) return json({ error: "Bad state" }, 400);
      await store.delete(`${from}/${id}`);
      return json({ ok: true });
    }
    if (action === "unpublish") {
      const data = await store.get(`approved/${id}`, { type: "arrayBuffer" });
      if (!data) return json({ error: "Not found" }, 404);
      await store.set(`pending/${id}`, data);
      await store.delete(`approved/${id}`);
      return json({ ok: true });
    }
    return json({ error: "Unknown action" }, 400);
  }
  return json({ error: "Method not allowed" }, 405);
};

export const config = { path: "/api/admin" };
