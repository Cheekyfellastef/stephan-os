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

test('OpenClawTile renders new pre-execution planning sections and future-gated controlled execution gate', async () => {
  const source = await fs.readFile(tilePath, 'utf8');
  assert.equal(source.includes('Codex Review Result Intake'), true);
  assert.equal(source.includes('Import Codex review result'), true);
  assert.equal(source.includes('Clear Codex review result'), true);
  assert.equal(source.includes('review evidence only'), true);
  assert.equal(source.includes('Codex Review Result'), true);
  assert.equal(source.includes('Implementation Planning Packet'), true);
  assert.equal(source.includes('Approval Gate Readiness'), true);
  assert.equal(source.includes('Dry-run Action Planning Preview'), true);
  assert.equal(source.includes('Controlled Execution Gate'), true);
  assert.equal(source.includes('controlledExecutionStatus'), true);
});

test('OpenClawTile mission card exposes always-visible operator controls', async () => {
  const source = await fs.readFile(tilePath, 'utf8');
  assert.equal(source.includes('OpenClaw Mission Card'), true);
  assert.equal(source.includes('Current stage:'), true);
  assert.equal(source.includes('Execution allowed:</strong> no'), true);
  assert.equal(source.includes('Risk level:'), true);
  assert.equal(source.includes('Top blocker/warning:'), true);
  assert.equal(source.includes('resolveMissionPrimaryOperatorAction'), true);
});

test('OpenClawTile stage resolver and progressive disclosure defaults are present', async () => {
  const source = await fs.readFile(tilePath, 'utf8');
  assert.equal(source.includes('resolveOpenClawCurrentStage'), true);
  assert.equal(source.includes('validation_required'), true);
  assert.equal(source.includes('future_execution_gated'), true);
  assert.equal(source.includes('open={stageState === \'current\'}'), true);
  assert.equal(source.includes('<summary>{stageId} ({stageState})</summary>'), true);
});

test('OpenClawTile mission primary operator action follows canonical current stage priority', async () => {
  const source = await fs.readFile(tilePath, 'utf8');
  assert.equal(source.includes("if (currentStage === 'future_execution_gated')"), true);
  assert.equal(source.includes('Keep execution disabled until future operator-approved execution design.'), true);
  assert.equal(source.includes("if (currentStage === 'evidence_needed' || missingEvidence.length > 0)"), true);
  assert.equal(source.includes('Collect missing evidence:'), true);
  assert.equal(source.includes("if (currentStage === 'operator_review') return 'Submit packet for operator review.';"), true);
  assert.equal(source.includes("if (currentStage === 'codex_review_intake') return 'Import Codex review result.';"), true);
  assert.equal(source.includes("if (currentStage === 'implementation_planning') return 'Review implementation planning packet.';"), true);
  assert.equal(source.includes("if (currentStage === 'approval_readiness') return 'Review approval gate readiness.';"), true);
  assert.equal(source.includes("if (currentStage === 'dry_run_preview') return 'Review dry-run preview.';"), true);
});


test('OpenClawTile applies local containment root and wraps action rows', async () => {
  const source = await fs.readFile(tilePath, 'utf8');
  assert.equal(source.includes('openclaw-section openclaw-tile-root openclaw-card'), true);
  assert.equal(source.includes('className="openclaw-tile-layout openclaw-tile-root"'), true);
  assert.equal(source.includes('className="openclaw-details-grid"'), true);
  assert.equal(source.includes('openclaw-status-card'), true);
  const wraps = source.match(/className="openclaw-button-row"/g) || [];
  assert.equal(wraps.length >= 4, true);
});

test('OpenClaw styles avoid viewport-width escapes and enforce safe authority grid min sizing', async () => {
  const stylesPath = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../styles.css');
  const styles = await fs.readFile(stylesPath, 'utf8');
  assert.equal(styles.includes('.openclaw-tile-layout'), true);
  assert.equal(styles.includes('repeat(auto-fit, minmax(min(280px, 100%), 1fr))'), true);
  assert.equal(styles.includes('.openclaw-status-card'), true);
  assert.equal(styles.includes('.openclaw-button-row {\n  display: flex;\n  flex-wrap: wrap;'), true);
});


test('OpenClaw tile avoids unsafe viewport width rules and keeps details pane as bounded full-width card', async () => {
  const source = await fs.readFile(tilePath, 'utf8');
  assert.equal(source.includes('openclaw-primary-details'), true);
  assert.equal(source.includes('100vw'), false);
});
