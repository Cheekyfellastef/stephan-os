#!/usr/bin/env node
import {
  assertBoundIgnitionHeadImmediatelyBeforeMutation,
  runIgnitionHousekeep,
} from './ignite-stephanos-local.mjs';

assertBoundIgnitionHeadImmediatelyBeforeMutation();
runIgnitionHousekeep({
  dryRun: false,
  compact: true,
  debug: false,
});
