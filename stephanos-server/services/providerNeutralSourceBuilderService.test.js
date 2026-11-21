import { appendExecutionReceipt, createExecutionReceipt, readExecutionReceiptHistory } from '../../shared/agents/executionReceiptV1.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { produceProviderNeutralSourceBuildProposalV1, processNextProviderNeutralSourceBuild as buildSource } from './providerNeutralSourceBuilderService.js';
import { createMissionRecord, appendMissionEvent, readMissionRecord } from './missionOrchestratorStore.js';
import { publishMissionWorkerAction } from './missionOrchestratorWorkerService.js';
import { claimNextMissionWorkerItem } from './missionOrchestratorWorkerConsumer.js';
import { processNextStephanosNativeItem } from './missionOrchestratorWorkerConsumer.js';
import { exactElasticExternalGrant } from './criticalBacklogConveyorServiceCore.js';
import { forgeLifeboatProofRef } from '../../shared/agents/missionControllerCapacityRouterV1.mjs';
import { executeStephanosNativeAction } from './missionOrchestratorStephanosNativeExecutor.js';
import { admitCurrentOrdinaryFixtureV1, prepareOrdinaryGoalFixtureV1 } from './fixtures/currentOrdinarySourcePlanFixtureV1.mjs';

// Low-level goal-context fixtures deliberately use a noncanonical mission ID.
// They exercise model/context parsing without claiming a production mission
// admission. The real canonical producer/queue/claim tests below prove the
// independent authority and cancellation boundary.

// Existing edit fixtures describe a complete model message. Present them on the
// real streaming Response interface now used by the builder transport.
function processNextProviderNeutralSourceBuild(options) {
  const fetchFixture = options.localModelFetchImpl;
  return buildSource({ ...options, ...(fetchFixture ? { localModelFetchImpl: async (...args) => {
    const reply = await fetchFixture(...args);
    if (reply.body) return reply;
    return new Response(JSON.stringify({ ...await reply.json(), done: true }) + '\n',
      { status: reply.status || (reply.ok ? 200 : 500) });
  } } : {}) });
}

test('partial model stream cannot mutate source or satisfy a source receipt', async () => {
  const fx = await fixture(['node --check shared/agents/example.mjs']);
  fx.action.allowedFiles = ['shared/agents/example.mjs'];
  const original = await readFile(join(fx.repoRoot, 'shared/agents/example.mjs'), 'utf8');
  const edits = [{path: 'shared/agents/example.mjs', old: 'export const value = 1;', new: 'export const value = 2;'}];
  const result = await buildSource({
    preferredAdapter: 'foundry-forge', sharedWorkspaceRoot: fx.sharedWorkspaceRoot,
    readMissionRecord: async () => ({state: {missionId: fx.action.missionId, cancelled: false}}),
    repoRoot: fx.repoRoot, actionGrant: fx.actionGrant, runCommand: run,
    claimNext: async adapter => adapter === 'foundry-forge' ? fx.claim : null,
    localModelFetchImpl: async (_url, request) => {
      const sent = JSON.parse(request.body);
      assert.equal(sent.stream, true);
      assert.equal(sent.options.num_predict, 8192);
      assert.equal(sent.format.additionalProperties, false);
      assert.deepEqual(sent.format.required, ['edits', 'summary']);
      assert.deepEqual(sent.format.properties.edits.items.required, ['path', 'old', 'new']);
      assert.match(sent.messages[0].content, /smallest unique old-text anchors/);
      return new Response(JSON.stringify({done: false, message: {content: JSON.stringify({edits})}}) + '\n');
    },
    collectAgentWorkerResult: async () => ({state: {revision: 1}}),
  });
  assert.equal(result.success, false);
  assert.equal(result.failureStage, 'PROVIDER');
  assert.match(result.error, /MODEL_RESPONSE_INCOMPLETE/);
  assert.equal(result.providerCompleted, false);
  assert.equal(await readFile(join(fx.repoRoot, 'shared/agents/example.mjs'), 'utf8'), original);
  assert.equal(result.sourceArtifact ?? null, null);
});

test('model sees bounded required tests while their edit authority stays closed', async t => {
  for (const attemptTestEdit of [false, true]) await t.test(String(attemptTestEdit), async () => {
    const fx = await fixture(['node --test tests/acceptance.test.mjs']);
    fx.action.allowedFiles = ['shared/agents/example.mjs'];
    await mkdir(join(fx.repoRoot, 'tests'));
    const testSource = "import assert from 'node:assert/strict';\nimport { value } from '../shared/agents/example.mjs';\nassert.equal(value, 2, 'readonly-acceptance-marker');\n";
    await writeFile(join(fx.repoRoot, 'tests/acceptance.test.mjs'), testSource);
    assert.equal(run('git.exe', ['-C', fx.repoRoot, 'add', '.'], {cwd: fx.repoRoot}).status, 0);
    assert.equal(run('git.exe', ['-C', fx.repoRoot, 'commit', '-m', 'independent acceptance'], {cwd: fx.repoRoot}).status, 0);
    fx.actionGrant.sourceRevision = run('git.exe', ['-C', fx.repoRoot, 'rev-parse', 'HEAD'], {cwd: fx.repoRoot}).stdout.trim();
    const result = await processNextProviderNeutralSourceBuild({
      preferredAdapter: 'foundry-forge', sharedWorkspaceRoot: fx.sharedWorkspaceRoot,
      readMissionRecord: async () => ({state: {missionId: fx.action.missionId, cancelled: false}}),
      repoRoot: fx.repoRoot, actionGrant: fx.actionGrant, runCommand: run,
      claimNext: async adapter => adapter === 'foundry-forge' ? fx.claim : null,
      localModelFetchImpl: async (_url, request) => {
        const prompt = JSON.parse(request.body).messages[0].content;
        assert.match(prompt, /Read-only required-test context/);
        assert.match(prompt, /readonly-acceptance-marker/);
        const edit = attemptTestEdit
          ? {path: 'tests/acceptance.test.mjs', old: testSource, new: '// bypass\n'}
          : {path: 'shared/agents/example.mjs', old: 'export const value = 1;', new: 'export const value = 2;'};
        return {ok: true, json: async () => ({message: {content: JSON.stringify({edits: [edit], summary: 'bounded test-driven repair'})}})};
      },
      collectAgentWorkerResult: async () => ({state: {revision: 1}}),
    });
    assert.equal(result.success, !attemptTestEdit, result.error);
    assert.equal(await readFile(join(fx.repoRoot, 'tests/acceptance.test.mjs'), 'utf8'), testSource);
    if (attemptTestEdit) assert.match(result.error, /PROVIDER_NEUTRAL_SCOPE_VIOLATION/);
    else assert.equal(result.testsPassed, true);
  });
});

function run(executable, args, options = {}) {
  const childEnv = { ...(options.env || process.env) };
  delete childEnv.NODE_TEST_CONTEXT;
  const normalized = executable === 'git.exe'
    ? 'git'
    : executable === 'node.exe'
      ? process.execPath
      : executable;
  return spawnSync(normalized, args, {
    cwd: options.cwd,
    env: childEnv,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
  });
}

async function fixture(requiredTests = ['node --test focused.test.mjs']) {
  const parent = await mkdtemp(join(tmpdir(), 'forge-offline-builder-'));
  const repoRoot = join(parent, 'repo');
  const sharedWorkspaceRoot = join(parent, 'workspace');
  await mkdir(join(repoRoot, 'shared', 'agents'), { recursive: true });
  await mkdir(sharedWorkspaceRoot, { recursive: true });
  await writeFile(join(repoRoot, 'shared', 'agents', 'example.mjs'), 'export const value = 1;\n');
  await writeFile(join(repoRoot, 'focused.test.mjs'), [
    "import test from 'node:test';",
    "import assert from 'node:assert/strict';",
    "import { value } from './shared/agents/example.mjs';",
    "test('value is updated', () => assert.equal(value, 2));",
    '',
  ].join('\n'));
  for (const args of [
    ['init'],
    ['config', 'user.email', 'offline-builder@example.invalid'],
    ['config', 'user.name', 'Offline Builder Test'],
    ['add', '.'],
    ['commit', '-m', 'baseline'],
  ]) {
    const result = run('git.exe', ['-C', repoRoot, ...args], { cwd: repoRoot });
    assert.equal(result.status, 0, result.stderr);
  }
  const head = run('git.exe', ['-C', repoRoot, 'rev-parse', 'HEAD'], { cwd: repoRoot }).stdout.trim();
  const action = {
    actionKind: 'agent-handoff',
    adapter: 'foundry-forge',
    missionId: 'critical-3001-offline-forge',
    actionId: 'critical-3001-offline-forge-source-1',
    repository: 'Cheekyfellastef/stephan-os',
    repositoryRoot: repoRoot,
    worktreePath: repoRoot,
    branch: 'openclaw/offline-forge-unit-3001',
    operatorIntent: 'Make the bounded local source change.',
    intendedOutcome: 'The focused test passes.',
    allowedFiles: ['shared/agents/**'],
    requiredTests,
    requiredEvidence: ['focused test output'],
  };
  const actionGrant = {
    schemaVersion: 'stephanos.mission-worker-action-grant.v1',
    issueNumber: 3001,
    prNumber: null,
    sourceRevision: head,
    headSha: null,
  };
  const claim = {
    adapter: 'foundry-forge',
    processingPath: join(parent, 'claim.json'),
    item: { payload: action, actionGrant },
  };
  return { parent, repoRoot, sharedWorkspaceRoot, action, actionGrant, claim };
}

const PATCH = [
  'diff --git a/shared/agents/example.mjs b/shared/agents/example.mjs',
  '--- a/shared/agents/example.mjs',
  '+++ b/shared/agents/example.mjs',
  '@@ -1 +1 @@',
  '-export const value = 1;',
  '+export const value = 2;',
  '',
].join('\n');

async function canonicalSourceFixture(t, repository = 'Cheekyfellastef/stephan-os', adapter = 'foundry-forge', claimNow = true) {
  const fx = await fixture(['node --test shared/agents/example.test.mjs']);
  t.after(() => rm(fx.parent, { recursive: true, force: true }));
  await writeFile(join(fx.repoRoot, 'shared/agents/example.test.mjs'),
    "import assert from 'node:assert/strict'; import {value} from './example.mjs'; assert.equal(value,2);\n");
  assert.equal(run('git.exe', ['add', '.'], { cwd: fx.repoRoot }).status, 0);
  assert.equal(run('git.exe', ['commit', '-m', 'canonical retained behavior oracle'], { cwd: fx.repoRoot }).status, 0);
  const missionId = 'critical-3001-elastic-goal', branch = 'openclaw/elastic-goal-3001';
  assert.equal(run('git.exe', ['checkout', '-b', branch], { cwd: fx.repoRoot }).status, 0);
  const options = { root: join(fx.parent, 'missions'), queueRoot: join(fx.parent, 'queue'),
    sharedWorkspaceRoot: fx.sharedWorkspaceRoot, repoRoot: fx.repoRoot, env: {}, now: new Date() };
  await prepareOrdinaryGoalFixtureV1(missionId, options);
  await createMissionRecord({ ...fx.action, missionKind: 'implementation', missionId, branch, repository,
    allowedFiles: ['shared/agents/example.mjs', 'shared/agents/example.mjs/**'] }, options);
  await appendMissionEvent(missionId, { eventId: 'canonical-source-worktree', eventType: 'WORKTREE_READY',
    worktreePath: fx.repoRoot, clean: true, receipt: { receiptId: 'canonical-source-worktree-proof',
      requirement: 'isolated worktree', source: 'canonical-temp-git-fixture', evidenceType: 'command-output', verified: true, exitCode: 0 } }, options);
  const actual = await admitCurrentOrdinaryFixtureV1(t, missionId, options);
  options.actionGrant = exactElasticExternalGrant(actual.state, {
    route: adapter === 'stephanos-native' ? 'STEPHANOS_NATIVE' : 'FOUNDRY_FORGE', adapter,
    workerId: adapter === 'stephanos-native' ? 'stephanos-native-battle-bridge' : 'stephanos-forge-lifeboat-local',
    receiptId: 'canonical-context-fixture-capacity',
    proofRefs: [forgeLifeboatProofRef(actual.sourceHead)] }, actual.sourceHead, options.now);
  assert.equal((await publishMissionWorkerAction(actual.state, options)).published, true);
  const claim = claimNow ? await claimNextMissionWorkerItem(adapter, options) : null;
  if (claimNow) assert.ok(claim);
  return { ...fx, options, actual, claim };
}

