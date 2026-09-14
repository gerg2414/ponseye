/**
 * One-off repair: derive graduation prices for every row that is missing one or
 * whose stored value disagrees with its own inputs.
 *
 * Run with: npm run backfill:migration-prices --workspace=@ponseye/recorder
 */
import { backfillMigrationPrices } from "./bitquery-migration-test.js";

await backfillMigrationPrices();
process.exit(0);
