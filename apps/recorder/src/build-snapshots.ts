/**
 * Rebuilds the point-in-time snapshot table used for strategy research.
 *
 * Run with: npm run snapshots --workspace=@ponseye/recorder
 */
import { backfillSnapshots } from "./snapshots.js";

await backfillSnapshots();
process.exit(0);
