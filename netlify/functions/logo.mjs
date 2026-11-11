import { getJSON, ID_RE } from "../lib/coinlist.mjs";

export const config = { path: "/api/logo/:id" };

export default async (req, context) => {
  const id = context?.params?.id || new URL(req.url).pathname.split("/").pop();
  const l = ID_RE.test(id) ? await getJSON(`logos/${id}`) : null;
  if (!l) return new Response("Not found", { status: 404 });
  const bytes = Uint8Array.from(atob(l.b64), (c) => c.charCodeAt(0));
  return new Response(bytes, { headers: {
    "content-type": `image/${l.type}`, "cache-control": "public, max-age=604800, immutable",
    "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'",
  } });
};
