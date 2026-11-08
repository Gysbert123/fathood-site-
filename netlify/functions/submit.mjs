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


const MAX_BYTES = 2.5 * 1024 * 1024;
const PER_HOUR = 20;
const MAX_PENDING = 2000;

export default async (req, context) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!(req.headers.get("content-type") || "").startsWith("image/jpeg")) return json({ error: "Only JPEG images are accepted." }, 415);

  // basic rate limit per IP per hour
  const ip = String(context.ip || "unknown").replace(/[^a-zA-Z0-9.:]/g, "_");
  const limits = getStore("ratelimit");
  const key = `${Math.floor(Date.now() / 3600000)}/${ip}`;
  const count = Number((await limits.get(key)) || 0);
  if (count >= PER_HOUR) return json({ error: "That’s a lot of memes. Try again in an hour." }, 429);

  const buf = await req.arrayBuffer();
  const b = new Uint8Array(buf);
  if (buf.byteLength < 2000 || buf.byteLength > MAX_BYTES) return json({ error: "That image is the wrong size." }, 413);
  if (!(b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff)) return json({ error: "That isn’t a JPEG image." }, 415);

  const { blobs } = await memes().list({ prefix: "pending/" });
  if (blobs.length >= MAX_PENDING) return json({ error: "The review queue is full right now. Try again later." }, 503);

  const id = newId();
  await memes().set(`pending/${id}`, buf, { metadata: { created: Date.now() } });
  await limits.set(key, String(count + 1));
  return json({ ok: true, id });
};

export const config = { path: "/api/submit" };
