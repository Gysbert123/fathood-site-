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
      // live market numbers, so a coin shows its price the moment it's added (not only after the next 15-minute refresh)
      market: { price: nn(p.priceUsd), change24: nn(p.priceChange?.h24), mcap: nn(p.marketCap ?? p.fdv), volume24: nn(p.volume?.h24),
        pairCreatedAt: p.pairCreatedAt ? new Date(p.pairCreatedAt).toISOString() : null, url: cleanUrl(p.url) || null },
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
  // Not on DEX Screener yet (common for brand-new coins, e.g. still on a launchpad like Torchpad): try GeckoTerminal,
  // which picks up new Robinhood Chain coins sooner.
  if (!data.found) data = await geckoLookup(address);
  await setJSON(ck, { at: Date.now(), data });
  return data;
}

const num = (v) => (v == null || v === "" || isNaN(Number(v)) ? 0 : Number(v));
function nn(v) { return v == null || v === "" || isNaN(Number(v)) ? null : Number(v); }
async function geckoLookup(address) {
  const nets = /^0x[a-fA-F0-9]{40}$/.test(address) ? [["robinhood", "robinhood"], ["base", "base"], ["ethereum", "eth"], ["bsc", "bsc"]]
    : /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address) ? [["solana", "solana"]] : [];
  for (const [chain, net] of nets) {
    try {
      const t = (await get(`https://api.geckoterminal.com/api/v2/networks/${net}/tokens/${encodeURIComponent(address)}`))?.data?.attributes;
      if (!t || !t.symbol) continue;
      const data = { found: true, chain, address: t.address || address, name: clean(t.name, 40), symbol: clean(t.symbol, 12).replace(/^\$/, ""),
        image: /missing/i.test(t.image_url || "") ? "" : cleanUrl(t.image_url), liquidity: num(t.total_reserve_in_usd), pairAddress: null,
        market: { price: nn(t.price_usd), change24: null, mcap: nn(t.market_cap_usd) ?? nn(t.fdv_usd), volume24: nn(t.volume_usd?.h24), pairCreatedAt: null, url: null },
        description: "", website: "", x: "", telegram: "", discord: "" };
      try {
        const pool = (await get(`https://api.geckoterminal.com/api/v2/networks/${net}/tokens/${encodeURIComponent(address)}/pools?page=1`))?.data?.[0];
        if (pool?.attributes?.address) data.pairAddress = pool.attributes.address;
      } catch {}
      try {
        const a = (await get(`https://api.geckoterminal.com/api/v2/networks/${net}/tokens/${encodeURIComponent(address)}/info`))?.data?.attributes || {};
        data.description = clean(a.description, 1000);
        data.image ||= /missing/i.test(a.image_url || "") ? "" : cleanUrl(a.image_url);
        data.website = cleanUrl((a.websites || [])[0]);
        if (a.twitter_handle) data.x = cleanUrl("https://x.com/" + a.twitter_handle);
        if (a.telegram_handle) data.telegram = cleanUrl("https://t.me/" + a.telegram_handle);
        data.discord = cleanUrl(a.discord_url);
      } catch {}
      return data;
    } catch {}
  }
  return { found: false };
}

