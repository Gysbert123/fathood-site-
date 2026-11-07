import { memes, ID_RE } from "../lib/shared.mjs";

export default async (req, context) => {
  const id = context.params.id;
  if (!ID_RE.test(id || "")) return new Response("Not found", { status: 404 });
  const data = await memes().get(`approved/${id}`, { type: "arrayBuffer" });
  if (!data) return new Response("Not found", { status: 404, headers: { "cache-control": "no-store" } });
  return new Response(data, { headers: { "content-type": "image/jpeg", "cache-control": "public, max-age=86400" } });
};

export const config = { path: "/api/meme/:id" };
