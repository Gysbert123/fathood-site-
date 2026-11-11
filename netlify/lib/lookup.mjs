import { getJSON, setJSON, clean, cleanUrl, GT_NETWORK } from "./coinlist.mjs";

const get = async (url) => { const r = await fetch(url, { signal: AbortSignal.timeout(8000), headers: { accept: "application/json" } }); if (!r.ok) throw new Error(url + " " + r.status); return r.json(); };
const same = (a, b) => String(a || "").toLowerCase() === String(b || "").toLowerCase();

function pickLinks(info) {
  const out = { website: "", x: "", telegram: "", discord: "" };
  for (const w of info?.websites || []) { const u = cleanUrl(w.url || w); if (u && !out.website) out.website = u; }
  for (const s of info?.socials || []) {
    const t = String(s.type || s.platform || "").toLowerCase();
    let u = s.url || s.handle || "";
    if (t === "twitter" || t === "x") { if (!/^https?:/.test(u)) u = "https://x.com/" + u.replace(/^@/, ""); out.x ||= cleanUrl(u); }
    else if (t === "telegram") { if (!/^https?:/.test(u)) u = "https://t.me/" + u.replace(/^@/, ""); out.telegram ||= cleanUrl(u); }
    else if (t === "discord") { out.discord ||= cleanUrl(u); }
  }
  return out;
}

export async function lookup(address) {
  const ck = `cache/lookup/${address.toLowerCase()}`;
  const c = await getJSON(ck);
  if (c && Date.now() - c.at < 10 * 60000) return c.data;
  let pairs = [];
  try { pairs = (await get(`https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(address)}`)).pairs || []; } catch {}
  const mine = pairs.filter((p) => same(p?.baseToken?.address, address)).sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0));
  let data = { found: false };
  if (mine.length) {
    const p = mine[0];
    data = {
      found: true, chain: p.chainId, address: p.baseToken.address, name: clean(p.baseToken.name, 40), symbol: clean(p.baseToken.symbol, 12),
      image: cleanUrl(p.info?.imageUrl), liquidity: p.liquidity?.usd || 0, pairAddress: p.pairAddress, description: "",
      ...pickLinks(p.info),
    };
    const net = GT_NETWORK[p.chainId];
    if (net) {
      try {
        const a = (await get(`https://api.geckoterminal.com/api/v2/networks/${net}/tokens/${encodeURIComponent(p.baseToken.address)}/info`))?.data?.attributes || {};
        data.description = clean(a.description, 1000);
        data.image ||= cleanUrl(a.image_url);
        data.website ||= cleanUrl((a.websites || [])[0]);
        if (!data.x && a.twitter_handle) data.x = cleanUrl("https://x.com/" + a.twitter_handle);
        if (!data.telegram && a.telegram_handle) data.telegram = cleanUrl("https://t.me/" + a.telegram_handle);
        data.discord ||= cleanUrl(a.discord_url);
      } catch {}
    }
  }
  await setJSON(ck, { at: Date.now(), data });
  return data;
}

