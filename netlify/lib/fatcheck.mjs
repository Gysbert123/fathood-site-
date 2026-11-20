// Fat Check: a plain-English safety check for a coin, from GoPlus Security (free, no key) plus our own liquidity number.
// Every check is green, yellow or red. The overall light is the worst one. Results are kept for 6 hours per coin.
import { getJSON, setJSON } from "./coinlist.mjs";

const EVM = { robinhood: 4663, ethereum: 1, bsc: 56, base: 8453, arbitrum: 42161, polygon: 137, avalanche: 43114, optimism: 10 };
const KEEP_MS = 6 * 3600000;
const on = (v) => String(v) === "1";
const pct = (v) => (v == null || v === "" || isNaN(Number(v)) ? null : Number(v) * 100);
const fmt = (n) => (n == null ? "?" : n >= 10 ? Math.round(n) + "%" : n.toFixed(1).replace(/\.0$/, "") + "%");
const RANK = { green: 0, yellow: 1, red: 2 };

export const fatCheckable = (chain) => chain === "solana" || chain in EVM;

async function goplus(chain, address) {
  const url = chain === "solana"
    ? `https://api.gopluslabs.io/api/v1/solana/token_security?contract_addresses=${encodeURIComponent(address)}`
    : `https://api.gopluslabs.io/api/v1/token_security/${EVM[chain]}?contract_addresses=${encodeURIComponent(address)}`;
  const r = await fetch(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error("GoPlus " + r.status);
  const j = await r.json();
  const res = j.result || {};
  return res[address] || res[address.toLowerCase()] || Object.values(res)[0] || null;
}

function liquidityCheck(liq) {
  if (liq == null) return { key: "liq", light: "yellow", label: "Liquidity", text: "We couldn’t see how much money is in the trading pool." };
  const usd = liq >= 1e6 ? `$${(liq / 1e6).toFixed(1)}M` : liq >= 1e3 ? `$${Math.round(liq / 1e3)}K` : `$${Math.round(liq)}`;
  if (liq < 3000) return { key: "liq", light: "red", label: "Liquidity", text: `Only ${usd} in the trading pool. Big buys or sells will move the price a lot, and it’s easy to drain.` };
  if (liq < 15000) return { key: "liq", light: "yellow", label: "Liquidity", text: `${usd} in the trading pool. That’s thin, so prices can swing hard.` };
  return { key: "liq", light: "green", label: "Liquidity", text: `${usd} in the trading pool.` };
}

function holderCheck(holders, skip) {
  const real = (holders || []).filter((h) => !skip(h)).slice(0, 10);
  if (!real.length) return null;
  const top = real.reduce((s, h) => s + (pct(h.percent) || 0), 0), one = pct(real[0].percent) || 0;
  const light = top > 50 || one > 20 ? "red" : top > 30 || one > 10 ? "yellow" : "green";
  return { key: "holders", light, label: "Who holds it", text: `The top ${real.length} wallets hold ${fmt(top)} of the supply (the biggest has ${fmt(one)}). Trading pools and locked wallets we can spot aren’t counted.${light === "red" ? " A few wallets could crash the price by selling." : ""}` };
}

function evmChecks(g) {
  const out = [];
  const buy = pct(g.buy_tax), sell = pct(g.sell_tax);
  if (on(g.is_honeypot) || on(g.cannot_sell_all) || on(g.cannot_buy) || (sell != null && sell >= 50)) {
    out.push({ key: "sell", light: "red", label: "Can you sell?", text: "Looks like a honeypot: buyers may not be able to sell, or can only sell a little." });
  } else if (sell == null) {
    // GoPlus only test-trades coins whose pool it can see; without that we can't promise anything
    out.push({ key: "sell", light: "yellow", label: "Can you sell?", text: "We couldn’t run a test sell on this coin yet. Try a small sell first." });
  } else {
    out.push({ key: "sell", light: "green", label: "Can you sell?", text: "A test sell worked. No honeypot found." });
  }
  const worst = Math.max(buy || 0, sell || 0);
  out.push({ key: "tax", light: buy == null && sell == null ? "yellow" : worst > 10 ? "red" : worst > 5 ? "yellow" : "green", label: "Tax",
    text: buy == null && sell == null ? "We couldn’t check the buy and sell tax." : `Buy tax ${fmt(buy || 0)}, sell tax ${fmt(sell || 0)}.` });

  const owner = String(g.owner_address || "");
  const renounced = !owner || /^0x0{40}$/i.test(owner) || /^0x0+dead$/i.test(owner);
  // what the owner can do (verbs), and other facts about the code
  const redP = [], yelP = [], redF = [], yelF = [];
  if (on(g.owner_change_balance)) redP.push("change people’s balances");
  if (on(g.can_take_back_ownership)) redP.push("take back ownership");
  if (on(g.hidden_owner)) redF.push("there’s a hidden owner");
  if (on(g.selfdestruct)) redF.push("the contract can destroy itself");
  if (!renounced) {
    if (on(g.is_mintable)) redP.push("make new coins");
    if (on(g.transfer_pausable)) redP.push("pause trading");
    if (on(g.slippage_modifiable) || on(g.personal_slippage_modifiable)) redP.push("change the tax");
    if (on(g.is_blacklisted)) yelP.push("block wallets");
    if (on(g.trading_cooldown)) yelP.push("limit how often you trade");
    if (on(g.anti_whale_modifiable)) yelP.push("change the max buy");
  }
  if (on(g.is_proxy)) yelF.push("the code can be swapped out later");
  if (String(g.is_open_source) === "0") yelF.push("the code isn’t public");
  if (on(g.external_call)) yelF.push("it calls outside contracts");
  const powers = [...redP, ...yelP], facts = [...redF, ...yelF];
  const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1);
  const text = [powers.length ? `The owner can ${powers.join(", ")}.` : "", facts.length ? cap(facts.join(", ")) + "." : ""].filter(Boolean).join(" ");
  out.push({ key: "control", light: redP.length || redF.length ? "red" : powers.length || facts.length ? "yellow" : "green", label: "Dev control",
    text: text || (renounced ? "Ownership is given up, and nothing risky was found in the code." : "Nothing risky was found in the code.") });

  const dev = pct(g.creator_percent);
  if (dev != null) out.push({ key: "dev", light: dev > 20 ? "red" : dev > 5 ? "yellow" : "green", label: "Dev’s bag",
    text: dev > 0 ? `The wallet that made the coin still holds ${fmt(dev)}.` : "The wallet that made the coin holds none of it now." });

  const h = holderCheck(g.holders, (x) => String(x.is_contract) === "1" || String(x.is_locked) === "1");
  if (h) out.push(h);
  return out;
}