test('actual ordinary authority and retained claim gate a useful temp-Git build and escrow', async t => {
  for (const fault of ['none', 'copied-processing', 'plan-substitution', 'kind-substitution',
    'source-contract-drift', 'canonical-cancellation', 'canonical-owner-revocation',
    'post-model-processing-drift']) await t.test(fault, async t => {
    const fx = await fixture(['node --test shared/agents/example.test.mjs']);
    t.after(() => rm(fx.parent, { recursive: true, force: true }));
    await writeFile(join(fx.repoRoot, 'shared/agents/example.test.mjs'),
      "import test from 'node:test'; import assert from 'node:assert/strict'; import {value} from './example.mjs'; test('required behavior',()=>assert.equal(value,2));\n");
    assert.equal(run('git.exe', ['add', '.'], { cwd: fx.repoRoot }).status, 0);
    assert.equal(run('git.exe', ['commit', '-m', 'retained behavior oracle'], { cwd: fx.repoRoot }).status, 0);
    const missionId = 'critical-3001-elastic-goal', branch = 'openclaw/elastic-goal-3001';
    assert.equal(run('git.exe', ['checkout', '-b', branch], { cwd: fx.repoRoot }).status, 0);
    const options = { root: join(fx.parent, 'missions'), queueRoot: join(fx.parent, 'queue'),
      sharedWorkspaceRoot: fx.sharedWorkspaceRoot, repoRoot: fx.repoRoot, env: {}, now: new Date() };
    await prepareOrdinaryGoalFixtureV1(missionId, options);
    await createMissionRecord({ ...fx.action, missionKind: 'implementation', missionId, branch, repositoryRoot: fx.repoRoot,
      allowedFiles: ['shared/agents/example.mjs', 'shared/agents/example.mjs/**'] }, options);
    await appendMissionEvent(missionId, { eventId: 'actual-source-worktree', eventType: 'WORKTREE_READY',
      worktreePath: fx.repoRoot, clean: true,
      receipt: { receiptId: 'actual-source-worktree-proof', requirement: 'isolated worktree', source: 'temp-git-fixture',
        evidenceType: 'command-output', verified: true, exitCode: 0 } }, options);
    const actual = await admitCurrentOrdinaryFixtureV1(t, missionId, options);
    const actionGrant = exactElasticExternalGrant(actual.state, { route: 'FOUNDRY_FORGE', adapter: 'foundry-forge',
      workerId: 'stephanos-forge-lifeboat-local', receiptId: 'actual-source-fixture-capacity',
      proofRefs: [forgeLifeboatProofRef(actual.sourceHead)] }, actual.sourceHead, options.now);
    options.actionGrant = actionGrant;
    const published = await publishMissionWorkerAction(actual.state, options);
    assert.equal(published.published, true, JSON.stringify(published));
    const claim = await claimNextMissionWorkerItem('foundry-forge', options);
    assert.ok(claim);
    if (fault === 'copied-processing') claim.processingPath = join(fx.parent, 'copied-processing.json');
    if (fault === 'plan-substitution') claim.item.actionGrant.sourcePlanFingerprint = '0'.repeat(64);
    if (fault === 'kind-substitution') {
      claim.item.actionGrant.sourcePlanKind = 'SEED_SELF';
      claim.item.payload.sourcePlanKind = 'SEED_SELF';
      claim.item.executionBinding.sourcePlanKind = 'SEED_SELF';
      await writeFile(claim.processingPath, JSON.stringify(claim.item));
    }
    if (fault === 'source-contract-drift') {
      const current = await readMissionRecord(missionId, options);
      await writeFile(current.statePath, JSON.stringify({ ...current.state, requiredTests: ['npm run stephanos:verify'] }));
    }
    let proposals = 0, commands = 0;
    const result = await buildSource({ ...options, preferredAdapter: 'foundry-forge',
      claimNext: async () => claim,
      localModelFetchImpl: async (_url, request) => {
        proposals++;
        assert.match(JSON.parse(request.body).messages[0].content,
          /Implement this existing ordinary bounded source contract\./,
          'actual canonical fixed goal reader must supply model context');
        if (fault === 'canonical-cancellation') await appendMissionEvent(missionId, {
          eventId: 'canonical-cancel-after-model', eventType: 'MISSION_CANCELLED',
          reason: 'Fixture cancels the original mission before any candidate source effect.',
        }, options);
        if (fault === 'canonical-owner-revocation') actual.authority.closed = true;
        if (fault === 'post-model-processing-drift') {
          const changed = structuredClone(claim.item);
          changed.payload.allowedFiles = ['shared/agents/unapproved.mjs'];
          await writeFile(claim.processingPath, JSON.stringify(changed));
        }
        return new Response(JSON.stringify({ done: true, message: { content: JSON.stringify({
          edits: [{ path: 'shared/agents/example.mjs', old: 'export const value = 1;', new: 'export const value = 2;' }],
          summary: 'Pass the retained behavior oracle.',
        }) } }) + '\n');
      },
      runCommand: (...args) => { commands++; return run(...args); } });
    if (fault !== 'none') {
      assert.equal(result.success, false);
      if (fault === 'canonical-cancellation') {
        assert.equal(proposals, 1, 'the genuine canonical model response precedes cancellation');
        assert.match(result.error, /ORIGINAL_SOURCE_ATTEMPT_FENCED/);
        assert.equal((await readMissionRecord(missionId, options)).state.currentPhase, 'CANCELLED');
      } else if (['canonical-owner-revocation', 'post-model-processing-drift'].includes(fault)) {
        assert.equal(proposals, 1, 'fresh actual source admission is rechecked after the model reply');
        assert.match(result.error, /SOURCE_SCOPE_RECONCILIATION_REQUIRED/);
      } else {
        assert.equal(proposals, 0, 'unproven authority must stop before proposal/model');
        assert.equal(commands, 0, 'unproven authority must stop before source/test commands');
      }
      assert.equal(await readFile(join(fx.repoRoot, 'shared/agents/example.mjs'), 'utf8'), 'export const value = 1;\n');
      assert.equal(result.sourceArtifact ?? null, null);
      return;
    }
    assert.equal(result.success, true, result.error);
    assert.equal(result.testsPassed, true);
    assert.equal(proposals, 1);
    assert.match(await readFile(join(fx.repoRoot, 'shared/agents/example.mjs'), 'utf8'), /value = 2/);
    const artifact = /^shared-workspace:\/\/source-artifacts\/([0-9a-f]{64})\.json$/.exec(result.sourceArtifactRef);
    assert.ok(artifact, JSON.stringify(result));
    const bundle = JSON.parse(await readFile(join(fx.sharedWorkspaceRoot, 'source-artifacts', artifact[1] + '.json'), 'utf8'));
    assert.equal(bundle.missionId, missionId);
    assert.equal(bundle.actionId, claim.item.actionId);
    assert.equal(bundle.canonicalBranch, branch);
    assert.equal(bundle.exactParentHead, actual.sourceHead);
    assert.deepEqual(bundle.testsRun, ['node --test shared/agents/example.test.mjs']);
    const history = await readExecutionReceiptHistory(fx.sharedWorkspaceRoot,
      { executionId: claim.item.actionId }, { repoRoot: fx.repoRoot });
    assert.equal(history.latestReceipt.state, 'completed');
    assert.equal((await readMissionRecord(missionId, options)).state.dispatch.status, 'complete');
  });
});

test('actual ordinary Native parent revalidates owner authority after model await before staging or source effects', async t => {
  const fx = await canonicalSourceFixture(t, 'Cheekyfellastef/stephan-os', 'stephanos-native');
  let modelCalls = 0, testCalls = 0;
  const grant = fx.options.actionGrant;
  await assert.rejects(executeStephanosNativeAction(fx.claim.item.payload, fx.claim, { ...fx.options,
    testOnly: true,
    readVerifiedCandidate: async () => ({ ok: true, candidate: {
      route: 'STEPHANOS_NATIVE', adapter: 'stephanos-native', workerId: grant.workerId,
      provider: 'ollama-local', transport: 'http-loopback-fixed',
      capacityReceiptId: grant.capacityReceiptId, sourceHead: grant.sourceRevision,
      repository: 'Cheekyfellastef/stephan-os', endpoint: 'http://127.0.0.1:11434', model: 'test-only:14b',
    } }),
    runCommand: (executable, args, options) => {
      if (executable === process.execPath && args[0] === '--test') testCalls++;
      return run(executable, args, options);
    },
    fetchImpl: async () => {
      modelCalls++; fx.actual.authority.closed = true;
      return { ok: true, status: 200, text: async () => JSON.stringify({ model: 'test-only:14b', message: {
        content: JSON.stringify({ schemaVersion: 'stephanos.native-model-result.v1',
          missionId: fx.claim.item.missionId, actionId: fx.claim.item.actionId,
          baseHead: grant.sourceRevision, replacements: [{ path: 'shared/agents/example.mjs',
            beforeSha256: '0'.repeat(64), content: 'export const value = 2;\n' }], summary: 'uncommitted reply' }),
      } }) };
    },
  }), /SOURCE_SCOPE_RECONCILIATION_REQUIRED/);
  assert.equal(modelCalls, 1);
  assert.equal(testCalls, 0);
  assert.equal(await readFile(join(fx.repoRoot, 'shared/agents/example.mjs'), 'utf8'), 'export const value = 1;\n');
  assert.equal(existsSync(join(fx.sharedWorkspaceRoot, 'native-staging')), false);
  // This fixture proves the real JS parent boundary; it does not qualify
  // production source-test credential isolation or the compiled child route.
});

test('actual Native post-promotion withdrawal preserves the original owner and durable unknown-source recovery record', async t => {
  for (const fault of ['owner-revocation', 'cancellation', 'processing-drift']) await t.test(fault, async t => {
    const fx = await canonicalSourceFixture(t, 'Cheekyfellastef/stephan-os', 'stephanos-native', false);
    const grant = fx.options.actionGrant, before = await readFile(join(fx.repoRoot, 'shared/agents/example.mjs'), 'utf8');
    let models = 0, testBoundaries = 0;
    const initial = (await readMissionRecord(grant.missionId, fx.options)).state;
    const result = await processNextStephanosNativeItem({ ...fx.options,
      executeStephanosNativeAction: (action, claim) => executeStephanosNativeAction(action, claim, {
        ...fx.options, testOnly: true,
        readVerifiedCandidate: async () => ({ ok: true, candidate: {
          route: 'STEPHANOS_NATIVE', adapter: 'stephanos-native', workerId: grant.workerId,
          provider: 'ollama-local', transport: 'http-loopback-fixed', model: 'test-only:14b',
          capacityReceiptId: grant.capacityReceiptId, sourceHead: grant.sourceRevision,
          repository: action.repository, endpoint: 'http://127.0.0.1:11434',
        } }),
        readSourceMutationLease: async () => ({ ok: true, present: false }),
        runCommand: (executable, args, options) => {
          if (executable !== process.execPath || args[0] !== '--test') return run(executable, args, options);
          return (async () => {
            testBoundaries++;
            assert.match(await readFile(join(fx.repoRoot, 'shared/agents/example.mjs'), 'utf8'), /value = 2/);
            if (fault === 'owner-revocation') fx.actual.authority.closed = true;
            if (fault === 'cancellation') await appendMissionEvent(grant.missionId, {
              eventId: 'cancel-after-native-promotion', eventType: 'MISSION_CANCELLED', reason: 'Post-promotion fixture cancellation.',
            }, fx.options);
            if (fault === 'processing-drift') {
              const changed = structuredClone(claim.item); changed.payload.allowedFiles = ['shared/agents/unapproved.mjs'];
              await writeFile(claim.processingPath, JSON.stringify(changed));
            }
            return { status: 0, stdout: 'fixture test boundary; no external command executed', stderr: '' };
          })();
        },
        fetchImpl: async () => {
          models++;
          return { ok: true, status: 200, text: async () => JSON.stringify({ model: 'test-only:14b', message: {
            content: JSON.stringify({ schemaVersion: 'stephanos.native-model-result.v1', missionId: action.missionId,
              actionId: action.actionId, baseHead: grant.sourceRevision, summary: 'Bounded fixture candidate.',
              replacements: [{ path: 'shared/agents/example.mjs', beforeSha256: createHash('sha256').update(before).digest('hex'),
                content: 'export const value = 2;\n' }] }),
          } }) };
        },
      }),
    });
    assert.equal(models, 1); assert.equal(testBoundaries, 1);
    assert.equal(result.result.finalVerdict, 'MISSION_WORKER_ITEM_FAILED');
    assert.match(result.result.error, /SOURCE_SCOPE_RECONCILIATION_REQUIRED|ORIGINAL_SOURCE_ATTEMPT_FENCED/);
    const failure = result.result.sourceFailure;
    assert.equal(failure.sourceState, 'UNKNOWN'); assert.equal(failure.rollbackDisposition, 'REFUSED');
    assert.equal(failure.promotionDisposition, 'COMPLETED');
    assert.equal(failure.lastConfirmedSourceState, 'CANDIDATE_FILE_BYTES_OBSERVED');
    assert.equal(failure.recoveryRequired, true); assert.equal(failure.responsibilityRetained, true);
    assert.equal(failure.mutationAuthority, false); assert.equal(failure.observedSha256, '');
    assert.deepEqual(JSON.parse(await readFile(result.resultPath, 'utf8')).sourceFailure, failure);
    assert.match(await readFile(join(fx.repoRoot, 'shared/agents/example.mjs'), 'utf8'), /value = 2/,
      'lost authority never authorizes rollback');
    const current = (await readMissionRecord(grant.missionId, fx.options)).state;
    assert.equal(current.git.branch, initial.git.branch); assert.equal(current.git.worktreePath, initial.git.worktreePath);
    assert.deepEqual(current.allowedFiles, initial.allowedFiles); assert.deepEqual(current.repair, initial.repair);
    if (fault === 'cancellation') assert.equal(current.currentPhase, 'CANCELLED');
  });
});

