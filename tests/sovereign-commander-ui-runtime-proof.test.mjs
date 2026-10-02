import assert from 'node:assert/strict';
import test from 'node:test';

import {
  evaluateVrAtlasStatusPillsObservation,
  parseUiRuntimeProofArgs,
  SOVEREIGN_COMMANDER_UI_RUNTIME_PROOF_PROFILE,
} from '../scripts/sovereign-commander-ui-runtime-proof.mjs';
import {
  classifyPostSyncRefresh,
  POST_SYNC_REFRESH_TARGETS,
} from '../shared/agents/postSyncRuntimeRefreshCoordinator.mjs';
import {
  createFixedPostSyncRuntimeAdapter,
} from '../scripts/battle-bridge-post-sync-refresh.mjs';
import {
  SOVEREIGN_COMMANDER_OPERATION,
  buildSovereignCommanderCommandV1,
} from '../shared/agents/sovereignCommanderV1.mjs';
import {
  STEPHANOS_EXECUTION_SURFACE,
  buildStephanosExecutionCommandEnvelopeV1,
  buildStephanosExecutionSurfaceCatalogV1,
} from '../shared/agents/stephanosExecutionCommandFabricV1.mjs';

function pill(label, overrides = {}) {
  return {
    label,
    compact: true,
    centered: true,
    textCentered: true,
    wrapContract: true,
    overflowFree: true,
    ...overrides,
  };
}

test('VR Atlas runtime proof accepts compact centered overflow-free status pills', () => {
  const result = evaluateVrAtlasStatusPillsObservation({
    pageTitleMatches: true,
    methodsGridVisible: true,
    pills: [
      pill('ACTIVE'),
      pill('NEW-SOURCE-EXTRACTION'),
      pill('REFERENCE-PROVEN'),
      pill('DESIGN-ACTIVE'),
    ],
  });
  assert.equal(result.accepted, true);
  assert.equal(result.pillCount, 4);
  assert.deepEqual(result.blockers, []);
});

test('VR Atlas runtime proof rejects the stretched ellipse regression', () => {
  const result = evaluateVrAtlasStatusPillsObservation({
    pageTitleMatches: true,
    methodsGridVisible: true,
    pills: [
      pill('ACTIVE', { compact: false, centered: false }),
      pill('NEW-SOURCE-EXTRACTION'),
      pill('REFERENCE-PROVEN'),
      pill('DESIGN-ACTIVE'),
    ],
  });
  assert.equal(result.accepted, false);
  assert.ok(result.blockers.includes('VR_ATLAS_STATUS_PILL_NOT_COMPACT:ACTIVE'));
  assert.ok(result.blockers.includes('VR_ATLAS_STATUS_PILL_NOT_CENTERED:ACTIVE'));
});

test('Commander UI proof profile remains closed-world', () => {
  assert.equal(parseUiRuntimeProofArgs([]).profile, SOVEREIGN_COMMANDER_UI_RUNTIME_PROOF_PROFILE);
  assert.equal(parseUiRuntimeProofArgs(['--profile', 'vr-atlas-status-pills']).profile, 'vr-atlas-status-pills');
  assert.throws(
    () => parseUiRuntimeProofArgs(['--profile', 'arbitrary-url']),
    /SOVEREIGN_COMMANDER_UI_RUNTIME_PROOF_PROFILE_NOT_ALLOWED/,
  );
  assert.throws(
    () => parseUiRuntimeProofArgs(['--url', 'https://example.com']),
    /SOVEREIGN_COMMANDER_UI_RUNTIME_PROOF_ARGUMENT_NOT_ALLOWED/,
  );
});

test('Atlas source changes automatically require UI refresh followed by browser proof', () => {
  const plan = classifyPostSyncRefresh(['apps/vr-capability-atlas/atlas-v2.css']);
  assert.equal(plan.automaticExecutionAllowed, true);
  assert.ok(plan.targetIds.includes(POST_SYNC_REFRESH_TARGETS.UI_4173));
  assert.ok(plan.targetIds.includes(POST_SYNC_REFRESH_TARGETS.VR_ATLAS_BROWSER_PROOF));
  assert.ok(
    plan.targetIds.indexOf(POST_SYNC_REFRESH_TARGETS.UI_4173)
      < plan.targetIds.indexOf(POST_SYNC_REFRESH_TARGETS.VR_ATLAS_BROWSER_PROOF),
  );
});

