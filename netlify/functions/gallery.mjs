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


const PAGE = 48;

export default async (req) => {
  const before = new URL(req.url).searchParams.get("before");
  let ids = await listIds("approved");
  if (before) ids = ids.filter((id) => id < before);
  const page = ids.slice(0, PAGE);
  return json(
    { items: page.map((id) => ({ id, url: `/api/meme/${id}` })), next: ids.length > PAGE ? page[page.length - 1] : null },
    200,
    { "cache-control": "public, max-age=30" }
  );
};

export const config = { path: "/api/gallery" };