test('general verification cannot substitute for a required independent behavior test outside edit scope', async t => {
  for (const candidateValue of [2, 3]) await t.test(candidateValue === 2 ? 'correct behavior is escrowed' : 'wrong behavior rolls back', async () => {
  const command = 'node --test tests/independent.test.mjs';
  const fx = await fixture(['npm run stephanos:verify', command]);
  await mkdir(join(fx.repoRoot, 'tests'));
  const oracle = "import assert from 'node:assert/strict'; import {value} from '../shared/agents/example.mjs'; assert.equal(value,2);\n";
  await writeFile(join(fx.repoRoot, 'tests', 'independent.test.mjs'), oracle);
  assert.equal(run('git.exe', ['add', '.'], { cwd: fx.repoRoot }).status, 0);
  assert.equal(run('git.exe', ['commit', '-m', 'Independent acceptance baseline'], { cwd: fx.repoRoot }).status, 0);
  fx.actionGrant.sourceRevision = run('git.exe', ['rev-parse', 'HEAD'], { cwd: fx.repoRoot }).stdout.trim();
  const testsRun = [];
  let independentResult;
  const result = await processNextProviderNeutralSourceBuild({
    preferredAdapter: 'foundry-forge', sharedWorkspaceRoot: fx.sharedWorkspaceRoot, repoRoot: fx.repoRoot,
    actionGrant: fx.actionGrant, claimNext: async () => fx.claim,
    readMissionRecord: async () => ({ state: { cancelled: false } }),
    generatePatch: async () => ({ patch: PATCH.replace('value = 2', `value = ${candidateValue}`), summary: 'Independent acceptance decides the candidate outcome.' }),
    runCommand: (executable, args, options) => {
      if (executable === 'node.exe' && args[0] === 'scripts/build-stephanos-ui.mjs') {
        return { status: 0, stdout: 'fixture general build PASS', stderr: '' };
      }
      if (executable === 'node.exe' && args[0] === 'scripts/verify-stephanos-dist.mjs') {
        testsRun.push('general'); return { status: 0, stdout: 'general PASS', stderr: '' };
      }
      if (executable === 'node.exe' && args[0] === '--test') {
        // A nested fixture must actually run node:test, rather than inheriting
        // the parent runner's recursive-test suppression marker.
        const childEnv = { ...(options.env || process.env) };
        delete childEnv.NODE_TEST_CONTEXT;
        testsRun.push('independent'); independentResult = run(executable, args, { ...options, env: childEnv }); return independentResult;
      }
      return run(executable, args, options);
    },
    collectAgentWorkerResult: async () => ({ state: { revision: 1 } }),
  });
  assert.deepEqual(testsRun, ['general', 'independent'], result.error);
  assert.equal(result.success, candidateValue === 2, JSON.stringify({ status: independentResult?.status,
    stdout: independentResult?.stdout?.slice(0, 600), stderr: independentResult?.stderr?.slice(0, 300) }));
  assert.equal(independentResult.status, candidateValue === 2 ? 0 : 1);
  assert.equal(await readFile(join(fx.repoRoot, 'tests', 'independent.test.mjs'), 'utf8'), oracle);
  if (candidateValue === 2) {
    assert.equal(result.testsPassed, true);
    assert.match(result.sourceArtifactRef, /^shared-workspace:\/\/source-artifacts\//);
    assert.equal((await readFile(join(fx.repoRoot, 'shared', 'agents', 'example.mjs'), 'utf8')).trim(), 'export const value = 2;');
  } else {
    assert.match(result.error, /TEST/);
    assert.equal((await readFile(join(fx.repoRoot, 'shared', 'agents', 'example.mjs'), 'utf8')).trim(), 'export const value = 1;');
    assert.equal(run('git.exe', ['status', '--porcelain'], { cwd: fx.repoRoot }).stdout.trim(), '');
  }
  });
});

test('local Forge builder edits, tests, escrows and queues source while offline publication remains zero-authority', async () => {
  const fx = await fixture();
  const collected = [];
  let generatePatchArgs;
  const result = await processNextProviderNeutralSourceBuild({
    preferredAdapter: 'foundry-forge',
    sharedWorkspaceRoot: fx.sharedWorkspaceRoot,
    readMissionRecord: async () => ({ state: { missionId: fx.action.missionId, cancelled: false } }),
    repoRoot: fx.repoRoot,
    actionGrant: fx.actionGrant,
    runCommand: run,
    claimNext: async (adapter) => adapter === 'foundry-forge' ? fx.claim : null,
    generatePatch: async (_action, context) => {
      generatePatchArgs = context;
      return { patch: PATCH, summary: 'Update the bounded value.' };
    },
    collectAgentWorkerResult: async (record) => { collected.push(record); return { state: { revision: 1 } }; },
  });
  assert.equal(result.processed, true);
  assert.equal(result.success, true, result.error);
  assert.equal(result.adapter, 'foundry-forge');
  assert.equal(result.testsPassed, true);
  assert.match(result.sourceArtifactRef, /^shared-workspace:\/\/source-artifacts\//);
  assert.match(result.offlinePublicationOutboxId, /^offline-publication-/);
  assert.equal(result.preservationVerdict, 'PROVIDER_NEUTRAL_SOURCE_ESCROWED_FOR_OFFLINE_PUBLICATION');
  assert.equal(collected.length, 1);
  assert.equal(collected[0].success, true);
  assert.equal(collected[0].sourceArtifactEscrow?.schemaVersion, 'stephanos.source-artifact-escrow.v1');
  assert.equal(collected[0].offlinePublicationOutbox?.schemaVersion, 'stephanos.offline-publication-outbox.v1');
  assert.equal(collected[0].offlinePublicationOutbox?.completeArtifactSha256,
    collected[0].sourceArtifactEscrow?.completeArtifactSha256);
  assert.equal(
    (await readFile(join(fx.repoRoot, 'shared', 'agents', 'example.mjs'), 'utf8')).replace(/\r\n/g, '\n'),
    'export const value = 2;\n',
  );
  // Verify sourceSnapshots are passed to generatePatch
  assert.ok(generatePatchArgs.sourceSnapshots);
  assert.equal(generatePatchArgs.sourceSnapshots.length, 1);
  assert.equal(generatePatchArgs.sourceSnapshots[0].path, 'shared/agents/example.mjs');
  assert.equal(generatePatchArgs.sourceSnapshots[0].content, 'export const value = 1;\n');
  const outboxPath = join(
    fx.sharedWorkspaceRoot,
    'publication-outbox',
    'pending',
    result.offlinePublicationOutboxId + '.json',
  );
  const outbox = JSON.parse(await readFile(outboxPath, 'utf8'));
  assert.equal(outbox.pushAuthority, false);
  assert.equal(outbox.mergeAuthority, false);
  assert.equal(outbox.deploymentAuthority, false);
  assert.equal(outbox.rebuildRequired, false);
});

test('local Forge builder runs stephanos verify through an ephemeral build and restores generated dist without granting generic npm execution', async () => {
  const fx = await fixture(['npm run stephanos:verify']);
  await mkdir(join(fx.repoRoot, 'scripts'), { recursive: true });
  await mkdir(join(fx.repoRoot, 'apps', 'stephanos', 'dist'), { recursive: true });
  await writeFile(join(fx.repoRoot, 'apps', 'stephanos', 'dist', 'index.html'), 'tracked-old\n');
  await writeFile(join(fx.repoRoot, 'scripts', 'build-stephanos-ui.mjs'), [
    "import { mkdir, writeFile } from 'node:fs/promises';",
    "await mkdir('apps/stephanos/dist/assets', { recursive: true });",
    "await writeFile('apps/stephanos/dist/index.html', 'built-current\\n');",
    "await writeFile('apps/stephanos/dist/assets/generated.js', 'export const built = true;\\n');",
    "console.log('ephemeral-build-ok');",
    '',
  ].join('\n'));
  await writeFile(join(fx.repoRoot, 'scripts', 'verify-stephanos-dist.mjs'), [
    "import { readFile } from 'node:fs/promises';",
    "const built = await readFile('apps/stephanos/dist/index.html', 'utf8');",
    "if (built !== 'built-current\\n') process.exit(2);",
    "console.log('ephemeral-verify-ok');",
    '',
  ].join('\n'));
  const add = run('git.exe', ['-C', fx.repoRoot, 'add', 'scripts/build-stephanos-ui.mjs', 'scripts/verify-stephanos-dist.mjs', 'apps/stephanos/dist/index.html'], { cwd: fx.repoRoot });
  assert.equal(add.status, 0, add.stderr);
  const commit = run('git.exe', ['-C', fx.repoRoot, 'commit', '-m', 'add ephemeral verify fixture'], { cwd: fx.repoRoot });
  assert.equal(commit.status, 0, commit.stderr);
  fx.actionGrant.sourceRevision = run('git.exe', ['-C', fx.repoRoot, 'rev-parse', 'HEAD'], { cwd: fx.repoRoot }).stdout.trim();

  const accepted = await processNextProviderNeutralSourceBuild({
    preferredAdapter: 'foundry-forge',
    sharedWorkspaceRoot: fx.sharedWorkspaceRoot,
    readMissionRecord: async () => ({ state: { missionId: fx.action.missionId, cancelled: false } }),
    repoRoot: fx.repoRoot,
    actionGrant: fx.actionGrant,
    runCommand: run,
    claimNext: async (adapter) => adapter === 'foundry-forge' ? fx.claim : null,
    generatePatch: async () => ({ patch: PATCH, summary: 'Run the fixed verify contract.' }),
    collectAgentWorkerResult: async () => ({ state: { revision: 1 } }),
  });
  assert.equal(accepted.success, true, accepted.error);
  assert.equal((await readFile(join(fx.repoRoot, 'apps', 'stephanos', 'dist', 'index.html'), 'utf8')).replace(/\r\n/g, '\n'), 'tracked-old\n');
  assert.equal(existsSync(join(fx.repoRoot, 'apps', 'stephanos', 'dist', 'assets', 'generated.js')), false);
  const distStatus = run('git.exe', ['-C', fx.repoRoot, 'status', '--porcelain=v1', '--untracked-files=all', '--', 'apps/stephanos/dist'], { cwd: fx.repoRoot });
  assert.equal(distStatus.stdout.trim(), '');

  const unsafeFx = await fixture(['npm run arbitrary-script']);
  const rejected = await processNextProviderNeutralSourceBuild({
    preferredAdapter: 'foundry-forge',
    sharedWorkspaceRoot: unsafeFx.sharedWorkspaceRoot,
    repoRoot: unsafeFx.repoRoot,
    actionGrant: unsafeFx.actionGrant,
    runCommand: run,
    claimNext: async (adapter) => adapter === 'foundry-forge' ? unsafeFx.claim : null,
    generatePatch: async () => ({ patch: PATCH, summary: 'Generic npm must remain blocked.' }),
    collectAgentWorkerResult: async () => ({ state: { revision: 1 } }),
  });
  assert.equal(rejected.success, false);
  assert.match(rejected.error, /PROVIDER_NEUTRAL_TEST_COMMAND_UNSAFE:npm run arbitrary-script/);
});

test('local Forge builder rejects shell-shaped tests and rolls its patch back cleanly', async () => {
  const fx = await fixture(['node --test focused.test.mjs & echo unsafe']);
  const result = await processNextProviderNeutralSourceBuild({
    preferredAdapter: 'foundry-forge',
    sharedWorkspaceRoot: fx.sharedWorkspaceRoot,
    readMissionRecord: async () => ({ state: { missionId: fx.action.missionId, cancelled: false } }),
    repoRoot: fx.repoRoot,
    actionGrant: fx.actionGrant,
    runCommand: run,
    claimNext: async (adapter) => adapter === 'foundry-forge' ? fx.claim : null,
    generatePatch: async () => ({ patch: PATCH, summary: 'Unsafe test fixture.' }),
    collectAgentWorkerResult: async () => ({ state: { revision: 1 } }),
  });
  assert.equal(result.processed, true);
  assert.equal(result.success, false);
  assert.match(result.error, /PROVIDER_NEUTRAL_TEST_COMMAND_UNSAFE/);
  assert.equal(
    (await readFile(join(fx.repoRoot, 'shared', 'agents', 'example.mjs'), 'utf8')).replace(/\r\n/g, '\n'),
    'export const value = 1;\n',
  );
  const status = run('git.exe', ['-C', fx.repoRoot, 'status', '--porcelain'], { cwd: fx.repoRoot });
  assert.equal(status.status, 0);
  assert.equal(status.stdout.trim(), '');
});

test('local Forge builder rejects path-escape attempts and does not invoke generatePatch', async () => {
  const fx = await fixture();
  await writeFile(join(fx.parent, 'outside.mjs'), 'export const outside = true;\n');
  fx.action.allowedFiles = ['../outside.mjs'];
  let generatePatchCalled = false;
  const escapeRun = (executable, args, options = {}) => {
    if (
      executable === 'git.exe'
      && args[2] === 'ls-files'
      && args.includes('--')
      && args.at(-1) === '../outside.mjs'
    ) {
      return { status: 0, stdout: '../outside.mjs\n', stderr: '', error: null };
    }
    return run(executable, args, options);
  };
  const result = await processNextProviderNeutralSourceBuild({
    preferredAdapter: 'foundry-forge',
    sharedWorkspaceRoot: fx.sharedWorkspaceRoot,
    readMissionRecord: async () => ({ state: { missionId: fx.action.missionId, cancelled: false } }),
    repoRoot: fx.repoRoot,
    actionGrant: fx.actionGrant,
    runCommand: escapeRun,
    claimNext: async (adapter) => adapter === 'foundry-forge' ? fx.claim : null,
    generatePatch: async () => {
      generatePatchCalled = true;
      return { patch: PATCH, summary: 'Should not be called.' };
    },
    collectAgentWorkerResult: async () => ({ state: { revision: 1 } }),
  });
  assert.equal(result.processed, true);
  assert.equal(result.success, false);
  assert.match(result.error, /PROVIDER_NEUTRAL_SOURCE_CONTEXT_PATH_ESCAPE/);
  assert.equal(generatePatchCalled, false);
});


test('local Forge builder bounds broad directory source context instead of rejecting the route', async () => {
  const fx = await fixture();
  for (let index = 0; index < 4; index += 1) {
    await writeFile(join(fx.repoRoot, 'shared', 'agents', `bulk-${index}.mjs`), 'x'.repeat(200 * 1024));
  }
  for (const args of [['add', '.'], ['commit', '-m', 'broad source context fixture']]) {
    const command = run('git.exe', ['-C', fx.repoRoot, ...args], { cwd: fx.repoRoot });
    assert.equal(command.status, 0, command.stderr);
  }
  fx.actionGrant.sourceRevision = run('git.exe', ['-C', fx.repoRoot, 'rev-parse', 'HEAD'], { cwd: fx.repoRoot }).stdout.trim();
  let context;
  const result = await processNextProviderNeutralSourceBuild({
    preferredAdapter: 'foundry-forge',
    sharedWorkspaceRoot: fx.sharedWorkspaceRoot,
    readMissionRecord: async () => ({ state: { missionId: fx.action.missionId, cancelled: false } }),
    repoRoot: fx.repoRoot,
    actionGrant: fx.actionGrant,
    runCommand: run,
    claimNext: async (adapter) => adapter === 'foundry-forge' ? fx.claim : null,
    generatePatch: async (_action, value) => { context = value; return { patch: PATCH, summary: 'Update the bounded value.' }; },
    collectAgentWorkerResult: async () => ({ state: { revision: 1 } }),
  });
  assert.equal(result.success, true, result.error);
  assert.ok(context.sourceSnapshots.some((entry) => entry.path === 'shared/agents/example.mjs'));
  assert.ok(context.sourceSnapshots.length < 5);
  assert.ok(context.sourceSnapshots.reduce((sum, entry) => sum + Buffer.byteLength(entry.content, 'utf8'), 0) <= 768 * 1024);
});


test('local Forge builder accepts repository-wide scope while excluding protected tracked context', async () => {
  const fx = await fixture();
  fx.action.allowedFiles = ['**'];
  await mkdir(join(fx.repoRoot, 'runtime'), { recursive: true });
  await mkdir(join(fx.repoRoot, 'shared', 'runtime'), { recursive: true });
  await mkdir(join(fx.repoRoot, 'apps', 'music-tile', 'data'), { recursive: true });
  await writeFile(join(fx.repoRoot, 'runtime', 'state.json'), '{"unsafe":true}\n');
  await writeFile(join(fx.repoRoot, 'shared', 'runtime', 'runtimeAdjudicator.mjs'), 'export const runtimeSource = true;\n');
  await writeFile(join(fx.repoRoot, 'apps', 'music-tile', 'data', 'trackLibrary.js'), 'export const tracks = [];\n');
  await writeFile(join(fx.repoRoot, 'safe-source.mjs'), 'export const safe = true;\n');
  for (const args of [['add', '.'], ['commit', '-m', 'repository-wide source context fixture']]) {
    const command = run('git.exe', ['-C', fx.repoRoot, ...args], { cwd: fx.repoRoot });
    assert.equal(command.status, 0, command.stderr);
  }
  fx.actionGrant.sourceRevision = run('git.exe', ['-C', fx.repoRoot, 'rev-parse', 'HEAD'], { cwd: fx.repoRoot }).stdout.trim();
  let context;
  const result = await processNextProviderNeutralSourceBuild({
    preferredAdapter: 'foundry-forge',
    sharedWorkspaceRoot: fx.sharedWorkspaceRoot,
    readMissionRecord: async () => ({ state: { missionId: fx.action.missionId, cancelled: false } }),
    repoRoot: fx.repoRoot,
    actionGrant: fx.actionGrant,
    runCommand: run,
    claimNext: async (adapter) => adapter === 'foundry-forge' ? fx.claim : null,
    generatePatch: async (_action, value) => {
      context = value;
      return { patch: PATCH, summary: 'Update the bounded value.' };
    },
    collectAgentWorkerResult: async () => ({ state: { revision: 1 } }),
  });
  assert.equal(result.success, true, result.error);
  assert.ok(context.sourceSnapshots.some((entry) => entry.path === 'shared/agents/example.mjs'));
  assert.ok(context.sourceSnapshots.some((entry) => entry.path === 'safe-source.mjs'));
  assert.ok(context.sourceSnapshots.some((entry) => entry.path === 'shared/runtime/runtimeAdjudicator.mjs'));
  assert.ok(context.sourceSnapshots.some((entry) => entry.path === 'apps/music-tile/data/trackLibrary.js'));
  assert.equal(context.sourceSnapshots.some((entry) => entry.path === 'runtime/state.json'), false);
});

test('local Forge builder rejects a protected patch target even under repository-wide scope', async () => {
  const fx = await fixture();
  fx.action.allowedFiles = ['**'];
  const unsafePatch = [
    'diff --git a/runtime/state.json b/runtime/state.json',
    'new file mode 100644',
    '--- /dev/null',
    '+++ b/runtime/state.json',
    '@@ -0,0 +1 @@',
    '+{"unsafe":true}',
    '',
  ].join('\n');
  const result = await processNextProviderNeutralSourceBuild({
    preferredAdapter: 'foundry-forge',
    sharedWorkspaceRoot: fx.sharedWorkspaceRoot,
    readMissionRecord: async () => ({ state: { missionId: fx.action.missionId, cancelled: false } }),
    repoRoot: fx.repoRoot,
    actionGrant: fx.actionGrant,
    runCommand: run,
    claimNext: async (adapter) => adapter === 'foundry-forge' ? fx.claim : null,
    generatePatch: async () => ({ patch: unsafePatch, summary: 'Attempt protected edit.' }),
    collectAgentWorkerResult: async () => ({ state: { revision: 1 } }),
  });
  assert.equal(result.success, false);
  assert.match(result.error, /PROVIDER_NEUTRAL_SCOPE_VIOLATION:runtime\/state\.json/);
});

test('local Forge builder permits an empty source snapshot for a scoped new file', async () => {
  const fx = await fixture();
  await writeFile(join(fx.repoRoot, 'focused.test.mjs'),
    "import assert from 'node:assert/strict'; import {created} from './shared/agents/new-file.mjs'; assert.equal(created, true);\n");
  assert.equal(run('git.exe', ['add', 'focused.test.mjs'], {cwd: fx.repoRoot}).status, 0);
  assert.equal(run('git.exe', ['commit', '-m', 'Bind new-file behavior acceptance'], {cwd: fx.repoRoot}).status, 0);
  fx.actionGrant.sourceRevision = run('git.exe', ['rev-parse', 'HEAD'], {cwd: fx.repoRoot}).stdout.trim();
  fx.action.allowedFiles = ['shared/agents/new-file.mjs'];
  const newFilePatch = [
    'diff --git a/shared/agents/new-file.mjs b/shared/agents/new-file.mjs',
    'new file mode 100644',
    '--- /dev/null',
    '+++ b/shared/agents/new-file.mjs',
    '@@ -0,0 +1 @@',
    '+export const created = true;',
    '',
  ].join('\n');
  let context;
  const result = await processNextProviderNeutralSourceBuild({
    preferredAdapter: 'foundry-forge',
    sharedWorkspaceRoot: fx.sharedWorkspaceRoot,
    readMissionRecord: async () => ({ state: { missionId: fx.action.missionId, cancelled: false } }),
    repoRoot: fx.repoRoot,
    actionGrant: fx.actionGrant,
    runCommand: run,
    claimNext: async (adapter) => adapter === 'foundry-forge' ? fx.claim : null,
    generatePatch: async (_action, value) => { context = value; return { patch: newFilePatch, summary: 'Create the scoped file.' }; },
    collectAgentWorkerResult: async () => ({ state: { revision: 1 } }),
  });
  assert.equal(result.success, true, result.error);
  assert.deepEqual(context.sourceSnapshots, []);
  assert.equal((await readFile(join(fx.repoRoot, 'shared', 'agents', 'new-file.mjs'), 'utf8')).replace(/\r\n/g, '\n'), 'export const created = true;\n');
});


test('local Forge builder rejects an allowlisted tracked symlink before provider invocation', async () => {
  const fx = await fixture();
  let generatePatchCalled = false;
  const result = await processNextProviderNeutralSourceBuild({
    preferredAdapter: 'foundry-forge',
    sharedWorkspaceRoot: fx.sharedWorkspaceRoot,
    readMissionRecord: async () => ({ state: { missionId: fx.action.missionId, cancelled: false } }),
    repoRoot: fx.repoRoot,
    actionGrant: fx.actionGrant,
    runCommand: run,
    sourceContextLstatImpl: async () => ({ isSymbolicLink: () => true }),
    claimNext: async (adapter) => adapter === 'foundry-forge' ? fx.claim : null,
    generatePatch: async () => {
      generatePatchCalled = true;
      return { patch: PATCH, summary: 'Should not be called.' };
    },
    collectAgentWorkerResult: async () => ({ state: { revision: 1 } }),
  });
  assert.equal(result.success, false);
  assert.match(result.error, /PROVIDER_NEUTRAL_SOURCE_CONTEXT_SYMLINK_REJECTED/);
  assert.equal(result.providerInvoked, false);
  assert.equal(generatePatchCalled, false);
});


test('local Forge builder safely recounts model patch hunk lengths before applying', async () => {
  const fx = await fixture();
  const recountPatch = PATCH.replace('@@ -1 +1 @@', '@@ -1,99 +1,99 @@');
  const result = await processNextProviderNeutralSourceBuild({
    preferredAdapter: 'foundry-forge',
    sharedWorkspaceRoot: fx.sharedWorkspaceRoot,
    readMissionRecord: async () => ({ state: { missionId: fx.action.missionId, cancelled: false } }),
    repoRoot: fx.repoRoot,
    actionGrant: fx.actionGrant,
    runCommand: run,
    claimNext: async (adapter) => adapter === 'foundry-forge' ? fx.claim : null,
    generatePatch: async () => ({ patch: recountPatch, summary: 'Patch with incorrect hunk counts.' }),
    collectAgentWorkerResult: async () => ({ state: { revision: 1 } }),
  });
  assert.equal(result.success, true, result.error);
  assert.equal(
    (await readFile(join(fx.repoRoot, 'shared', 'agents', 'example.mjs'), 'utf8')).replace(/\r\n/g, '\n'),
    'export const value = 2;\n',
  );
});


test('local Forge builder still rejects a structurally malformed patch after recount', async () => {
  const fx = await fixture();
  const malformedPatch = [
    'diff --git a/shared/agents/example.mjs b/shared/agents/example.mjs',
    '--- a/shared/agents/example.mjs',
    '+++ b/shared/agents/example.mjs',
    '@@ this-is-not-a-valid-hunk @@',
    '-export const value = 1;',
    '+export const value = 2;',
    '',
  ].join('\n');
  const result = await processNextProviderNeutralSourceBuild({
    preferredAdapter: 'foundry-forge',
    sharedWorkspaceRoot: fx.sharedWorkspaceRoot,
    readMissionRecord: async () => ({ state: { missionId: fx.action.missionId, cancelled: false } }),
    repoRoot: fx.repoRoot,
    actionGrant: fx.actionGrant,
    runCommand: run,
    claimNext: async (adapter) => adapter === 'foundry-forge' ? fx.claim : null,
    generatePatch: async () => ({ patch: malformedPatch, summary: 'Malformed patch.' }),
    collectAgentWorkerResult: async () => ({ state: { revision: 1 } }),
  });
  assert.equal(result.success, false);
  assert.match(result.error, /PROVIDER_NEUTRAL_PATCH_CHECK_FAILED/);
  const status = run('git.exe', ['-C', fx.repoRoot, 'status', '--porcelain'], { cwd: fx.repoRoot });
  assert.equal(status.status, 0);
  assert.equal(status.stdout.trim(), '');
});


test('local Forge builder rolls back a recounted patch when a later test fails', async () => {
  const fx = await fixture(['node --test missing-focused.test.mjs']);
  const recountPatch = PATCH.replace('@@ -1 +1 @@', '@@ -1,99 +1,99 @@');
  const result = await processNextProviderNeutralSourceBuild({
    preferredAdapter: 'foundry-forge',
    sharedWorkspaceRoot: fx.sharedWorkspaceRoot,
    readMissionRecord: async () => ({ state: { missionId: fx.action.missionId, cancelled: false } }),
    repoRoot: fx.repoRoot,
    actionGrant: fx.actionGrant,
    runCommand: run,
    claimNext: async (adapter) => adapter === 'foundry-forge' ? fx.claim : null,
    generatePatch: async () => ({ patch: recountPatch, summary: 'Recounted patch followed by a failing test.' }),
    collectAgentWorkerResult: async () => ({ state: { revision: 1 } }),
  });
  assert.equal(result.success, false);
  assert.match(result.error, /PROVIDER_NEUTRAL_TEST_FAILED/);
  assert.doesNotMatch(result.error, /PROVIDER_NEUTRAL_PATCH_ROLLBACK/);
  assert.equal(
    (await readFile(join(fx.repoRoot, 'shared', 'agents', 'example.mjs'), 'utf8')).replace(/\r\n/g, '\n'),
    'export const value = 1;\n',
  );
  const status = run('git.exe', ['-C', fx.repoRoot, 'status', '--porcelain'], { cwd: fx.repoRoot });
  assert.equal(status.status, 0);
  assert.equal(status.stdout.trim(), '');
});


test('local Forge builder applies exact structured edits and escrows the resulting worktree', async () => {
  const fx = await fixture();
  const collected = [];
  const result = await processNextProviderNeutralSourceBuild({
    preferredAdapter: 'foundry-forge',
    sharedWorkspaceRoot: fx.sharedWorkspaceRoot,
    readMissionRecord: async () => ({ state: { missionId: fx.action.missionId, cancelled: false } }),
    repoRoot: fx.repoRoot,
    actionGrant: fx.actionGrant,
    runCommand: run,
    claimNext: async (adapter) => adapter === 'foundry-forge' ? fx.claim : null,
    generatePatch: async () => ({
      edits: [{
        path: 'shared/agents/example.mjs',
        old: 'export const value = 1;\n',
        new: 'export const value = 2;\n',
      }],
      summary: 'Update the bounded value through structured edits.',
    }),
    collectAgentWorkerResult: async (record) => { collected.push(record); return { state: { revision: 1 } }; },
  });
  assert.equal(result.success, true, result.error);
  assert.equal(result.testsPassed, true);
  assert.match(result.sourceArtifactRef, /^shared-workspace:\/\/source-artifacts\//);
  assert.equal(collected.length, 1);
  assert.equal(collected[0].success, true);
  assert.equal(
    (await readFile(join(fx.repoRoot, 'shared', 'agents', 'example.mjs'), 'utf8')).replace(/\r\n/g, '\n'),
    'export const value = 2;\n',
  );
});

test('Forge rejects a late import before escrow and rolls back a generated structured edit', async () => {
  const fx = await fixture();
  const collected = [];
  const result = await processNextProviderNeutralSourceBuild({
    preferredAdapter: 'foundry-forge',
    sharedWorkspaceRoot: fx.sharedWorkspaceRoot,
    readMissionRecord: async () => ({ state: { missionId: fx.action.missionId, cancelled: false } }),
    repoRoot: fx.repoRoot,
    actionGrant: fx.actionGrant,
    runCommand: run,
    claimNext: async (adapter) => adapter === 'foundry-forge' ? fx.claim : null,
    generatePatch: async () => ({
      edits: [{
        path: 'shared/agents/example.mjs',
        old: 'export const value = 1;\n',
        new: "export const value = 2;\nimport { readFileSync } from 'node:fs';\n",
      }],
      summary: 'Malformed generated module should never be published.',
    }),
    collectAgentWorkerResult: async (record) => { collected.push(record); return { state: { revision: 1 } }; },
  });
  assert.equal(result.processed, true);
  assert.equal(result.success, false);
  assert.equal(result.failureStage, 'SOURCE_OR_TEST');
  assert.match(result.error, /PROVIDER_NEUTRAL_IMPORT_STRUCTURE_INVALID:shared\/agents\/example\.mjs:import not at top/);
  assert.equal(collected.length, 1);
  assert.equal(collected[0].success, false);
  assert.equal(collected[0].sourceArtifactEscrow, undefined);
  assert.equal((await readFile(join(fx.repoRoot, 'shared', 'agents', 'example.mjs'), 'utf8')), 'export const value = 1;\n');
  const status = run('git.exe', ['-C', fx.repoRoot, 'status', '--porcelain'], { cwd: fx.repoRoot });
  assert.equal(status.status, 0);
  assert.equal(status.stdout.trim(), '');
});

test('local Forge builder creates a bounded new file through structured edits', async () => {
  const fx = await fixture(['node --check shared/agents/new-file.mjs']);
  const result = await processNextProviderNeutralSourceBuild({
    preferredAdapter: 'foundry-forge',
    sharedWorkspaceRoot: fx.sharedWorkspaceRoot,
    readMissionRecord: async () => ({ state: { missionId: fx.action.missionId, cancelled: false } }),
    repoRoot: fx.repoRoot,
    actionGrant: fx.actionGrant,
    runCommand: run,
    claimNext: async (adapter) => adapter === 'foundry-forge' ? fx.claim : null,
    generatePatch: async (_action, context) => {
      assert.ok(context.sourceSnapshots.some((entry) => entry.path === 'shared/agents/example.mjs'));
      assert.equal(context.sourceSnapshots.some((entry) => entry.path === 'shared/agents/new-file.mjs'), false);
      return {
        edits: [{
          path: 'shared/agents/new-file.mjs',
          old: '',
          new: 'export const created = true;\n',
        }],
        summary: 'Create one bounded source file through structured edits.',
      };
    },
    collectAgentWorkerResult: async () => ({ state: { revision: 1 } }),
  });

  assert.equal(result.success, true, result.error);
  assert.equal(result.testsPassed, true);
  assert.equal(
    (await readFile(join(fx.repoRoot, 'shared', 'agents', 'new-file.mjs'), 'utf8')).replace(/\r\n/g, '\n'),
    'export const created = true;\n',
  );
});

test('local Forge builder removes a structured new file when a later required test fails', async () => {
  const fx = await fixture(['node --test missing-new-file-test.mjs']);
  const newFile = join(fx.repoRoot, 'shared', 'agents', 'rollback-new-file.mjs');
  const result = await processNextProviderNeutralSourceBuild({
    preferredAdapter: 'foundry-forge',
    sharedWorkspaceRoot: fx.sharedWorkspaceRoot,
    readMissionRecord: async () => ({ state: { missionId: fx.action.missionId, cancelled: false } }),
    repoRoot: fx.repoRoot,
    actionGrant: fx.actionGrant,
    runCommand: run,
    claimNext: async (adapter) => adapter === 'foundry-forge' ? fx.claim : null,
    generatePatch: async () => ({
      edits: [{
        path: 'shared/agents/rollback-new-file.mjs',
        old: '',
        new: 'export const temporary = true;\n',
      }],
      summary: 'Create a file that must roll back after test failure.',
    }),
    collectAgentWorkerResult: async () => ({ state: { revision: 1 } }),
  });

  assert.equal(result.success, false);
  assert.match(result.error, /PROVIDER_NEUTRAL_TEST_FAILED/);
  assert.equal(existsSync(newFile), false);
  const status = run('git.exe', ['-C', fx.repoRoot, 'status', '--porcelain'], { cwd: fx.repoRoot });
  assert.equal(status.stdout.trim(), '');
});

test('low-level goal-context fixture: elastic Forge model creates a scoped new file with structured edits when source snapshots are empty', async () => {
  const fx = await fixture(['node --check shared/agents/no-snapshot-target.mjs']);
  fx.action.missionId = 'unit-goal-context-3001';
  fx.action.allowedFiles = ['shared/agents/no-snapshot-target.mjs'];
  let calls = 0;
  const result = await processNextProviderNeutralSourceBuild({
    preferredAdapter: 'foundry-forge',
    sharedWorkspaceRoot: fx.sharedWorkspaceRoot,
    readMissionRecord: async () => ({ state: { missionId: fx.action.missionId, cancelled: false } }),
    repoRoot: fx.repoRoot,
    actionGrant: fx.actionGrant,
    runCommand: run,
    claimNext: async (adapter) => adapter === 'foundry-forge' ? fx.claim : null,
    loadGoalContext: async () => '# Goal 3001\nCreate an allowed new file.',
    localModelFetchImpl: async (_url, request) => {
      calls += 1;
      const prompt = JSON.parse(request.body).messages[0].content;
      assert.match(prompt, /There are no tracked source snapshots/);
      assert.match(prompt, /old as the empty string/);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          message: { content: JSON.stringify({
            edits: [{
              path: 'shared/agents/no-snapshot-target.mjs',
              old: '',
              new: 'export const created = true;\n',
            }],
            summary: 'Create only the allowed new file.',
          }) },
        }),
      };
    },
    collectAgentWorkerResult: async () => ({ state: { revision: 1 } }),
  });
  assert.equal(result.success, true, result.error);
  assert.equal(result.testsPassed, true);
  assert.equal(calls, 1);
  assert.match(result.sourceArtifactRef, /^shared-workspace:\/\/source-artifacts\//);
  assert.equal(
    (await readFile(join(fx.repoRoot, 'shared', 'agents', 'no-snapshot-target.mjs'), 'utf8')).replace(/\r\n/g, '\n'),
    'export const created = true;\n',
  );
});

test('low-level goal-context fixture: elastic Forge rejects an out-of-scope structured new file with no source snapshots', async () => {
  const fx = await fixture();
  fx.action.missionId = 'unit-goal-context-3001';
  fx.action.allowedFiles = ['shared/agents/approved-new.mjs'];
  let calls = 0;
  const result = await processNextProviderNeutralSourceBuild({
    preferredAdapter: 'foundry-forge',
    sharedWorkspaceRoot: fx.sharedWorkspaceRoot,
    readMissionRecord: async () => ({ state: { missionId: fx.action.missionId, cancelled: false } }),
    repoRoot: fx.repoRoot,
    actionGrant: fx.actionGrant,
    runCommand: run,
    claimNext: async (adapter) => adapter === 'foundry-forge' ? fx.claim : null,
    loadGoalContext: async () => '# Goal 3001\nCreate only an approved new file.',
    localModelFetchImpl: async () => {
      calls += 1;
      return {
        ok: true, status: 200,
        json: async () => ({ message: { content: JSON.stringify({
          edits: [{ path: 'runtime/unsafe.json', old: '', new: '{"unsafe":true}\n' }],
          summary: 'Unsafe file mutation must not be accepted.',
        }) } }),
      };
    },
    collectAgentWorkerResult: async () => ({ state: { revision: 1 } }),
  });
  assert.equal(result.success, false);
  assert.match(result.error, /PROVIDER_NEUTRAL_SCOPE_VIOLATION:runtime\/unsafe\.json/);
  assert.equal(calls, 2);
  assert.equal(existsSync(join(fx.repoRoot, 'runtime', 'unsafe.json')), false);
  assert.equal(run('git.exe', ['-C', fx.repoRoot, 'status', '--porcelain'], { cwd: fx.repoRoot }).stdout.trim(), '');
});

test('low-level goal-context fixture: elastic Forge model can create an allowed new file with structured edits while source snapshots exist', async () => {
  const fx = await fixture(['node --check shared/agents/model-created.mjs']);
  fx.action.missionId = 'unit-goal-context-3001';
  let prompt = '';
  const result = await processNextProviderNeutralSourceBuild({
    preferredAdapter: 'foundry-forge',
    sharedWorkspaceRoot: fx.sharedWorkspaceRoot,
    readMissionRecord: async () => ({ state: { missionId: fx.action.missionId, cancelled: false } }),
    repoRoot: fx.repoRoot,
    actionGrant: fx.actionGrant,
    runCommand: run,
    claimNext: async (adapter) => adapter === 'foundry-forge' ? fx.claim : null,
    loadGoalContext: async () => '# Goal 3001\nCreate shared/agents/model-created.mjs.',
    localModelFetchImpl: async (_url, request) => {
      const body = JSON.parse(request.body);
      prompt = body.messages[0].content;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          message: {
            content: JSON.stringify({
              edits: [{
                path: 'shared/agents/model-created.mjs',
                old: '',
                new: 'export const fromModel = true;\n',
              }],
              summary: 'Create the bounded new source file.',
            }),
          },
        }),
      };
    },
    collectAgentWorkerResult: async () => ({ state: { revision: 1 } }),
  });

  assert.equal(result.success, true, result.error);
  assert.match(prompt, /old as the empty string/i);
  assert.match(prompt, /Do not return a unified diff/i);
  assert.equal(
    (await readFile(join(fx.repoRoot, 'shared', 'agents', 'model-created.mjs'), 'utf8')).replace(/\r\n/g, '\n'),
    'export const fromModel = true;\n',
  );
});

