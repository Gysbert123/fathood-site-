// Runs every 15 minutes (kept slow to save Netlify credits): refreshes prices from DexScreener, then rebuilds the board everyone loads.
import { refreshMarket, buildSnapshot } from "../lib/market.mjs";
import { sql } from "../lib/db.mjs";
import { db } from "../lib/coinlist.mjs";

export const config = { schedule: "*/15 * * * *" };

export default async () => {
  try {
    // One-off: clear the test votes made while the Fat List was being set up (2026-11-11). Runs only once.
    if (!(await db().get("once/votes-reset-2026-11-11"))) {
      await sql()`delete from votes`;
      await sql()`update coins set votes = 0 where votes <> 0`;
      await db().set("once/votes-reset-2026-11-11", String(Date.now()));
      console.log("test votes cleared");
    }
  } catch (e) { console.error("vote reset failed", e); }
  try {
    const r = await refreshMarket({ budgetMs: 20000 });
    const s = await buildSnapshot();
    console.log("market", JSON.stringify(r), "board", s.coins.length, "of", s.total);
  } catch (e) { console.error("market-refresh failed", e); }
  return new Response("ok");
};
