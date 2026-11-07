import { getStore } from "@netlify/blobs";

export const memes = () => getStore({ name: "memes", consistency: "strong" });
export const ID_RE = /^\d{13}-[a-f0-9]{8}$/;

export function newId() {
  return `${Date.now()}-${crypto.randomUUID().replace(/-/g, "").slice(0, 8)}`;
}

export async function listIds(prefix) {
  const { blobs } = await memes().list({ prefix: `${prefix}/` });
  return blobs.map((b) => b.key.slice(prefix.length + 1)).filter((id) => ID_RE.test(id)).sort().reverse();
}

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", ...headers } });
}

export function isAdmin(req) {
  const want = process.env.ADMIN_PASSWORD || "";
  const got = req.headers.get("x-admin-key") || "";
  if (want.length < 8 || got.length !== want.length) return false;
  let diff = 0;
  for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ got.charCodeAt(i);
  return diff === 0;
}
