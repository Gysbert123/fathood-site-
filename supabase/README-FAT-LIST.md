# The Fat List v2: built for thousands of coins

Coins, payments and Hood Talk now live in a Postgres database (Supabase). Two background jobs keep it fresh:
- market-refresh: every 15 minutes, updates prices for up to ~1,800 coins from DexScreener and rebuilds the board.
- index-chains: every 30 minutes, pulls every new Robinhood Chain coin from GeckoTerminal (plus trending ones).
Auto-listed coins appear on the board once they have $3,000 liquidity. Below that they still show up in search.
Teams claim an auto-listed coin through "Add coin" (or the "Claim it" link on its page); you approve claims in the admin.

Tested on Postgres 16 with 20,000 coins: board load 1 ms (cached snapshot), search ~40 ms, coin page ~4 ms.

## One-time setup (about 15 minutes)
1. Create a free project at supabase.com. Pick the region closest to your Netlify site (usually US East).
2. Supabase > SQL Editor > New query: paste all of supabase/fatlist-schema.sql and press Run.
3. Supabase > Connect (top bar) > "Transaction pooler" > copy the URI (port 6543) and put your database password in it.
4. Netlify > Site configuration > Environment variables, add:
   - DATABASE_URL = that pooler URI
   - PAY_WALLET, ADMIN_PASSWORD (already set), ETH_RPC_URL (optional)
5. package.json dependencies: add "postgres": "3.4.9" and keep "viem": "2.57.12" and @netlify/blobs. See package.json.example.
6. Replace public/ and netlify/ with the ones in this folder (delete the old netlify/functions/*.mjs for the Fat List first).
7. Push / redeploy. Netlify picks up the two scheduled jobs automatically (Site > Logs > Functions shows them running).
8. Within a few minutes the board fills with Robinhood Chain coins. Check fathood.org/admin.html (one login for the Wall of Fat and the Fat List).

Keep the Supabase database password and DATABASE_URL secret: they give full access to the data.
The tables have row-level security switched on, so Supabase's public API can't read them; only your Netlify functions can.

## What's where
- supabase/fatlist-schema.sql                       database tables (safe to run again)
- netlify/lib/coinlist.mjs           ALL PRICES AND SETTINGS (packages, boosts, liquidity thresholds, chains to auto-list)
- netlify/lib/db.mjs                 database connection and shared queries
- netlify/lib/market.mjs             price refresh and board snapshot
- netlify/lib/lookup.mjs             contract-address auto-fill
- netlify/functions/fatlist.mjs      /api/fatlist  board, search (?q=), coin pages, add/claim coin, votes
- netlify/functions/fatpay.mjs       /api/fatpay   quotes and on-chain payment checks
- netlify/functions/talk.mjs         /api/talk     Hood Talk
- netlify/functions/fatlist-admin.mjs /api/fatlist-admin
- netlify/functions/logo.mjs         /api/logo/<id>
- netlify/functions/market-refresh.mjs  scheduled, every 15 minutes
- netlify/functions/index-chains.mjs    scheduled, every 30 minutes

## Costs
Supabase free tier holds this comfortably at launch (500 MB database). 20,000 coins plus orders and posts is roughly 20–30 MB.
The scheduled jobs run about 150 times a day on Netlify (slowed down on purpose to save credits); check Site > Usage after the first week.

## Payment safety (unchanged)
A payment only counts if it succeeded on-chain, has 2 confirmations (3 on Ethereum), was sent after the quote, came from the
wallet that asked for the quote, went to PAY_WALLET, was at least the quoted amount, and wasn't used for another order
(the database enforces that last one).
