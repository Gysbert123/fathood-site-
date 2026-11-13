// The Buy / Sell box: gets a swap quote from LI.FI so people can buy or sell a Fat List coin from their own wallet.
// No contract of ours and no custody: the person's wallet signs the swap, LI.FI does it, and the Fathood fee
// (BUY_FEE, default 0.25%) is sent straight to the fee wallets set up on portal.li.fi.
// Netlify settings: LIFI_INTEGRATOR (the integration string from portal.li.fi), LIFI_API_KEY (secret).
// Works on Robinhood Chain (MetaMask & co.) and Solana (Phantom).
import { sql, hit } from "../lib/db.mjs";
import { json, ipOf, clean, PAY_CHAINS } from "../lib/coinlist.mjs";

export const config = { path: "/api/buy" };

// What people can pay with / get back, per chain (address; for the chain's own coin LI.FI uses a special address)
export const BUY_WITH = {
  robinhood: {
    chainId: 4663, solana: false,
    tokens: {
      ETH: { address: "0x0000000000000000000000000000000000000000", decimals: 18, native: true },
      USDC: { address: "0x80e0e24718dbFcad49ECAA6F1e6C89A190586cA8", decimals: 6 },
      USDG: { address: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168", decimals: 6 },
    },
  },
  solana: {
    chainId: 1151111081099710, solana: true,
    tokens: {
      SOL: { address: "11111111111111111111111111111111", decimals: 9, native: true },
      USDC: { address: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", decimals: 6 },
    },
  },
};
const SLIPPAGES = [0.03, 0.05, 0.1, 0.15];
const EVM_RE = /^0x[a-fA-F0-9]{40}$/, SOL_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/, SIG_RE = /^[1-9A-HJ-NP-Za-km-z]{64,90}$/;
const addrOk = (C, a) => (C.solana ? SOL_RE : EVM_RE).test(a);

function feeRate() {
  const f = Number(process.env.BUY_FEE ?? 0.0025);
  return f >= 0 && f <= 0.03 ? f : 0.0025;
}

async function lifiQuote(params, withFee) {
  const qs = new URLSearchParams(params);
  qs.set("integrator", process.env.LIFI_INTEGRATOR || "fathood");
  if (withFee && feeRate() > 0) qs.set("fee", String(feeRate()));
  const headers = { accept: "application/json" };
  if (process.env.LIFI_API_KEY) headers["x-lifi-api-key"] = process.env.LIFI_API_KEY;
  const r = await fetch(`https://li.quest/v1/quote?${qs}`, { headers, signal: AbortSignal.timeout(9000) });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}

async function solRpc(method, params) {
  const r = await fetch(PAY_CHAINS.solana.rpc(), { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: AbortSignal.timeout(8000) });
  const j = await r.json();
  if (j.error) throw new Error(`${method}: ${j.error.message}`);
  return j.result;
}

// Solana helpers for the box (MetaMask-style wallets read these themselves; Phantom doesn't)
async function solana(b) {
  if (b.action === "status") {
    const sig = String(b.sig || "");
    if (!SIG_RE.test(sig)) return json({ error: "Unknown transaction." }, 400);
    const s = (await solRpc("getSignatureStatuses", [[sig], { searchTransactionHistory: false }]))?.value?.[0];
    if (!s) return json({ ok: true, status: "pending" });
    if (s.err) return json({ ok: true, status: "failed" });
    return json({ ok: true, status: s.confirmationStatus === "processed" ? "pending" : "confirmed" });
  }
  if (b.action === "balance") {
    const owner = String(b.owner || ""), mint = String(b.mint || "");
    if (!SOL_RE.test(owner) || (mint && !SOL_RE.test(mint))) return json({ error: "Unknown wallet." }, 400);
    if (!mint) return json({ ok: true, amount: String((await solRpc("getBalance", [owner, { commitment: "confirmed" }]))?.value ?? 0), decimals: 9 });
    const accts = (await solRpc("getTokenAccountsByOwner", [owner, { mint }, { encoding: "jsonParsed", commitment: "confirmed" }]))?.value || [];
    let amount = 0n, decimals = null;
    for (const a of accts) { const t = a.account?.data?.parsed?.info?.tokenAmount; if (t) { amount += BigInt(t.amount || "0"); decimals = t.decimals; } }
    if (decimals == null) { const m = (await solRpc("getAccountInfo", [mint, { encoding: "jsonParsed" }]))?.value?.data?.parsed?.info; decimals = m?.decimals ?? null; }
    return json({ ok: true, amount: amount.toString(), decimals });
  }
  return json({ error: "Unknown action." }, 400);
}

export default async (req, context) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    if (!(await hit("buyq", ipOf(context), 300))) return json({ error: "Too many price checks. Wait a few minutes and try again." }, 429);
    const b = await req.json().catch(() => ({}));
    const chain = String(b.chain || "robinhood"), C = BUY_WITH[chain];
    if (!C) return json({ error: "Buying on that chain isn’t available yet." }, 400);
    if (b.action) return C.solana ? await solana(b) : json({ error: "Unknown action." }, 400);

    const pay = C.tokens[String(b.pay || "")];
    if (!pay) return json({ error: "Pick what to pay with." }, 400);
    const from = String(b.from || "");
    if (!addrOk(C, from)) return json({ error: "Connect your wallet first." }, 400);
    const to = clean(b.token, 90);
    if (!addrOk(C, to)) return json({ error: "Unknown coin." }, 400);
    let amount;
    try { amount = BigInt(String(b.amount || "0")); } catch { amount = 0n; }
    if (amount <= 0n) return json({ error: "Enter an amount." }, 400);
    const slippage = SLIPPAGES.includes(Number(b.slippage)) ? Number(b.slippage) : 0.05;
    const sell = b.side === "sell"; // selling: the coin goes in, the chain's coin or USDC comes out

    // Only coins that are on the Fat List (not taken down) can be bought here.
    const [coin] = await sql()`select id, name, symbol, address from coins where chain = ${chain} and address_lc = ${to.toLowerCase()}
      and status in ('approved', 'indexed') limit 1`;
    if (!coin) return json({ error: "That coin isn’t on the Fat List, so it can’t be bought here." }, 404);

    const params = { fromChain: String(C.chainId), toChain: String(C.chainId), fromToken: sell ? coin.address : pay.address, toToken: sell ? pay.address : coin.address,
      fromAmount: amount.toString(), fromAddress: from, slippage: String(slippage), order: "CHEAPEST" };
    let q = await lifiQuote(params, true);
    // If the fee wallet isn't set up on portal.li.fi, LI.FI refuses a fee: still let people trade, just without it.
    let feeOn = true;
    if (q.body?.code === 1011) { q = await lifiQuote(params, false); feeOn = false; }
    if (q.status !== 200 || !q.body?.transactionRequest) {
      const m = String(q.body?.message || "");
      if (q.status === 404 || /no.*(route|quote)/i.test(m)) return json({ error: sell ? "No way to sell this coin for that right now. It may have too little liquidity. Try a smaller amount or another coin to get back."
        : "No way to buy this coin with that right now. It may have too little liquidity. Try a different amount or pay with something else." }, 404);
      return json({ error: "Couldn’t get a price just now. Try again in a moment." }, 502);
    }
    const d = q.body, e = d.estimate || {}, tr = d.transactionRequest;
    if (C.solana ? typeof tr.data !== "string" : Number(tr.chainId) !== C.chainId) return json({ error: "Couldn’t get a price just now. Try again in a moment." }, 502);
    return json({
      ok: true,
      quote: {
        side: sell ? "sell" : "buy", chain,
        coin: { id: coin.id, name: coin.name, symbol: coin.symbol, decimals: (sell ? d.action?.fromToken?.decimals : d.action?.toToken?.decimals) ?? 18 },
        fromDecimals: d.action?.fromToken?.decimals ?? 18, toDecimals: d.action?.toToken?.decimals ?? 18,
        toAmount: e.toAmount, toAmountMin: e.toAmountMin, fromAmountUSD: e.fromAmountUSD || null,
        // Solana has no separate "allow" step; on Robinhood Chain only tokens (not ETH) need one
        approvalAddress: C.solana || (!sell && pay.native) ? null : e.approvalAddress,
        route: d.toolDetails?.name || d.tool || "", feeOn, fathoodFee: feeOn ? feeRate() : 0,
        fees: (e.feeCosts || []).filter((f) => Number(f.percentage) > 0).map((f) => ({ name: f.name, percentage: Number(f.percentage) || 0, usd: f.amountUSD || null })),
        gasUSD: (e.gasCosts || []).reduce((s, g) => s + (Number(g.amountUSD) || 0), 0),
        tx: C.solana ? { data: tr.data } : { to: tr.to, data: tr.data, value: tr.value, gasLimit: tr.gasLimit || null, chainId: C.chainId },
        at: Date.now(),
      },
    });
  } catch (e) {
    console.error(e);
    return json({ error: "Couldn’t get a price just now. Try again in a moment." }, 502);
  }
};
