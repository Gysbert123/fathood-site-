// Runs every 30 minutes (kept slow to save Netlify credits): refreshes prices from DexScreener, then rebuilds the board everyone loads.
import { refreshMarket, buildSnapshot } from "../lib/market.mjs";
import { sql } from "../lib/db.mjs";
import { db } from "../lib/coinlist.mjs";

export const config = { schedule: "*/30 * * * *" };

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
    // One-off: fix coin names saved with HTML codes in them ("S&amp;P 500" -> "S&P 500"). Runs only once.
    if (!(await db().get("once/name-codes-2026-11-20"))) {
      const fix = (col) => sql()`update coins set ${sql()(col)} = replace(replace(replace(replace(${sql()(col)}, '&amp;', '&'), '&#39;', chr(39)), '&quot;', '"'), '&#x27;', chr(39))
        where ${sql()(col)} ~ '&(amp|#39|quot|#x27);'`;
      const a = await fix("name"), b = await fix("symbol");
      await db().set("once/name-codes-2026-11-20", String(Date.now()));
      console.log("fixed names", a.count, "symbols", b.count);
    }
  } catch (e) { console.error("name fix failed", e); }
  try {
    const r = await refreshMarket({ budgetMs: 20000 });
    const s = await buildSnapshot();
    console.log("market", JSON.stringify(r), "board", s.coins.length, "of", s.total);
  } catch (e) { console.error("market-refresh failed", e); }
  return new Response("ok");
};
