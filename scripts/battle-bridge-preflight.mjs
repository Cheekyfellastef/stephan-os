#!/usr/bin/env node
import { runBattleBridgePreflightProduction } from '../shared/agents/battleBridgePreflightVerifier.mjs';

const result = await runBattleBridgePreflightProduction({ repoRoot: process.cwd() });
console.log(JSON.stringify(result, null, 2));
process.exit(result.status === 'PASS' ? 0 : 1);
