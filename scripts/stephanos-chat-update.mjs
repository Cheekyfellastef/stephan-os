#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import {
  runBattleBridgeDiagnostics,
  syncCodexDispatchBridge,
} from '../shared/agents/codexDispatchHostOps.mjs';
import { updateStephanosFromChat } from '../shared/agents/stephanosChatUpdate.mjs';

function parseArgs(argv = process.argv.slice(2)) {
  const [operation = ''] = argv;
  return {
    operation,
    operatorApproval: argv.includes('--operator-approved') ? 'operator-approved' : '',
    expectedBranch: 'main',
  };
}

export async function runStephanChatUpdateCli(argv = process.argv.slice(2), {
  updateFn = updateStephanosFromChat,
  syncFn = syncCodexDispatchBridge,
  diagnosticsFn = runBattleBridgeDiagnostics,
} = {}) {
  const args = parseArgs(argv);
  if (args.operation === 'update') {
    return updateFn({
      operatorApproval: args.operatorApproval,
      expectedBranch: args.expectedBranch,
    });
  }
  if (args.operation === 'sync') {
    return syncFn({
      operatorApproval: args.operatorApproval,
      expectedBranch: args.expectedBranch,
    });
  }
  if (args.operation === 'diagnostics') {
    return diagnosticsFn();
  }
  return {
    ok: false,
    status: 'BLOCKED',
    verdict: 'FAIL',
    blocker: 'UNKNOWN_OPERATION',
    usage: [
      'node scripts/stephanos-chat-update.mjs diagnostics',
      'node scripts/stephanos-chat-update.mjs sync --operator-approved',
      'node scripts/stephanos-chat-update.mjs update --operator-approved',
    ],
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const result = await runStephanChatUpdateCli();
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    process.exitCode = result?.ok ? 0 : 1;
  } catch (error) {
    process.stderr.write(`${error?.stack || error?.message || String(error)}\n`);
    process.exitCode = 1;
  }
}
