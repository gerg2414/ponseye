/**
 * Summarises bonding curve behaviour for every migrated token missing it.
 *
 * Run with: npm run curve --workspace=@ponseye/recorder
 */
import { backfillCurveStats } from "./curve.js";

await backfillCurveStats();
process.exit(0);