test('low-level goal-context fixture: elastic Forge model retries a semantically invalid structured edit before mutation', async () => {
  const fx = await fixture();
  fx.action.missionId = 'unit-goal-context-3001';
  let calls = 0;
  const result = await processNextProviderNeutralSourceBuild({
    preferredAdapter: 'foundry-forge',
    sharedWorkspaceRoot: fx.sharedWorkspaceRoot,
    readMissionRecord: async () => ({ state: { missionId: fx.action.missionId, cancelled: false } }),
    repoRoot: fx.repoRoot,
    actionGrant: fx.actionGrant,
    runCommand: run,
    claimNext: async (adapter) => adapter === 'foundry-forge' ? fx.claim : null,
    loadGoalContext: async () => '# Goal 3001\nUpdate the bounded existing source.',
    localModelFetchImpl: async (_url, request) => {
      calls += 1;
      const body = JSON.parse(request.body);
      if (calls === 2) {
        assert.match(body.messages[0].content, /PROVIDER_NEUTRAL_STRUCTURED_EDIT_CONTENT_INVALID/);
      }
      const edits = calls === 1
        ? [{
            path: 'shared/agents/example.mjs',
            old: '',
            new: 'export const value = 2;\n',
          }]
        : [{
            path: 'shared/agents/example.mjs',
            old: 'export const value = 1;\n',
            new: 'export const value = 2;\n',
          }];
      return {
        ok: true,
        status: 200,
        json: async () => ({
          message: {
            content: JSON.stringify({
              edits,
              summary: 'Update the bounded existing source.',
            }),
          },
        }),
      };
    },
    collectAgentWorkerResult: async () => ({ state: { revision: 1 } }),
  });

  assert.equal(result.success, true, result.error);
  assert.equal(calls, 2);
  assert.equal(
    (await readFile(join(fx.repoRoot, 'shared', 'agents', 'example.mjs'), 'utf8')).replace(/\r\n/g, '\n'),
    'export const value = 2;\n',
  );
});

