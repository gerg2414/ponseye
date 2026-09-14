/**
 * Extends snapshot outcomes with candles recorded since the last pass.
 *
 * Cheap by design: it reads only new candles, never the full history again.
 * Run with: npm run snapshots:refresh --workspace=@ponseye/recorder -- [tokens]
 */
import { refreshSnapshotOutcomes } from "./snapshots.js";

const requested = Number(process.argv[2]);
await refreshSnapshotOutcomes({ limit: Number.isFinite(requested) && requested > 0 ? requested : 400 });
process.exit(0);
