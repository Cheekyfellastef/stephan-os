#!/usr/bin/env node
import { fileURLToPath } from 'node:url';

import {
  BATTLE_BRIDGE_RUNTIME_DATA_PRESERVATION_OPERATION,
  executeBattleBridgeGitHubCommand,
} from '../shared/agents/battleBridgeGitHubCommandMailbox.mjs';
import {
  BATTLE_BRIDGE_RUNTIME_DATA_PRESERVATION_PROFILE,
} from '../shared/agents/battleBridgeDirtyDataPreservationV1.mjs';

const SHA = /^[0-9a-f]{40}$/;

function text(value) {
  return String(value ?? '').trim().toLowerCase();
}

function fail(blocker, details = {}) {
  return Object.freeze({
    ok: false,
    status: 'BLOCKED',
    verdict: 'FAIL',
    blocker,
    fileMovePerformed: false,
    destructiveCleanupPerformed: false,
    ...details,
  });
}

function observedPreservationEffects(result) {
  const records = [result, result?.result, result?.preservationSync]
    .flatMap((record) => [record, record?.preservation, record?.preservation?.receipt]);
  const observed = (field) => {
    if (records.some((record) => record?.[field] === true)) return true;
    if (records.some((record) => record?.[field] === false)) return false;
    return null;
  };
  return Object.freeze({
    fileMovePerformed: observed('fileMovePerformed'),
    destructiveCleanupPerformed: observed('destructiveCleanupPerformed'),
  });
}

export async function executeExactHeadBattleBridgePreservationSync(expectedHead = '', {
  executeCommand = executeBattleBridgeGitHubCommand,
} = {}) {
  const head = text(expectedHead);
  if (!SHA.test(head)) return fail('EXACT_HEAD_PRESERVATION_EXPECTED_HEAD_INVALID');
  if (typeof executeCommand !== 'function') return fail('EXACT_HEAD_PRESERVATION_EXECUTOR_INVALID');

  const result = await executeCommand({
    operation: BATTLE_BRIDGE_RUNTIME_DATA_PRESERVATION_OPERATION,
    requestId: `tailscale-bootstrap-${head.slice(0, 12)}`,
    operatorApproval: 'operator-approved',
    expectedHead: head,
    preservationProfile: BATTLE_BRIDGE_RUNTIME_DATA_PRESERVATION_PROFILE,
    preservationApproval: 'operator-approved',
  });
  const effects = observedPreservationEffects(result);
  if (!result?.ok) {
    return fail(String(result?.blocker || 'EXACT_HEAD_PRESERVATION_SYNC_BLOCKED'), {
      expectedHead: head,
      ...effects,
    });
  }

  const sync = result?.preservationSync || result?.result;
  if (sync?.ok !== true
      || text(sync?.afterHead) !== head
      || sync?.preservation?.ok !== true
      || Number(sync?.preservation?.receipt?.itemCount) !== 6
      || sync?.preservation?.receipt?.allHashesVerified !== true
      || sync?.preservation?.destructiveCleanupPerformed !== false
      || effects.destructiveCleanupPerformed !== false) {
    return fail('EXACT_HEAD_PRESERVATION_SYNC_INVALID', { expectedHead: head, ...effects });
  }

  return Object.freeze({
    ...sync,
    ...effects,
    expectedHead: head,
    exactHeadBound: true,
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = await executeExactHeadBattleBridgePreservationSync(process.argv[2] || '');
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.exitCode = result.ok ? 0 : 1;
}
