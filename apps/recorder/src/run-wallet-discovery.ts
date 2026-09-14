/**
 * Scores wallets by profit and loss over a window.
 *
 * Run with: npm run wallets --workspace=@ponseye/recorder -- [hours] [maxWallets]
 */
import { discoverWallets } from "./wallet-discovery.js";

const hours = Number(process.argv[2]);
const maxWallets = Number(process.argv[3]);
await discoverWallets({
  hours: Number.isFinite(hours) && hours > 0 ? hours : 24,
  maxWallets: Number.isFinite(maxWallets) && maxWallets > 0 ? maxWallets : 150,
});
process.exit(0);
