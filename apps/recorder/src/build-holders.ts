/**
 * Measures holder distribution shortly after migration.
 *
 * Run with: npm run holders --workspace=@ponseye/recorder -- [maxTokens]
 */
import { backfillHolders } from "./holders.js";

const requested = Number(process.argv[2]);
await backfillHolders({ maxTokens: Number.isFinite(requested) && requested > 0 ? requested : Infinity });
process.exit(0);
