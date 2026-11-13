// The Buy button: gets a swap quote from LI.FI so people can buy a Fat List coin from their own wallet.
// No contract of ours and no custody: the buyer's wallet signs the swap, LI.FI's router does it, and the
// Fathood fee (BUY_FEE, default 0.25%) is sent straight to the fee wallet set up on portal.li.fi.
// Netlify settings (optional until set up): LIFI_INTEGRATOR (the name from portal.li.fi), LIFI_API_KEY.
import { sql, hit } from "../lib/db.mjs";
import { json, ipOf, clean } from "../lib/coinlist.mjs";

export const config = { path: "/api/buy" };

// What people can pay with, per chain (token address; 0x000… = the chain's own coin)
export const BUY_WITH = {
  robinhood: {
    chainId: 4663,
    tokens: {
      ETH: { address: "0x0000000000000000000000000000000000000000", decimals: 18 },
      USDC: { address: "0x80e0e24718dbFcad49ECAA6F1e6C89A190586cA8", decimals: 6 },
      USDG: { address: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168", decimals: 6 },
    },
  },
};
const SLIPPAGES = [0.03, 0.05, 0.1, 0.15];

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

export default async (req, context) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    if (!(await hit("buyq", ipOf(context), 150))) return json({ error: "Too many price checks. Wait a few minutes and try again." }, 429);
    const b = await req.json().catch(() => ({}));
    const chain = String(b.chain || "robinhood"), C = BUY_WITH[chain];
    if (!C) return json({ error: "Buying on that chain isn’t available yet." }, 400);
    const pay = C.tokens[String(b.pay || "")];
    if (!pay) return json({ error: "Pick what to pay with." }, 400);
    const from = String(b.from || "");
    if (!/^0x[a-fA-F0-9]{40}$/.test(from)) return json({ error: "Connect your wallet first." }, 400);
    const to = clean(b.token, 90);
    if (!/^0x[a-fA-F0-9]{40}$/.test(to)) return json({ error: "Unknown coin." }, 400);
    let amount;
    try { amount = BigInt(String(b.amount || "0")); } catch { amount = 0n; }
    if (amount <= 0n) return json({ error: "Enter an amount." }, 400);
    const slippage = SLIPPAGES.includes(Number(b.slippage)) ? Number(b.slippage) : 0.05;

    // Only coins that are on the Fat List (not taken down) can be bought here.
    const [coin] = await sql()`select id, name, symbol, address from coins where chain = ${chain} and address_lc = ${to.toLowerCase()}
      and status in ('approved', 'indexed') limit 1`;
    if (!coin) return json({ error: "That coin isn’t on the Fat List, so it can’t be bought here." }, 404);

    const params = { fromChain: String(C.chainId), toChain: String(C.chainId), fromToken: pay.address, toToken: coin.address,
      fromAmount: amount.toString(), fromAddress: from, slippage: String(slippage), order: "CHEAPEST" };
    let q = await lifiQuote(params, true);
    // Until the fee wallet is set up on portal.li.fi, LI.FI refuses a fee: still let people buy, just without it.
    let feeOn = true;
    if (q.body?.code === 1011) { q = await lifiQuote(params, false); feeOn = false; }
    if (q.status !== 200 || !q.body?.transactionRequest) {
      const m = String(q.body?.message || "");
      if (q.status === 404 || /no.*(route|quote)/i.test(m)) return json({ error: "No way to buy this coin with that right now. It may have too little liquidity. Try a different amount or pay with something else." }, 404);
      return json({ error: "Couldn’t get a price just now. Try again in a moment." }, 502);
    }
    const d = q.body, e = d.estimate || {}, tr = d.transactionRequest;
    if (Number(tr.chainId) !== C.chainId) return json({ error: "Couldn’t get a price just now. Try again in a moment." }, 502);
    return json({
      ok: true,
      quote: {
        coin: { id: coin.id, name: coin.name, symbol: coin.symbol, decimals: d.action?.toToken?.decimals ?? 18 },
        toAmount: e.toAmount, toAmountMin: e.toAmountMin, fromAmountUSD: e.fromAmountUSD || null,
        approvalAddress: pay.address === BUY_WITH[chain].tokens.ETH.address ? null : e.approvalAddress,
        route: d.toolDetails?.name || d.tool || "", feeOn, fathoodFee: feeOn ? feeRate() : 0,
        fees: (e.feeCosts || []).map((f) => ({ name: f.name, percentage: Number(f.percentage) || 0, usd: f.amountUSD || null })),
        gasUSD: (e.gasCosts || []).reduce((s, g) => s + (Number(g.amountUSD) || 0), 0),
        tx: { to: tr.to, data: tr.data, value: tr.value, gasLimit: tr.gasLimit || null, chainId: C.chainId },
        at: Date.now(),
      },
    });
  } catch (e) {
    console.error(e);
    return json({ error: "Couldn’t get a price just now. Try again in a moment." }, 502);
  }
};
