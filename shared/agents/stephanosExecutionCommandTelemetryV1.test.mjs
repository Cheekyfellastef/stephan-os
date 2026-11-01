import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  STEPHANOS_EXECUTION_SURFACE,
  buildStephanosExecutionCommandEnvelopeV1,
  buildStephanosExecutionSurfaceCatalogV1,
} from './stephanosExecutionCommandFabricV1.mjs';
import {
  createStephanosExecutionCommandWorkspaceRecordsV1,
  publishStephanosExecutionCommandWorkspaceRecordsV1,
} from './stephanosExecutionCommandTelemetryV1.mjs';

const NOW = '2026-09-27T11:30:00.000Z';

function envelope() {
  return buildStephanosExecutionCommandEnvelopeV1({
    catalog: buildStephanosExecutionSurfaceCatalogV1({ repositoryRoot: 'C:\\repo' }),
    surface: STEPHANOS_EXECUTION_SURFACE.DESKTOP_COMMANDER,
    actionId: 'commander-proof-001',
    missionId: 'fabric-proof',
    relatedIssue: '#1',
    operation: 'GET_CONFIG',
  });
}

test('execution command telemetry distinguishes completed proof from authority', () => {
  const prepared = createStephanosExecutionCommandWorkspaceRecordsV1(envelope(), {
    ok: true,
    proofHash: 'a'.repeat(64),
    finalVerdict: 'DESKTOP_COMMANDER_MCP_TOOL_COMPLETED',
  }, { timestampUtc: NOW });
  assert.equal(prepared.ok, true);
  assert.equal(prepared.records.status.status, 'COMPLETED');
  assert.equal(prepared.records.proof.status, 'PASS');
  assert.equal(prepared.records.status.mergeAuthority, false);
  assert.equal(prepared.records.status.pcRestartAuthority, false);
  assert.equal(prepared.records.status.arbitraryUnboundedCommandAllowed, false);
  assert.equal(prepared.records.receipt.disposition, 'completed');
});
test('execution command telemetry atomically publishes status, proof and receipt', async () => {
  const root = await mkdtemp(join(tmpdir(), 'stephanos-command-telemetry-'));
  const result = await publishStephanosExecutionCommandWorkspaceRecordsV1(root, envelope(), {
    ok: true,
    proofHash: 'b'.repeat(64),
    finalVerdict: 'DESKTOP_COMMANDER_MCP_TOOL_COMPLETED',
  }, {
    timestampUtc: NOW,
    repoRoot: 'C:\\repo',
  });
  assert.equal(result.ok, true);
  assert.equal(result.writes.length, 3);
  for (const write of result.writes) assert.equal(write.ok, true);
  const proof = JSON.parse(await readFile(join(root, 'proof', result.recordId + '.json'), 'utf8'));
  const receipt = JSON.parse(await readFile(join(root, 'receipts', result.recordId + '.json'), 'utf8'));
  assert.equal(proof.proofHash, 'b'.repeat(64));
  assert.equal(receipt.executionVerdict, 'DESKTOP_COMMANDER_MCP_TOOL_COMPLETED');
});
