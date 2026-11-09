// Things players can unlock in Fathood Battlegrounds by burning $FATHOOD.
// CHANGE PRICES HERE.
//   usd: 1        -> costs $1 worth of $FATHOOD; the token amount follows the live price (DEX Screener)
//   price: 50000  -> a fixed amount of tokens instead (used only when there is no `usd`)
//   usd: null and no price -> "price coming soon" (burning is off)
// The game itself decides which rank is needed first; this list only knows the burn price.
export const ITEMS = {
  predator: { kind: "fighter", name: "Predator", usd: 1 },
};

export const CHAIN = {
  name: "Robinhood Chain",
  chainId: 4663,
  rpc: "https://rpc.mainnet.chain.robinhood.com",
  explorer: "https://robinhoodchain.blockscout.com",
  token: "0xf97bE5444346befC52571e7140394a4cC22B1111",
  symbol: "FATHOOD",
  decimals: 18,
  burn: "0x000000000000000000000000000000000000dEaD",
};