test('low-level goal-context fixture: elastic Forge model rejects unified-diff fallback when source snapshots are available', async () => {
  const fx = await fixture();
  fx.action.missionId = 'unit-goal-context-3001';
  let calls = 0;
  const result = await processNextProviderNeutralSourceBuild({
    preferredAdapter: 'foundry-forge',
    sharedWorkspaceRoot: fx.sharedWorkspaceRoot,
    readMissionRecord: async () => ({ state: { missionId: fx.action.missionId, cancelled: false } }),
    repoRoot: fx.repoRoot,
    actionGrant: fx.actionGrant,
    runCommand: run,
    claimNext: async (adapter) => adapter === 'foundry-forge' ? fx.claim : null,
    loadGoalContext: async () => '# Goal 3001\nUpdate bounded source.',
    localModelFetchImpl: async () => {
      calls += 1;
      return {
        ok: true,
        status: 200,
        json: async () => ({ message: { content: JSON.stringify({ patch: PATCH, summary: 'fragile patch fallback' }) } }),
      };
    },
    collectAgentWorkerResult: async () => ({ state: { revision: 1 } }),
  });

  assert.equal(result.success, false);
  assert.equal(calls, 2);
  assert.match(result.error, /PROVIDER_NEUTRAL_MODEL_STRUCTURED_EDITS_MISSING/);
  const status = run('git.exe', ['-C', fx.repoRoot, 'status', '--porcelain'], { cwd: fx.repoRoot });
  assert.equal(status.stdout.trim(), '');
});