test('Commander registry binds the proof verb to one fixed source-controlled profile', () => {
  const repoRoot = 'C:\\Users\\Operator\\Documents\\GitHub\\stephan-os';
  const catalog = buildStephanosExecutionSurfaceCatalogV1({ repositoryRoot: repoRoot });
  const envelope = buildStephanosExecutionCommandEnvelopeV1({
    catalog,
    surface: STEPHANOS_EXECUTION_SURFACE.SOVEREIGN_COMMANDER,
    actionId: 'vr-atlas-proof-test',
    missionId: 'vr-atlas-proof-test',
    operation: SOVEREIGN_COMMANDER_OPERATION.MAINTENANCE_ACTION,
    targetPaths: [],
    payload: { actionId: 'prove-vr-atlas-runtime', command: 'arbitrary-shell-must-not-pass' },
  });
  const command = buildSovereignCommanderCommandV1(envelope, { repoRoot });
  assert.equal(command.dispatchAllowed, true);
  assert.equal(command.plan.kind, 'fixed-process');
  assert.equal(command.plan.processId, 'prove-vr-atlas-runtime');
  assert.ok(command.plan.args.some((arg) => String(arg).endsWith('sovereign-commander-ui-runtime-proof.mjs')));
  assert.deepEqual(command.plan.args.slice(-2), ['--profile', 'vr-atlas-status-pills']);
  assert.doesNotMatch(JSON.stringify(command.plan), /arbitrary-shell-must-not-pass/);
});

test('post-sync adapter accepts only exact-head passing Atlas browser proof receipts', () => {
  const head = 'a'.repeat(40);
  const paths = {
    repoRoot: '/tmp/stephan-os',
    vrAtlasProofScript: '/tmp/stephan-os/scripts/sovereign-commander-ui-runtime-proof.mjs',
  };
  const adapter = createFixedPostSyncRuntimeAdapter({
    spawnSyncFn(executable, args, options) {
      assert.equal(executable, process.execPath);
      assert.deepEqual(args, [
        paths.vrAtlasProofScript,
        '--profile',
        'vr-atlas-status-pills',
      ]);
      assert.equal(options.shell, false);
      assert.equal(options.windowsHide, true);
      return {
        status: 0,
        stdout: JSON.stringify({
          ok: true,
          profile: 'vr-atlas-status-pills',
          sourceHead: head,
          exactHeadProofOk: true,
          evidenceHash: 'b'.repeat(64),
          screenshotPath: '.stephanos/local-state-checkpoints/sovereign-ui-proof/proof.png',
          receiptPath: '.stephanos/local-state-checkpoints/sovereign-ui-proof/proof.json',
        }),
        stderr: '',
      };
    },
  });
  const result = adapter.proveVrAtlas({ afterHead: head, paths });
  assert.equal(result.ok, true);
  assert.equal(result.sourceHead, head);
  assert.equal(result.exactHeadProofOk, true);
  assert.equal(result.profile, 'vr-atlas-status-pills');
  assert.equal(result.evidenceHash, 'b'.repeat(64));
  assert.equal(result.screenshotCaptured, true);
  assert.equal(result.receiptCaptured, true);
});

test('post-sync adapter refuses stale-head Atlas browser proof', () => {
  const head = 'a'.repeat(40);
  const adapter = createFixedPostSyncRuntimeAdapter({
    spawnSyncFn() {
      return {
        status: 0,
        stdout: JSON.stringify({
          ok: true,
          profile: 'vr-atlas-status-pills',
          sourceHead: 'b'.repeat(40),
          exactHeadProofOk: true,
          evidenceHash: 'c'.repeat(64),
          screenshotPath: 'proof.png',
          receiptPath: 'proof.json',
        }),
        stderr: '',
      };
    },
  });
  const result = adapter.proveVrAtlas({
    afterHead: head,
    paths: { repoRoot: '/tmp/stephan-os', vrAtlasProofScript: '/tmp/proof.mjs' },
  });
  assert.equal(result.ok, false);
  assert.equal(result.exactHeadProofOk, false);
});
