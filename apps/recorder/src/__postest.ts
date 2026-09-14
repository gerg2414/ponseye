import { entrySignals, openPositions, updatePositions } from "./positions.js";
const signals = await entrySignals();
console.log("entry signals right now:", signals.length);
console.log("positions opened:", await openPositions(signals));
console.log("positions updated:", await updatePositions());
process.exit(0);
