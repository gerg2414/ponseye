import type { Launch } from "./data";

const NATIVE_TOKEN = "0x0000000000000000000000000000000000000000";

const quoteAssets: Record<string, { symbol: string; decimals: number }> = {
  [NATIVE_TOKEN]: { symbol: "ETH", decimals: 18 },
  "0x5fc5360d0400a0fd4f2af552add042d716f1d168": { symbol: "USDG", decimals: 6 },
  "0xcec185eb182c47d1ba1efc84e6959e18cd620be4": { symbol: "cbBTC", decimals: 8 },
  "0xaf3d76f1834a1d425780943c99ea8a608f8a93f9": { symbol: "AAPL", decimals: 18 },
  "0x86923f96303d656e4aa86d9d42d1e57ad2023fdc": { symbol: "AMD", decimals: 18 },
  "0x12f190a9f9d7d37a250758b26824b97ce941bf54": { symbol: "AMZN", decimals: 18 },
  "0x6330d8c3178a418788df01a47479c0ce7ccf450b": { symbol: "COIN", decimals: 18 },
  "0x2e0847e8910a9732eb3fb1bb4b70a580adad4fe3": { symbol: "GOOGL", decimals: 18 },
  "0x1b0e319c6a659f002271b69db8a7df2f911c153e": { symbol: "GME", decimals: 18 },
  "0xc0d6457c16cc70d6790dd43521c899c87ce02f35": { symbol: "META", decimals: 18 },
  "0xe93237c50d904957cf27e7b1133b510c669c2e74": { symbol: "MSFT", decimals: 18 },
  "0xd0601ce157db5bdc3162bbac2a2c8af5320d9eec": { symbol: "NVDA", decimals: 18 },
  "0xd5f3879160bc7c32ebb4dc785f8a4f505888de68": { symbol: "QQQ", decimals: 18 },
  "0x117cc2133c37b721f49de2a7a74833232b3b4c0c": { symbol: "SPY", decimals: 18 },
  "0x322f0929c4625ed5bad873c95208d54e1c003b2d": { symbol: "TSLA", decimals: 18 },
};

export function quoteAsset(address: string | null) {
  return quoteAssets[address?.toLowerCase() ?? NATIVE_TOKEN] ?? { symbol: "PAIR", decimals: 18 };
}

export function launchMarket(launch: Launch) {
  const asset = quoteAsset(launch.pair_token_address);
  const volume = Number(launch.volume_quote_raw || 0) / 10 ** asset.decimals;
  const quote = Number(launch.last_quote_amount_raw || 0) / 10 ** asset.decimals;
  const tokens = Number(launch.last_token_amount_raw || 0) / 1e18;
  const price = tokens > 0 ? quote / tokens : 0;

  return { asset, volume, price, marketCap: price * 1_000_000_000 };
}

export function compact(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "—";
  return new Intl.NumberFormat("en-GB", {
    notation: value >= 1_000 ? "compact" : "standard",
    maximumFractionDigits: value >= 1 ? 2 : 4,
  }).format(value);
}

export function quoteValue(value: number, symbol: string) {
  if (!Number.isFinite(value) || value <= 0) return "—";
  if (symbol === "ETH") return `Ξ${compact(value)}`;
  if (symbol === "USDG") return `$${compact(value)}`;
  return `${compact(value)} ${symbol}`;
}