test('local Forge builder rejects structured edits outside the allowlist without touching source', async () => {
  const fx = await fixture();
  const result = await processNextProviderNeutralSourceBuild({
    preferredAdapter: 'foundry-forge',
    sharedWorkspaceRoot: fx.sharedWorkspaceRoot,
    readMissionRecord: async () => ({ state: { missionId: fx.action.missionId, cancelled: false } }),
    repoRoot: fx.repoRoot,
    actionGrant: fx.actionGrant,
    runCommand: run,
    claimNext: async (adapter) => adapter === 'foundry-forge' ? fx.claim : null,
    generatePatch: async () => ({
      edits: [{ path: 'README.md', old: 'before', new: 'after' }],
      summary: 'Attempt an out-of-scope edit.',
    }),
    collectAgentWorkerResult: async () => ({ state: { revision: 1 } }),
  });
  assert.equal(result.success, false);
  assert.match(result.error, /PROVIDER_NEUTRAL_SCOPE_VIOLATION/);
  assert.equal(
    (await readFile(join(fx.repoRoot, 'shared', 'agents', 'example.mjs'), 'utf8')).replace(/\r\n/g, '\n'),
    'export const value = 1;\n',
  );
  const status = run('git.exe', ['-C', fx.repoRoot, 'status', '--porcelain'], { cwd: fx.repoRoot });
  assert.equal(status.stdout.trim(), '');
});

test('local Forge builder rejects a non-unique structured edit anchor before mutation', async () => {
  const fx = await fixture();
  await writeFile(join(fx.repoRoot, 'shared', 'agents', 'duplicate.txt'), 'same\nsame\n');
  for (const args of [['add', '.'], ['commit', '-m', 'duplicate anchor fixture']]) {
    const command = run('git.exe', ['-C', fx.repoRoot, ...args], { cwd: fx.repoRoot });
    assert.equal(command.status, 0, command.stderr);
  }
  fx.actionGrant.sourceRevision = run('git.exe', ['-C', fx.repoRoot, 'rev-parse', 'HEAD'], { cwd: fx.repoRoot }).stdout.trim();
  const result = await processNextProviderNeutralSourceBuild({
    preferredAdapter: 'foundry-forge',
    sharedWorkspaceRoot: fx.sharedWorkspaceRoot,
    readMissionRecord: async () => ({ state: { missionId: fx.action.missionId, cancelled: false } }),
    repoRoot: fx.repoRoot,
    actionGrant: fx.actionGrant,
    runCommand: run,
    claimNext: async (adapter) => adapter === 'foundry-forge' ? fx.claim : null,
    generatePatch: async () => ({
      edits: [{ path: 'shared/agents/duplicate.txt', old: 'same', new: 'changed' }],
      summary: 'Ambiguous anchor fixture.',
    }),
    collectAgentWorkerResult: async () => ({ state: { revision: 1 } }),
  });
  assert.equal(result.success, false);
  assert.match(result.error, /PROVIDER_NEUTRAL_STRUCTURED_EDIT_ANCHOR_MISMATCH/);
  assert.equal(await readFile(join(fx.repoRoot, 'shared', 'agents', 'duplicate.txt'), 'utf8'), 'same\nsame\n');
  const status = run('git.exe', ['-C', fx.repoRoot, 'status', '--porcelain'], { cwd: fx.repoRoot });
  assert.equal(status.stdout.trim(), '');
});

test('local Forge builder rolls structured edits back cleanly when a required test fails', async () => {
  const fx = await fixture(['node --test missing-structured-edit.test.mjs']);
  const result = await processNextProviderNeutralSourceBuild({
    preferredAdapter: 'foundry-forge',
    sharedWorkspaceRoot: fx.sharedWorkspaceRoot,
    readMissionRecord: async () => ({ state: { missionId: fx.action.missionId, cancelled: false } }),
    repoRoot: fx.repoRoot,
    actionGrant: fx.actionGrant,
    runCommand: run,
    claimNext: async (adapter) => adapter === 'foundry-forge' ? fx.claim : null,
    generatePatch: async () => ({
      edits: [{
        path: 'shared/agents/example.mjs',
        old: 'export const value = 1;\n',
        new: 'export const value = 2;\n',
      }],
      summary: 'Structured edit followed by a failing test.',
    }),
    collectAgentWorkerResult: async () => ({ state: { revision: 1 } }),
  });
  assert.equal(result.success, false);
  assert.match(result.error, /PROVIDER_NEUTRAL_TEST_FAILED/);
  assert.doesNotMatch(result.error, /PROVIDER_NEUTRAL_STRUCTURED_EDIT_ROLLBACK/);
  assert.equal(
    (await readFile(join(fx.repoRoot, 'shared', 'agents', 'example.mjs'), 'utf8')).replace(/\r\n/g, '\n'),
    'export const value = 1;\n',
  );
  const status = run('git.exe', ['-C', fx.repoRoot, 'status', '--porcelain'], { cwd: fx.repoRoot });
  assert.equal(status.stdout.trim(), '');
});


test('local Forge builder retains patch mode for mixed tracked-source plus new-file missions', async () => {
  const fx = await fixture();
  let context;
  const mixedPatch = [
    'diff --git a/shared/agents/example.mjs b/shared/agents/example.mjs',
    '--- a/shared/agents/example.mjs',
    '+++ b/shared/agents/example.mjs',
    '@@ -1 +1 @@',
    '-export const value = 1;',
    '+export const value = 2;',
    'diff --git a/shared/agents/new-regression.mjs b/shared/agents/new-regression.mjs',
    'new file mode 100644',
    '--- /dev/null',
    '+++ b/shared/agents/new-regression.mjs',
    '@@ -0,0 +1 @@',
    '+export const regression = true;',
    '',
  ].join('\n');

  const result = await processNextProviderNeutralSourceBuild({
    preferredAdapter: 'foundry-forge',
    sharedWorkspaceRoot: fx.sharedWorkspaceRoot,
    readMissionRecord: async () => ({ state: { missionId: fx.action.missionId, cancelled: false } }),
    repoRoot: fx.repoRoot,
    actionGrant: fx.actionGrant,
    runCommand: run,
    claimNext: async (adapter) => adapter === 'foundry-forge' ? fx.claim : null,
    generatePatch: async (_action, value) => {
      context = value;
      return { patch: mixedPatch, summary: 'Update tracked source and create a bounded regression file.' };
    },
    collectAgentWorkerResult: async () => ({ state: { revision: 1 } }),
  });

  assert.equal(result.success, true, result.error);
  assert.ok(context.sourceSnapshots.some((entry) => entry.path === 'shared/agents/example.mjs'));
  assert.equal(
    (await readFile(join(fx.repoRoot, 'shared', 'agents', 'example.mjs'), 'utf8')).replace(/\r\n/g, '\n'),
    'export const value = 2;\n',
  );
  assert.equal(
    (await readFile(join(fx.repoRoot, 'shared', 'agents', 'new-regression.mjs'), 'utf8')).replace(/\r\n/g, '\n'),
    'export const regression = true;\n',
  );
});


test('low-level goal-context fixture: elastic Forge builder hydrates authoritative goal context and retries malformed local-model output once', async () => {
  const fx = await fixture();
  fx.action.missionId = 'unit-goal-context-3001';
  let modelCalls = 0;
  const prompts = [];
  const result = await processNextProviderNeutralSourceBuild({
    preferredAdapter: 'foundry-forge',
    sharedWorkspaceRoot: fx.sharedWorkspaceRoot,
    readMissionRecord: async () => ({ state: { missionId: fx.action.missionId, cancelled: false } }),
    repoRoot: fx.repoRoot,
    actionGrant: fx.actionGrant,
    runCommand: run,
    claimNext: async (adapter) => adapter === 'foundry-forge' ? fx.claim : null,
    loadGoalContext: async () => '# Goal 3001\nUpdate shared/agents/example.mjs so the value becomes 2.',
    localModelFetchImpl: async (_url, request) => {
      modelCalls += 1;
      const body = JSON.parse(request.body);
      prompts.push(body.messages[0].content);
      const content = modelCalls === 1
        ? JSON.stringify({
            edits: [{
              path: 'shared/agents/example.mjs',
              new: 'export const value = 2;\n',
              explanation: 'malformed response must be retried',
            }],
            summary: 'structurally invalid first response',
          })
        : JSON.stringify({
            edits: [{
              path: 'shared/agents/example.mjs',
              old: 'export const value = 1;\n',
              new: 'export const value = 2;\n',
            }],
            summary: 'Apply the bounded goal change.',
          });
      return { ok: true, status: 200, json: async () => ({ message: { content } }) };
    },
    collectAgentWorkerResult: async () => ({ state: { revision: 1 } }),
  });
  assert.equal(result.success, true, result.error);
  assert.equal(modelCalls, 2);
  assert.match(prompts[0], /Authoritative GitHub goal context:/);
  assert.match(prompts[0], /Update shared\/agents\/example\.mjs/);
  assert.match(prompts[1], /previous response did not satisfy/i);
});

test('actual canonical context reader resolves canonical GitHub identity and rejects a lookalike payload before model effects', async t => {
  for (const foreign of [false, true]) await t.test(String(foreign), async t => {
    const fx = await canonicalSourceFixture(t);
    if (foreign) {
      fx.claim.item.payload.repository = 'Cheekyfellastef/stephan-os-lookalike';
      await writeFile(fx.claim.processingPath, JSON.stringify(fx.claim.item));
    }
    let githubReads = 0, modelCalls = 0;
    const result = await processNextProviderNeutralSourceBuild({ ...fx.options,
      preferredAdapter: 'foundry-forge', runCommand: run, claimNext: async () => fx.claim,
      githubAuth: { configured: true, authority: 'test', token: 'test-token' },
      githubFetchImpl: async url => {
        githubReads++;
        assert.equal(url, 'https://api.github.com/repos/Cheekyfellastef/stephan-os/issues/3001');
        return { ok: true, status: 200, json: async () => ({ number: 3001, state: 'open',
          title: 'Bounded original goal', body: 'Update shared/agents/example.mjs.', labels: [{ name: 'goal' }] }) };
      },
      localModelFetchImpl: async () => {
        modelCalls++;
        return { ok: true, json: async () => ({ message: { content: JSON.stringify({
          edits: [{ path: 'shared/agents/example.mjs', old: 'export const value = 1;', new: 'export const value = 2;' }],
          summary: 'Satisfy the existing independent behavior oracle.',
        }) } }) };
      } });
    assert.equal(result.success, !foreign, result.error);
    assert.equal(githubReads, foreign ? 0 : 1);
    assert.equal(modelCalls, foreign ? 0 : 1);
    if (foreign) assert.match(result.error, /SOURCE_SCOPE_RECONCILIATION_REQUIRED/);
    assert.match(await readFile(join(fx.repoRoot, 'shared/agents/example.mjs'), 'utf8'),
      foreign ? /value = 1/ : /value = 2/);
  });
});

test('actual canonical builder fails before model effects when authoritative goal context is unavailable', async t => {
  const fx = await canonicalSourceFixture(t);
  let modelCalls = 0;
  const result = await processNextProviderNeutralSourceBuild({ ...fx.options,
    preferredAdapter: 'foundry-forge', runCommand: run, claimNext: async () => fx.claim,
    loadGoalContext: async () => '', localModelFetchImpl: async () => { modelCalls++; throw new Error('MODEL_MUST_NOT_RUN'); } });
  assert.equal(result.success, false);
  assert.match(result.error, /PROVIDER_NEUTRAL_AUTHORITATIVE_GOAL_CONTEXT_UNAVAILABLE/);
  assert.equal(modelCalls, 0);
  assert.equal(await readFile(join(fx.repoRoot, 'shared/agents/example.mjs'), 'utf8'), 'export const value = 1;\n');
});