function solanaChecks(g) {
  const out = [];
  const st = (x) => x && String(x.status) === "1";
  const freeze = st(g.freezable), frozen = String(g.default_account_state) === "2" || on(g.non_transferable);
  out.push(freeze || frozen
    ? { key: "sell", light: "red", label: "Can you sell?", text: "The creator can freeze wallets, so you might not be able to sell." }
    : { key: "sell", light: "green", label: "Can you sell?", text: "Nobody can freeze your coins." });
  const fee = g.transfer_fee && Object.keys(g.transfer_fee).length ? g.transfer_fee : null;
  const feePct = fee ? Number(fee.fee_rate ?? fee.current_fee_rate ?? 0) : 0;
  out.push({ key: "tax", light: feePct > 10 ? "red" : fee || (g.transfer_hook || []).length ? "yellow" : "green", label: "Tax",
    text: fee ? `Every transfer pays a fee${feePct ? ` of about ${fmt(feePct)}` : ""}.` : (g.transfer_hook || []).length ? "Transfers run extra code (a transfer hook)." : "No transfer fee." });
  const red = [], yellow = [];
  if (st(g.mintable)) red.push("make new coins");
  if (st(g.balance_mutable_authority)) red.push("change people’s balances");
  if (st(g.metadata_mutable)) yellow.push("change the name and logo");
  if (st(g.closable)) yellow.push("close the token");
  out.push({ key: "control", light: red.length ? "red" : yellow.length ? "yellow" : "green", label: "Dev control",
    text: red.length || yellow.length ? `The creator can still ${[...red, ...yellow].join(", ")}.` : "The creator gave up minting and freezing. Nothing risky found." });
  const h = holderCheck(g.holders, (x) => String(x.is_locked) === "1" || !!x.tag);
  if (h) out.push(h);
  return out;
}

const VERDICT = {
  green: "No red flags found. Still do your own research.",
  yellow: "Some things to watch. Read the checks before you buy.",
  red: "Big red flags. Be very careful with this one.",
};

export async function fatCheck(coin) {
  if (!fatCheckable(coin.chain)) return { supported: false };
  const key = `cache/fatcheck/${coin.chain}/${String(coin.address).toLowerCase()}`;
  const c = await getJSON(key).catch(() => null);
  const done = (data) => { const checks = [...data.checks, liquidityCheck(coin.liquidity)]; return { ...data, checks, verdict: data.ok ? verdict(checks) : null }; };
  if (c && Date.now() - c.at < KEEP_MS) return done(c.data);
  let g = null;
  try { g = await goplus(coin.chain, coin.address); } catch (e) { return c ? done(c.data) : { supported: true, ok: false, checks: [], verdict: null }; }
  const checks = g ? (coin.chain === "solana" ? solanaChecks(g) : evmChecks(g)) : [];
  const data = { supported: true, ok: !!g, at: Date.now(), holders: g ? Number(g.holder_count) || null : null, checks };
  await setJSON(key, { at: Date.now(), data }).catch(() => {});
  return done(data);
}

// Overall light and one-line verdict for a finished list of checks
export function verdict(checks) {
  const light = checks.reduce((w, c) => (RANK[c.light] > RANK[w] ? c.light : w), "green");
  return { light, text: VERDICT[light] };
}
