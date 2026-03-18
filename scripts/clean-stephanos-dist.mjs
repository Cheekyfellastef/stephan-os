import { cleanStephanosDist, stephanosDistRoot } from './stephanos-build-utils.mjs';

cleanStephanosDist();
console.log(`Removed generated Stephanos dist at ${stephanosDistRoot}.`);