test('actual canonical builder rejects revoked GitHub goal context before model effects', async t => {
  const revokedCases = [
    { number: 3001, state: 'closed', title: 'Goal 3001', body: 'change source', labels: [{ name: 'goal' }] },
    { number: 3001, state: 'open', title: 'Goal 3001', body: 'change source', labels: [{ name: 'other' }] },
    { number: 3001, state: 'open', title: 'Goal 3001', body: 'change source', labels: [{ name: 'goal' }], pull_request: { url: 'https://example.invalid/pr/3001' } },
    { number: 3002, state: 'open', title: 'Goal 3002', body: 'change source', labels: [{ name: 'goal' }] },
  ];
  for (const payload of revokedCases) await t.test(JSON.stringify(payload), async t => {
    const fx = await canonicalSourceFixture(t);
    let modelCalls = 0;
    const result = await processNextProviderNeutralSourceBuild({ ...fx.options,
      preferredAdapter: 'foundry-forge', runCommand: run, claimNext: async () => fx.claim,
      githubAuth: { configured: true, authority: 'test', token: 'test-token' },
      githubFetchImpl: async () => ({ ok: true, status: 200, json: async () => payload }),
      localModelFetchImpl: async () => { modelCalls++; throw new Error('MODEL_MUST_NOT_RUN'); } });
    assert.equal(result.success, false);
    assert.match(result.error, /PROVIDER_NEUTRAL_AUTHORITATIVE_GOAL_CONTEXT_UNAVAILABLE/);
    assert.equal(modelCalls, 0);
    assert.equal(await readFile(join(fx.repoRoot, 'shared/agents/example.mjs'), 'utf8'), 'export const value = 1;\n');
  });
});


test('local Forge builder resolves lowercased mission scope to one exact tracked Git path without widening authority', async () => {
  const fx = await fixture();
  const move = run('git.exe', ['-C', fx.repoRoot, 'mv', 'shared/agents/example.mjs', 'shared/agents/exampleMemory.mjs'], { cwd: fx.repoRoot });
  assert.equal(move.status, 0, move.stderr);
  await writeFile(join(fx.repoRoot, 'focused.test.mjs'), [
    "import test from 'node:test';",
    "import assert from 'node:assert/strict';",
    "import { value } from './shared/agents/exampleMemory.mjs';",
    "test('value is updated', () => assert.equal(value, 2));",
    '',
  ].join('\n'));
  for (const args of [
    ['add', '.'],
    ['commit', '-m', 'camel-case tracked path fixture'],
  ]) {
    const result = run('git.exe', ['-C', fx.repoRoot, ...args], { cwd: fx.repoRoot });
    assert.equal(result.status, 0, result.stderr);
  }

  fx.action.allowedFiles = [
    'shared/agents/examplememory.mjs',
    'shared/agents/examplememory.mjs/**',
  ];
  fx.actionGrant.sourceRevision = run('git.exe', ['-C', fx.repoRoot, 'rev-parse', 'HEAD'], { cwd: fx.repoRoot }).stdout.trim();

  let generatedAction = null;
  let generatedContext = null;
  const result = await processNextProviderNeutralSourceBuild({
    preferredAdapter: 'foundry-forge',
    sharedWorkspaceRoot: fx.sharedWorkspaceRoot,
    readMissionRecord: async () => ({ state: { missionId: fx.action.missionId, cancelled: false } }),
    repoRoot: fx.repoRoot,
    actionGrant: fx.actionGrant,
    runCommand: run,
    claimNext: async (adapter) => adapter === 'foundry-forge' ? fx.claim : null,
    generatePatch: async (action, context) => {
      generatedAction = action;
      generatedContext = context;
      return {
        edits: [{
          path: 'shared/agents/exampleMemory.mjs',
          old: 'export const value = 1;\n',
          new: 'export const value = 2;\n',
        }],
        summary: 'Update the exact tracked camel-case source path.',
      };
    },
    collectAgentWorkerResult: async () => ({ state: { revision: 1 } }),
  });

  assert.equal(result.success, true, result.error);
  assert.deepEqual(generatedAction.allowedFiles, [
    'shared/agents/exampleMemory.mjs',
    'shared/agents/exampleMemory.mjs/**',
  ]);
  assert.deepEqual(
    generatedContext.sourceSnapshots.map(({ path: snapshotPath }) => snapshotPath),
    ['shared/agents/exampleMemory.mjs'],
  );
  assert.equal(
    (await readFile(join(fx.repoRoot, 'shared', 'agents', 'exampleMemory.mjs'), 'utf8')).replace(/\r\n/g, '\n'),
    'export const value = 2;\n',
  );
});


test('local Forge builder hydrates an admitted structured-edit target omitted by bounded source context', async () => {
  const fx = await fixture();
  await writeFile(join(fx.repoRoot, 'shared', 'agents', 'filler-context.txt'), 'x'.repeat(64 * 1024));
  for (const args of [['add', '.'], ['commit', '-m', 'bounded context filler fixture']]) {
    const result = run('git.exe', ['-C', fx.repoRoot, ...args], { cwd: fx.repoRoot });
    assert.equal(result.status, 0, result.stderr);
  }
  fx.action.allowedFiles = ['shared/agents/**'];
  fx.action.intendedOutcome = 'Prioritize filler context while preserving the admitted example target.';
  fx.actionGrant.sourceRevision = run('git.exe', ['-C', fx.repoRoot, 'rev-parse', 'HEAD'], { cwd: fx.repoRoot }).stdout.trim();

  let snapshotsSeen = [];
  const result = await processNextProviderNeutralSourceBuild({
    preferredAdapter: 'foundry-forge',
    sharedWorkspaceRoot: fx.sharedWorkspaceRoot,
    readMissionRecord: async () => ({ state: { missionId: fx.action.missionId, cancelled: false } }),
    repoRoot: fx.repoRoot,
    actionGrant: fx.actionGrant,
    runCommand: run,
    claimNext: async (adapter) => adapter === 'foundry-forge' ? fx.claim : null,
    generatePatch: async (_action, context) => {
      snapshotsSeen = context.sourceSnapshots.map((entry) => entry.path);
      return {
        edits: [{
          path: 'shared/agents/example.mjs',
          old: 'export const value = 1;\n',
          new: 'export const value = 2;\n',
        }],
        summary: 'Edit the admitted target even though bounded prompt context omitted it.',
      };
    },
    collectAgentWorkerResult: async () => ({ state: { revision: 1 } }),
  });

  assert.equal(snapshotsSeen.includes('shared/agents/example.mjs'), false);
  assert.equal(result.success, true, result.error);
  assert.equal(
    (await readFile(join(fx.repoRoot, 'shared', 'agents', 'example.mjs'), 'utf8')).replace(/\r\n/g, '\n'),
    'export const value = 2;\n',
  );
});


for (const oldText of ['do not edit\n', '']) {
test(`local Forge builder rejects an existing ignored target during ${oldText ? 'hydration' : 'creation'}`, async () => {
  const fx = await fixture();
  await writeFile(join(fx.repoRoot, '.gitignore'), 'shared/agents/ignored.txt\n');
  const addIgnore = run('git.exe', ['-C', fx.repoRoot, 'add', '.gitignore'], { cwd: fx.repoRoot });
  assert.equal(addIgnore.status, 0, addIgnore.stderr);
  const commitIgnore = run('git.exe', ['-C', fx.repoRoot, 'commit', '-m', 'ignore hydration escape fixture'], { cwd: fx.repoRoot });
  assert.equal(commitIgnore.status, 0, commitIgnore.stderr);
  await writeFile(join(fx.repoRoot, 'shared', 'agents', 'ignored.txt'), 'do not edit\n');
  fx.action.allowedFiles = ['shared/agents/**'];
  fx.actionGrant.sourceRevision = run('git.exe', ['-C', fx.repoRoot, 'rev-parse', 'HEAD'], { cwd: fx.repoRoot }).stdout.trim();

  const result = await processNextProviderNeutralSourceBuild({
    preferredAdapter: 'foundry-forge',
    sharedWorkspaceRoot: fx.sharedWorkspaceRoot,
    readMissionRecord: async () => ({ state: { missionId: fx.action.missionId, cancelled: false } }),
    repoRoot: fx.repoRoot,
    actionGrant: fx.actionGrant,
    runCommand: run,
    claimNext: async (adapter) => adapter === 'foundry-forge' ? fx.claim : null,
    generatePatch: async () => ({
      edits: [{
        path: 'shared/agents/ignored.txt',
        old: oldText,
        new: 'escaped edit\n',
      }],
      summary: 'Attempt ignored target mutation.',
    }),
    collectAgentWorkerResult: async () => ({ state: { revision: 1 } }),
  });

  assert.equal(result.success, false);
  assert.match(result.error, oldText
    ? /PROVIDER_NEUTRAL_STRUCTURED_EDIT_TARGET_NOT_TRACKED:shared\/agents\/ignored\.txt/
    : /PROVIDER_NEUTRAL_STRUCTURED_EDIT_NEW_FILE_ALREADY_EXISTS:shared\/agents\/ignored\.txt/);
  assert.equal(await readFile(join(fx.repoRoot, 'shared', 'agents', 'ignored.txt'), 'utf8'), 'do not edit\n');
});
}


test('source completion and terminal receipt follow actual tests despite a captured start-time option', async () => {
  const fx = await fixture();
  const started = new Date(Date.now() - 60000);
  const actionId = fx.action.actionId;
  const grant = { ...fx.actionGrant, grantId: 'grant-' + actionId, actionId,
    missionId: fx.action.missionId, missionRevision: 1, repository: fx.action.repository,
    issueNumber: 3001, prNumber: null, branch: fx.action.branch, headSha: fx.actionGrant.sourceRevision };
  fx.claim.item = { ...fx.claim.item, schemaVersion: 'stephanos.mission-worker-queue-item.v1',
    actionId, missionId: fx.action.missionId, actionGrant: grant,
    executionBinding: { ...grant, schemaVersion: 'stephanos.mission-worker-queue-execution-binding.v1',
      executionId: actionId, leaseKey: fx.action.missionId + '-r1-lease' } };
  const queued = createExecutionReceipt({ repository: grant.repository, issueNumber: 3001, prNumber: null,
    branch: grant.branch, sourceHead: grant.sourceRevision, workerId: 'foundry-forge', workerType: 'orchestration-engine',
    executionId: actionId, leaseKey: fx.claim.item.executionBinding.leaseKey, state: 'queued', phase: 'fixture-source-queued',
    sequence: 1, timestampUtc: new Date(started.getTime() - 1000).toISOString(), proofRefs: ['fixture-source-proof'],
    expectedNextAction: 'Source worker must record accepted before execution.' });
  assert.equal((await appendExecutionReceipt(fx.sharedWorkspaceRoot, queued, { repoRoot: fx.repoRoot })).ok, true);
  let collected, collectedAt;
  const result = await processNextProviderNeutralSourceBuild({ preferredAdapter: 'foundry-forge',
    sharedWorkspaceRoot: fx.sharedWorkspaceRoot, repoRoot: fx.repoRoot, actionGrant: grant, now: started,
    readMissionRecord: async () => ({ state: { missionId: fx.action.missionId, cancelled: false } }),
    runCommand: run, claimNext: async () => fx.claim, goalContext: 'Bounded source repair.',
    generatePatch: async () => ({ patch: PATCH, summary: 'Bounded change.' }),
    collectAgentWorkerResult: async record => { collected = record; collectedAt = Date.now(); return { state: { revision: 1 } }; },
  });
  assert.equal(result.success, true, result.error);
  const testAt = Math.max(...collected.evidenceReceipts.map(r => Date.parse(r.createdAt)));
  assert.ok(Date.parse(collected.receipt.createdAt) >= testAt, 'source completion predates its test receipt');
  const bundle = JSON.parse(await readFile(join(fx.sharedWorkspaceRoot, 'source-artifacts', collected.sourceArtifactEscrow.completeArtifactSha256 + '.json'), 'utf8'));
  assert.ok(Date.parse(bundle.completedAtUtc) >= testAt, 'escrow completion predates testing');
  const h = await readExecutionReceiptHistory(fx.sharedWorkspaceRoot, { executionId: actionId }, { repoRoot: fx.repoRoot });
  assert.equal(h.latestReceipt.state, 'completed');
  assert.ok(Date.parse(h.latestReceipt.timestampUtc) >= collectedAt, 'terminal receipt reused the invocation start time');
});


