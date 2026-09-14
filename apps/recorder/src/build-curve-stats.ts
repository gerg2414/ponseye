/**
 * Summarises bonding curve behaviour for migrated tokens missing it.
 *
 * Run with: npm run curve --workspace=@ponseye/recorder -- [maxTokens]
 * Newest tokens first, so a partial run still covers the most complete outcomes.
 */
import { backfillCurveStats } from "./curve.js";

const requested = Number(process.argv[2]);
await backfillCurveStats({ maxTokens: Number.isFinite(requested) && requested > 0 ? requested : Infinity });
process.exit(0);
