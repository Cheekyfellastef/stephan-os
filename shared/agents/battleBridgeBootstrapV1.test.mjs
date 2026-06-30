import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BATTLE_BRIDGE_BOOTSTRAP_ACTIONS,
  BATTLE_BRIDGE_BOOTSTRAP_APPROVED_RESTART_ABSTRACTION,
  BATTLE_BRIDGE_SHARED_WORKSPACE_WINDOWS,
  buildBattleBridgeBootstrapContract,
  createBattleBridgeBootstrapActionRequest,
  evaluateBattleBridgeBootstrapProof,
} from './battleBridgeBootstrapV1.mjs';

test('contract exposes bounded health checks, proof fields, and no visible PowerShell primary UI', () => {
  const contract = buildBattleBridgeBootstrapContract();

  assert.equal(contract.healthChecks[BATTLE_BRIDGE_BOOTSTRAP_ACTIONS.CHECK_OPENCLAW_GATEWAY_HEALTH].port, 18789);
  assert.equal(contract.healthChecks[BATTLE_BRIDGE_BOOTSTRAP_ACTIONS.CHECK_STEPHANOS_BACKEND_HEALTH].port, 8787);
  assert.equal(contract.healthChecks[BATTLE_BRIDGE_BOOTSTRAP_ACTIONS.CHECK_STEPHANOS_UI_HEALTH].port, 4173);
  assert.equal(contract.workerRestartAbstraction.taskName, 'StephanosMissionOrchestratorWorker');
  assert.equal(contract.sharedWorkspaceWindows, BATTLE_BRIDGE_SHARED_WORKSPACE_WINDOWS);
  assert.equal(contract.guardrails.arbitraryShellAllowed, false);
  assert.equal(contract.guardrails.visiblePowerShellRequiredAsPrimaryUi, false);
});

test('worker-down is detected in deterministic local proof fields', () => {
  const proof = evaluateBattleBridgeBootstrapProof({
    WORKER_KILLED: true,
    SUPERVISOR_DETECTED_WORKER_DOWN: true,
  });

  assert.equal(proof.fields.WORKER_KILLED, true);
  assert.equal(proof.fields.SUPERVISOR_DETECTED_WORKER_DOWN, true);
  assert.equal(proof.success, false);
});

test('restart is requested only through allowlisted scheduled-task abstraction', () => {
  const request = createBattleBridgeBootstrapActionRequest({
    action: BATTLE_BRIDGE_BOOTSTRAP_ACTIONS.REQUEST_MISSION_ORCHESTRATOR_WORKER_RESTART,
    restartAbstraction: BATTLE_BRIDGE_BOOTSTRAP_APPROVED_RESTART_ABSTRACTION,
  });

  assert.equal(request.accepted, true);
  assert.equal(request.restartAbstraction.kind, 'windows-scheduled-task');
  assert.equal(request.restartAbstraction.taskName, 'StephanosMissionOrchestratorWorker');
  assert.equal(request.mutation, 'bounded-worker-restart-request');
});

test('arbitrary shell is rejected', () => {
  const request = createBattleBridgeBootstrapActionRequest({
    action: 'powershell.exe -NoProfile -Command Get-ChildItem Env:',
  });

  assert.equal(request.accepted, false);
  assert.equal(request.reason, 'BATTLE_BRIDGE_BOOTSTRAP_REJECTED_NON_ALLOWLISTED_ACTION');
});

test('proof is not success unless verification passes', () => {
  const proof = evaluateBattleBridgeBootstrapProof({
    WORKER_KILLED: true,
    SUPERVISOR_DETECTED_WORKER_DOWN: true,
    SUPERVISOR_RESTARTED_WORKER: true,
    WORKER_RECOVERED: false,
    WORKER_FROM_MAIN: true,
    PROOF_WRITTEN_TO_SHARED_WORKSPACE: true,
    VISIBLE_POWERSHELL_REQUIRED: false,
    restartAbstraction: BATTLE_BRIDGE_BOOTSTRAP_APPROVED_RESTART_ABSTRACTION,
  });

  assert.equal(proof.fields.SUPERVISOR_RESTARTED_WORKER, true);
  assert.equal(proof.fields.WORKER_RECOVERED, false);
  assert.equal(proof.success, false);
  assert.equal(proof.finalVerdict, 'REMOTE_BATTLE_BRIDGE_BOOTSTRAP_PROOF_BLOCKED');
});

test('visible PowerShell wall is not required as primary UI for success', () => {
  const proof = evaluateBattleBridgeBootstrapProof({
    WORKER_KILLED: true,
    SUPERVISOR_DETECTED_WORKER_DOWN: true,
    SUPERVISOR_RESTARTED_WORKER: true,
    WORKER_RECOVERED: true,
    WORKER_FROM_MAIN: true,
    PROOF_WRITTEN_TO_SHARED_WORKSPACE: true,
    VISIBLE_POWERSHELL_REQUIRED: false,
    restartAbstraction: BATTLE_BRIDGE_BOOTSTRAP_APPROVED_RESTART_ABSTRACTION,
  });

  assert.equal(proof.fields.VISIBLE_POWERSHELL_REQUIRED, false);
  assert.equal(proof.success, true);
  assert.equal(proof.finalVerdict, 'REMOTE_BATTLE_BRIDGE_BOOTSTRAP_PROOF_PASS');
});

test('shared workspace message is emitted', () => {
  const proof = evaluateBattleBridgeBootstrapProof({
    PROOF_WRITTEN_TO_SHARED_WORKSPACE: true,
  });

  assert.match(proof.sharedWorkspaceMessage, /Stephanos-openclaw-workspace/);
  assert.equal(proof.proofPathWindows.endsWith('battle-bridge-bootstrap-v1-proof.json'), true);
});