test('failed source terminal receipt follows test failure and result collection', async () => {
  const fx = await fixture(['node --test missing.test.mjs']);
  const started = new Date(Date.now() - 60000);
  const actionId = fx.action.actionId;
  const grant = { ...fx.actionGrant, grantId: 'grant-' + actionId, actionId,
    missionId: fx.action.missionId, missionRevision: 1, repository: fx.action.repository,
    issueNumber: 3001, prNumber: null, branch: fx.action.branch, headSha: fx.actionGrant.sourceRevision };
  fx.claim.item = { ...fx.claim.item, schemaVersion: 'stephanos.mission-worker-queue-item.v1',
    actionId, missionId: fx.action.missionId, actionGrant: grant,
    executionBinding: { ...grant, schemaVersion: 'stephanos.mission-worker-queue-execution-binding.v1',
      executionId: actionId, leaseKey: fx.action.missionId + '-r1-lease' } };
  const queued = createExecutionReceipt({ repository: grant.repository, issueNumber: 3001, prNumber: null,
    branch: grant.branch, sourceHead: grant.sourceRevision, workerId: 'foundry-forge', workerType: 'orchestration-engine',
    executionId: actionId, leaseKey: fx.claim.item.executionBinding.leaseKey, state: 'queued', phase: 'fixture-source-queued',
    sequence: 1, timestampUtc: new Date(started.getTime() - 1000).toISOString(), proofRefs: ['fixture-source-proof'],
    expectedNextAction: 'Source worker must record accepted before execution.' });
  assert.equal((await appendExecutionReceipt(fx.sharedWorkspaceRoot, queued, { repoRoot: fx.repoRoot })).ok, true);
  let collected, collectedAt;
  const result = await processNextProviderNeutralSourceBuild({ preferredAdapter: 'foundry-forge',
    sharedWorkspaceRoot: fx.sharedWorkspaceRoot, repoRoot: fx.repoRoot, actionGrant: grant, now: started,
    readMissionRecord: async () => ({ state: { missionId: fx.action.missionId, cancelled: false } }),
    runCommand: run, claimNext: async () => fx.claim, goalContext: 'Bounded source repair.',
    generatePatch: async () => ({ patch: PATCH, summary: 'Bounded change.' }),
    collectAgentWorkerResult: async record => { collected = record; collectedAt = Date.now(); return { state: { revision: 1 } }; },
  });
  assert.equal(result.success, false);
  assert.match(result.error, /PROVIDER_NEUTRAL_TEST_FAILED/);
  const h = await readExecutionReceiptHistory(fx.sharedWorkspaceRoot, { executionId: actionId }, { repoRoot: fx.repoRoot });
  assert.equal(h.latestReceipt.state, 'failed');
  assert.ok(Date.parse(h.latestReceipt.timestampUtc) >= collectedAt, 'terminal receipt reused the invocation start time');
});

test('low-level goal-context fixture: EOF-only model response is corrected within the existing bounded retry before source mutation', async t => {
  for (const corrected of [true, false]) await t.test(corrected ? 'next response implements behavior' : 'exhaustion preserves source', async () => {
    const fx = await fixture();
    fx.action.missionId = 'unit-goal-context-3001';
    let calls = 0;
    const original = (await readFile(join(fx.repoRoot, 'shared/agents/example.mjs'), 'utf8')).replace(/\r\n/g, '\n');
    const result = await processNextProviderNeutralSourceBuild({
      preferredAdapter: 'foundry-forge', sharedWorkspaceRoot: fx.sharedWorkspaceRoot,
      readMissionRecord: async () => ({state: {missionId: fx.action.missionId, cancelled: false}}),
      repoRoot: fx.repoRoot, actionGrant: fx.actionGrant, runCommand: run,
      claimNext: async adapter => adapter === 'foundry-forge' ? fx.claim : null,
      loadGoalContext: async () => 'Implement the requested value change; acceptance requires value 2.',
      localModelFetchImpl: async (_url, request) => {
        calls += 1;
        assert.equal((await readFile(join(fx.repoRoot, 'shared/agents/example.mjs'), 'utf8')).replace(/\r\n/g, '\n'), original);
        if (calls === 2) assert.match(JSON.parse(request.body).messages[0].content, /PROVIDER_NEUTRAL_STRUCTURED_EDIT_CONTENT_INVALID/);
        const newText = calls === 2 && corrected ? 'export const value = 2;\n' : original + '\n';
        return {ok: true, json: async () => ({message: {content: JSON.stringify({edits: [
          {path: 'shared/agents/example.mjs', old: original, new: newText}], summary: 'Bounded edit'})}})};
      },
      collectAgentWorkerResult: async () => ({state: {revision: 1}}),
    });
    assert.equal(calls, 2);
    assert.equal(result.success, corrected, result.error);
    if (!corrected) {
      assert.match(result.error, /PROVIDER_NEUTRAL_STRUCTURED_EDIT_CONTENT_INVALID/);
      assert.equal(run('git.exe', ['status', '--porcelain'], {cwd: fx.repoRoot}).stdout.trim(), '');
      assert.equal(result.sourceArtifact ?? null, null);
    }
  });
});

test('adding a missing single final newline remains a permitted structured source edit', async () => {
  const fx = await fixture();
  await writeFile(join(fx.repoRoot, 'shared/agents/example.mjs'), 'export const value = 2;');
  assert.equal(run('git.exe', ['add', '.'], {cwd: fx.repoRoot}).status, 0);
  assert.equal(run('git.exe', ['commit', '-m', 'Missing final newline fixture'], {cwd: fx.repoRoot}).status, 0);
  fx.actionGrant.sourceRevision = run('git.exe', ['rev-parse', 'HEAD'], {cwd: fx.repoRoot}).stdout.trim();
  const result = await processNextProviderNeutralSourceBuild({
    preferredAdapter: 'foundry-forge', sharedWorkspaceRoot: fx.sharedWorkspaceRoot,
    readMissionRecord: async () => ({state: {missionId: fx.action.missionId, cancelled: false}}),
    repoRoot: fx.repoRoot, actionGrant: fx.actionGrant, runCommand: run,
    claimNext: async adapter => adapter === 'foundry-forge' ? fx.claim : null,
    generatePatch: async () => ({edits: [{path: 'shared/agents/example.mjs', old: 'export const value = 2;', new: 'export const value = 2;\n'}]}),
    collectAgentWorkerResult: async () => ({state: {revision: 1}}),
  });
  assert.equal(result.success, true, result.error);
});


test('owned local source proposal edits tests and captures bytes without terminal authority', async () => {
  const fx = await fixture();
  Object.assign(fx.actionGrant, {
    adapter: 'foundry-forge', actionKind: 'agent-handoff',
    capacityRoute: 'FOUNDRY_FORGE', workerId: 'stephanos-forge-lifeboat-local',
    boundedActionCount: 1, mergeAuthority: false, leaseSeizureAllowed: false,
    missionId: fx.action.missionId, actionId: fx.action.actionId,
    repository: fx.action.repository, branch: fx.action.branch,
  });
  Object.assign(fx.claim.item, {schemaVersion: 'stephanos.mission-worker-queue-item.v1',
    adapter: 'foundry-forge', missionId: fx.action.missionId, actionId: fx.action.actionId});
  await writeFile(fx.claim.processingPath, JSON.stringify(fx.claim.item));
  const originalClaim = await readFile(fx.claim.processingPath, 'utf8');
  const forbidden = () => { throw new Error('PROPOSAL_TERMINAL_AUTHORITY_USED'); };
  const result = await produceProviderNeutralSourceBuildProposalV1(fx.claim, {
    sharedWorkspaceRoot: fx.sharedWorkspaceRoot, repoRoot: fx.repoRoot,
    actionGrant: fx.actionGrant, runCommand: run,
    readMissionRecord: async () => ({state: {missionId: fx.action.missionId, cancelled: false}}),
    claimNext: forbidden, collectAgentWorkerResult: forbidden,
    finalizeMissionWorkerQueueClaim: forbidden,
    localModelFetchImpl: async () => new Response(JSON.stringify({done: true,
      message: {content: JSON.stringify({edits: [{path:'shared/agents/example.mjs',
        old:'export const value = 1;', new:'export const value = 2;'}, {path:'shared/agents/example.identity.test.mjs',old:'',
        new:"import assert from 'node:assert/strict';\nimport {value} from './example.mjs';\nassert.equal(value,2);\n"}], summary:'fixture repair'})}}) + '\n'),
  });
  assert.equal(result.success, true, result.error);
  assert.deepEqual(result.changedFiles, ['shared/agents/example.identity.test.mjs','shared/agents/example.mjs']);
  assert.equal(result.execution.ownedRegressionReceipts.length,1);
  assert.equal(result.execution.sourceTestReceipts.length,2);
  assert.deepEqual(result.execution.changedFiles, result.changedFiles);
  assert.ok(result.sourceArtifactIdentity);
  assert.equal(await readFile(fx.claim.processingPath, 'utf8'), originalClaim);
  assert.match(await readFile(join(fx.repoRoot,'shared/agents/example.mjs'),'utf8'), /value = 2/);
  assert.equal(existsSync(join(fx.sharedWorkspaceRoot,'source-artifacts')), false);
  assert.equal(existsSync(join(fx.sharedWorkspaceRoot,'publication-outbox')), false);
});

test('source proposal rejects absent bounded runner and wrong class before execution', async () => {
  const fx = await fixture();
  await assert.rejects(produceProviderNeutralSourceBuildProposalV1(fx.claim), /BOUNDED_RUNNER_REQUIRED/);
  await assert.rejects(produceProviderNeutralSourceBuildProposalV1(fx.claim, {
    runCommand: () => { throw new Error('RUNNER_MUST_NOT_RUN'); },
    localModelFetchImpl: () => { throw new Error('MODEL_MUST_NOT_RUN'); },
  }), /LOCAL_SOURCE_PROPOSAL_CLAIM_REQUIRED/);
});

test('copied canonical seed proposal context cannot replace authenticated native child custody', async t => {
  const fx = await fixture();
  t.after(() => rm(fx.parent, { recursive: true, force: true }));
  const missionId = 'critical-3106-elastic-goal', actionId = 'critical-3106-elastic-goal-source-1';
  Object.assign(fx.action, { missionId, actionId, branch: 'openclaw/elastic-goal-3106' });
  Object.assign(fx.actionGrant, { adapter: 'foundry-forge', actionKind: 'agent-handoff',
    capacityRoute: 'FOUNDRY_FORGE', workerId: 'stephanos-forge-lifeboat-local',
    boundedActionCount: 1, mergeAuthority: false, leaseSeizureAllowed: false,
    missionId, actionId, repository: fx.action.repository, branch: fx.action.branch,
    sourcePlanFingerprint: 'a'.repeat(64) });
  Object.assign(fx.claim.item, { schemaVersion: 'stephanos.mission-worker-queue-item.v1',
    adapter: 'foundry-forge', missionId, actionId });
  const original = await readFile(join(fx.repoRoot, 'shared/agents/example.mjs'), 'utf8');
  const noEffects = () => assert.fail('copied proposal context produced an effect');
  await assert.rejects(produceProviderNeutralSourceBuildProposalV1(fx.claim, {
    repoRoot: fx.repoRoot, sharedWorkspaceRoot: fx.sharedWorkspaceRoot, actionGrant: fx.actionGrant,
    runCommand: noEffects, localModelFetchImpl: noEffects, generatePatch: noEffects,
    // Deliberately plausible copied flags are not authority.
    semanticAdmissionVerified: true, nativeParentAuthenticated: true,
  }), /SOURCE_TASK_CHILD_SEMANTIC_CUSTODY_REQUIRED/);
  assert.equal(await readFile(join(fx.repoRoot, 'shared/agents/example.mjs'), 'utf8'), original);
  assert.equal(existsSync(join(fx.sharedWorkspaceRoot, 'source-artifacts')), false);
});

test('standalone copied source proposals cannot evade semantic custody through mission identity aliases', async () => {
  for (const missionId of ['critical-3106-elastic-goal', 'CRITICAL-3106-ELASTIC-GOAL',
    'critical-3106-Elastic-goal', ' critical-3106-elastic-goal', 'critical-03106-elastic-goal',
    'critical-3106-elastic-goal-copy', 'critical-3106-elastic-goalcopy',
    'critical-3106-elastic-goal:copy', 'critical_3106_elastic_goal']) {
    const actionId = 'copied-source-action';
    const action = { missionId, actionId, adapter: 'foundry-forge', actionKind: 'agent-handoff',
      repository: 'Cheekyfellastef/stephan-os', branch: missionId === 'critical-3106-elastic-goal'
        ? 'openclaw/elastic-goal-3106' : 'openclaw/unit-source-engine',
      worktreePath: 'C:\\unobserved-fixture', allowedFiles: ['shared/agents/example.mjs'],
      requiredTests: ['node --test shared/agents/example.test.mjs'] };
    const grant = { schemaVersion: 'stephanos.mission-worker-action-grant.v1', missionId, actionId,
      adapter: 'foundry-forge', actionKind: 'agent-handoff', branch: action.branch,
      repository: action.repository, capacityRoute: 'FOUNDRY_FORGE', workerId: 'stephanos-forge-lifeboat-local',
      boundedActionCount: 1, mergeAuthority: false, leaseSeizureAllowed: false, sourceRevision: 'a'.repeat(40),
      sourcePlanFingerprint: 'b'.repeat(64), sourcePlanKind: 'SEED_SELF' };
    const claim = { adapter: 'foundry-forge', processingPath: 'C:\\unobserved-fixture\\copied.json',
      item: { schemaVersion: 'stephanos.mission-worker-queue-item.v1', adapter: 'foundry-forge',
        missionId, actionId, payload: action, actionGrant: grant } };
    let runnerCalls = 0, modelCalls = 0;
    await assert.rejects(produceProviderNeutralSourceBuildProposalV1(claim, {
      runCommand: () => { runnerCalls++; throw new Error('RUNNER_MUST_NOT_RUN'); },
      localModelFetchImpl: () => { modelCalls++; throw new Error('MODEL_MUST_NOT_RUN'); },
    }), missionId === 'critical-3106-elastic-goal'
      ? /SOURCE_TASK_CHILD_SEMANTIC_CUSTODY_REQUIRED/ : /NONCANONICAL_ELASTIC_MISSION_IDENTITY/);
    assert.equal(runnerCalls, 0, missionId); assert.equal(modelCalls, 0, missionId);
  }
});
