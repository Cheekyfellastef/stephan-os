#!/usr/bin/env node
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertBoundIgnitionHeadImmediatelyBeforeMutation,
  runIgnitionHousekeep,
} from './ignite-stephanos-local.mjs';

export function runSyncHousekeeperPreservingRuntime({
  assertHead = assertBoundIgnitionHeadImmediatelyBeforeMutation,
  housekeep = runIgnitionHousekeep,
} = {}) {
  assertHead();
  return housekeep({
    // Source sync cannot roll back the build still owned by the live server.
    preserveRuntimeDirt: true,
    dryRun: false,
    compact: true,
    debug: false,
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runSyncHousekeeperPreservingRuntime();
}
