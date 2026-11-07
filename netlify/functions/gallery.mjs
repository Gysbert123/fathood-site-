import { listIds, json } from "../lib/shared.mjs";

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
