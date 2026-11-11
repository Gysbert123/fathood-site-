// Runs every 15 minutes (kept slow to save Netlify credits): refreshes prices from DexScreener, then rebuilds the board everyone loads.
import { refreshMarket, buildSnapshot } from "../lib/market.mjs";

export const config = { schedule: "*/15 * * * *" };

export default async () => {
  try {
    const r = await refreshMarket({ budgetMs: 20000 });
    const s = await buildSnapshot();
    console.log("market", JSON.stringify(r), "board", s.coins.length, "of", s.total);
  } catch (e) { console.error("market-refresh failed", e); }
  return new Response("ok");
};
