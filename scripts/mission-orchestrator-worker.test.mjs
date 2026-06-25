import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { executeCodexAction, executeOpenClawReadonlyAction, parseBridgeOutput, parseCodexJsonLines } from './mission-orchestrator-worker.mjs';

test('parses deterministic bridge and Codex JSONL output', () => {
  assert.equal(parseBridgeOutput('FINAL_VERDICT=PASS\n').FINAL_VERDICT, 'PASS');
  assert.deepEqual(parseCodexJsonLines('{"type":"thread.started"}\ndiagnostic\n'), [{ type: 'thread.started' }]);
});

test('executes Codex non-interactively and grounds approved source evidence', async () => {
  const worktreePath = await mkdtemp(join(tmpdir(), 'mission-codex-'));
  const claim = { processingPath: join(worktreePath, 'action.json') };
  const command = 'node --test focused.test.mjs';
  const result = await executeCodexAction({
    actionKind: 'agent-handoff', adapter: 'codex', actionId: 'codex-1', missionId: 'codex-test',
    worktreePath, allowedFiles: ['shared/agents/**'], requiredTests: [command], requiredEvidence: ['focused test output'],
  }, claim, {
    runCommand(executable, args) {
      if (executable === 'codex.exe') {
        writeFileSync(args[args.indexOf('--output-last-message') + 1], JSON.stringify({ success: true, summary: 'done', evidence: [{ requirement: 'focused test output', command }] }));
        return { status: 0, stdout: `${JSON.stringify({ type: 'thread.started', thread_id: 'thread-1' })}\n${JSON.stringify({ type: 'item.completed', item: { type: 'command_execution', command, status: 'completed', exit_code: 0 } })}\n`, stderr: '' };
      }
      if (args.includes('diff')) return { status: 0, stdout: 'shared/agents/example.mjs\n', stderr: '' };
      return { status: 0, stdout: '', stderr: '' };
    },
  });
  assert.equal(result.success, true);
  assert.deepEqual(result.changedFiles, ['shared/agents/example.mjs']);
  assert.match(result.evidenceReceipts[0].commandOutputHash, /^[a-f0-9]{64}$/);
});

test('OpenClaw remains read-only and only accepts existing Mission Runner proof', async () => {
  const missionRunnerRoot = await mkdtemp(join(tmpdir(), 'mission-openclaw-'));
  const proofRoot = join(missionRunnerRoot, 'proof', 'browser');
  await mkdir(proofRoot, { recursive: true });
  const proofPath = join(proofRoot, 'proof.json');
  await writeFile(proofPath, '{"pass":true}\n');
  const result = await executeOpenClawReadonlyAction({
    actionKind: 'agent-handoff', adapter: 'openclaw-readonly', actionId: 'openclaw-1', missionId: 'openclaw-test',
    repositoryRoot: missionRunnerRoot, requiredEvidence: ['browser proof'], browserProofRequired: true,
  }, { processingPath: join(missionRunnerRoot, 'action.json') }, {
    missionRunnerRoot,
    runCommand: () => ({ status: 0, stdout: JSON.stringify({ payloads: [{ text: JSON.stringify({ success: true, evidence: [{ requirement: 'browser proof', receiptPath: proofPath }] }) }], meta: { runId: 'run-1' } }), stderr: '' }),
  });
  assert.equal(result.success, true);
  assert.deepEqual(result.changedFiles, []);
  assert.equal(result.evidenceReceipts[0].receiptPath, 'proof/browser/proof.json');
});
