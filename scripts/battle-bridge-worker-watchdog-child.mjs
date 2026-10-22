#!/usr/bin/env node
import process from 'node:process';

import { runBattleBridgeWorkerWatchdog } from './battle-bridge-worker-watchdog.mjs';

const result = await runBattleBridgeWorkerWatchdog();
process.stdout.write(`${JSON.stringify(result)}\n`);
process.exitCode = result?.ok === true ? 0 : 2;
