import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

const tilePath = path.resolve(path.dirname(new URL(import.meta.url).pathname), 'OpenClawTile.jsx');

test('OpenClawTile consumes final route truth projection and avoids canonical truth mutation surfaces', async () => {
  const source = await fs.readFile(tilePath, 'utf8');
  assert.equal(source.includes('finalRouteTruth'), true);
  assert.equal(source.includes('runtimeStatusModel'), true);
  assert.equal(source.includes('setRuntimeStatusModel'), false);
  assert.equal(source.includes('persistStephanosSessionMemory'), false);
  assert.equal(source.includes('runtimeStatusModel.runtimeTruth ='), false);
});


test('OpenClawTile validation button gating consumes shared endpoint-availability truth', async () => {
  const source = await fs.readFile(tilePath, 'utf8');
  assert.equal(source.includes('openClawReadonlyValidationEndpointAvailable'), true);
  assert.equal(source.includes('validationEndpointAvailable'), true);
});

test('OpenClawTile lifecycle messaging is driven by projected canonical control truth', async () => {
  const source = await fs.readFile(tilePath, 'utf8');
  assert.equal(source.includes("openClawControlNextAction || 'Keep proposal-only review path and collect evidence.'"), true);
  assert.equal(source.includes("(operatorTask?.openClawPauseState || pauseStateUi) === 'paused'"), true);
  assert.equal(source.includes('validationSucceeded ? ('), true);
  assert.equal(source.includes('openClawOperatorReviewHandoff'), true);
});

test('OpenClawTile renders control harness governance section copy', async () => {
  const source = await fs.readFile(tilePath, 'utf8');
  assert.equal(source.includes('OpenClaw Control Harness'), true);
  assert.equal(source.includes('Governance scaffolding only for future operator-reviewed stages'), true);
  assert.equal(source.includes('Permission envelope status:'), true);
  assert.equal(source.includes('Execution allowed:'), true);
});

test('OpenClawTile renders operator review queue and copy packet affordance', async () => {
  const source = await fs.readFile(tilePath, 'utf8');
  assert.equal(source.includes('OpenClaw Operator Review Queue'), true);
  assert.equal(source.includes('Copy active review packet'), true);
  assert.equal(source.includes('This queue is for human/ChatGPT/Codex review only.'), true);
  assert.equal(source.includes('Risk classification:'), true);
  assert.equal(source.includes('Rollback preview:'), true);
  assert.equal(source.includes('Permission diff:'), true);
  assert.equal(source.includes('Approval requirements:'), true);
  assert.equal(source.includes('Audit preview:'), true);
});

test('OpenClawTile reduces duplicate submit-for-review copy', async () => {
  const source = await fs.readFile(tilePath, 'utf8');
  const matches = source.match(/Submit packet for operator review/g) || [];
  assert.equal(matches.length <= 2, true);
});

test('OpenClawTile renders Codex Proposal Export section and packet-specific copy text', async () => {
  const source = await fs.readFile(tilePath, 'utf8');
  assert.equal(source.includes('Codex Proposal Export'), true);
  assert.equal(source.includes('Copy Codex prompt ('), true);
  assert.equal(source.includes('openClawCodexProposalExport'), true);
});



test('OpenClawTile shows codex prompt preview before copy and keeps it read-only/selectable', async () => {
  const source = await fs.readFile(tilePath, 'utf8');
  assert.equal(source.includes('Codex Prompt Preview'), true);
  assert.equal(source.includes('<textarea'), true);
  assert.equal(source.includes('readOnly'), true);
  assert.equal(source.includes('aria-readonly="true"'), true);
  assert.equal(source.includes('Copy Codex prompt ('), true);
});

test('OpenClawTile copies canonical codex preview text and uses canonical copy feedback', async () => {
  const source = await fs.readFile(tilePath, 'utf8');
  assert.equal(source.includes('codexPromptText = operatorTask?.openClawCodexProposalExport?.codexPrompt'), true);
  assert.equal(source.includes('await navigator.clipboard.writeText(codexPromptText);'), true);
  assert.equal(source.includes("setCodexExportCopyStatus('copied')"), true);
  assert.equal(source.includes('Codex prompt copied.'), true);
});

test('OpenClawTile risk treatment is derived from canonical risk classification with green/amber/red labels', async () => {
  const source = await fs.readFile(tilePath, 'utf8');
  assert.equal(source.includes('getCodexExportRiskPresentation(operatorTask?.openClawProposalRisk?.riskLevel)'), true);
  assert.equal(source.includes('openclaw-codex-preview--low'), true);
  assert.equal(source.includes('openclaw-codex-preview--guarded'), true);
  assert.equal(source.includes('openclaw-codex-preview--high'), true);
  assert.equal(source.includes('Risk: low'), true);
  assert.equal(source.includes('Risk: guarded'), true);
  assert.equal(source.includes('Risk: blocked'), true);
});

test('OpenClawTile blocked/high-risk proposals render warning while execution stays disabled', async () => {
  const source = await fs.readFile(tilePath, 'utf8');
  assert.equal(source.includes('Blocked / do not execute.'), true);
  assert.equal(source.includes('Execution remains disabled.'), true);
  assert.equal(source.includes('Execution allowed:</strong> no'), true);
});
