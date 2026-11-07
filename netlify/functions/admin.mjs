import { memes, listIds, isAdmin, json, ID_RE } from "../lib/shared.mjs";

const STATES = ["pending", "approved"];

export default async (req) => {
  if (!process.env.ADMIN_PASSWORD || process.env.ADMIN_PASSWORD.length < 8)
    return json({ error: "ADMIN_PASSWORD is not set on Netlify (it needs at least 8 characters)." }, 500);
  if (!isAdmin(req)) return json({ error: "Wrong password." }, 401);

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
