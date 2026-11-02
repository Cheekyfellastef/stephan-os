import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  createBattleBridgeMainAdvanceSignal,
} from './battleBridgeMainAdvanceSignalV1.mjs';
import {
  BATTLE_BRIDGE_MAIN_ADVANCE_ARTIFACT_SCHEMA,
  BATTLE_BRIDGE_MAIN_ADVANCE_ARTIFACT_FILE,
  createBattleBridgeMainAdvanceArtifactV1,
} from './battleBridgeMainAdvanceArtifactV1.mjs';

const valid = () => createBattleBridgeMainAdvanceSignal({
  prNumber: 3286,
  mainHead: 'c456bc0a0c97c7b267c8b4916fcd82ad90f52f8c',
  mergedAtUtc: '2026-10-27T19:38:12Z',
  workflowRunId: '40570903048',
});
test('artifact projects exact source-bound main evidence, NOT native delivery or mailbox command', () => {
  const record = createBattleBridgeMainAdvanceArtifactV1(valid());
  assert.equal(record.schemaVersion, BATTLE_BRIDGE_MAIN_ADVANCE_ARTIFACT_SCHEMA);
  assert.equal(record.verifiedMainHead, 'c456bc0a0c97c7b267c8b4916fcd82ad90f52f8c');
  assert.equal(record.authenticatedWorkflowRunId, '40570903048');
  assert.equal(record.workflowRunUrl,
    'https://github.com/Cheekyfellastef/stephan-os/actions/runs/40570903048');
  assert.equal(record.publicationCarrier, 'GITHUB_ACTIONS_ARTIFACT');
  assert.equal(record.publicationState, 'LOCAL_ARTIFACT_STAGED');
  assert.equal(record.hostDeliveryState, 'UNKNOWN');
  for (const key of [
    'commentMailboxPublicationPerformed', 'sourceMutationAuthority',
    'nativeCommandAuthority', 'protectedMergeAuthority', 'nativeSyncReceived',
    'physicalHostPickupProven', 'exactHostHeadProven',
  ]) assert.equal(record[key], false, key);
  assert.equal(Object.hasOwn(record, 'issueNumber'), false);
  assert.equal(Object.isFrozen(record), true);
  assert.equal(BATTLE_BRIDGE_MAIN_ADVANCE_ARTIFACT_FILE, 'stephanos-main-advance-observation.json');
});
test('changed, replayable or caller-expanded source signal cannot be projected', () => {
  const signal = valid();
  for (const changed of [
    { ...signal, mainHead: 'f'.repeat(40), arbitraryShellAllowed: true },
    { ...signal, issueNumber: 3258 },
    { ...signal, syncAuthorityGranted: true },
    { ...signal, runtimeMutationAuthorityGranted: true },
    { ...signal, extraOperation: 'run shell' },
    { ...signal, workflowRunId: 'no-id' },
    { ...signal, repository: 'attacker/fork' },
    { ...signal, branch: 'feature' },
  ]) {
    assert.throws(() => createBattleBridgeMainAdvanceArtifactV1(changed),
      /MAIN_ADVANCE_ARTIFACT_SIGNAL_NOT_VERIFIED/);
  }
  assert.throws(() => createBattleBridgeMainAdvanceArtifactV1(null),
    /MAIN_ADVANCE_ARTIFACT_SIGNAL_NOT_VERIFIED/);
});
test('Actions publisher uses GET-only GitHub reads and never issues a command-mailbox POST', () => {
  const publisher = readFileSync('scripts/publish-battle-bridge-main-advance-signal.mjs', 'utf8');
  const workflow = readFileSync('.github/workflows/battle-bridge-main-advance-express-sync-v1.yml', 'utf8');
  assert.match(publisher, /createBattleBridgeMainAdvanceArtifactV1/);
  assert.match(publisher, /writeFileSync/);
  assert.match(publisher, /execFileSync\('git', \['rev-parse', 'HEAD'\]/);
  assert.match(publisher, /GITHUB_STEP_SUMMARY/);
  assert.doesNotMatch(publisher, /method:\s*['"]POST['"]/);
  assert.doesNotMatch(publisher, /\/issues\/\$\{.*\}\/comments/);
  assert.match(workflow, /uses: actions\/upload-artifact@v4/);
  assert.match(workflow, /retention-days: 30/);
  assert.match(workflow, /if-no-files-found: error/);
  assert.doesNotMatch(workflow, /issues:\s*write/);
  assert.doesNotMatch(workflow, /contents:\s*write/);
  assert.doesNotMatch(workflow, /workflow_dispatch:/);
  assert.doesNotMatch(workflow, /secrets\./);
});
