import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import manifest from './sovereignSpecialistAuthorityClosureV1.json' with { type: 'json' };
import { makeFixture, isolatedModules } from './fixtures/sovereign-qualified-specialist-fixture-v1.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const declaration = 'shared/agents/sovereignSpecialistAuthorityClosureV1.json';
const proofScript = join(root, 'scripts/fixtures/sovereign-specialist-authority-closure-v1.mjs');
const protectedPaths = [...new Set([...manifest.modules, ...manifest.protectedFiles])].sort();
function probe(candidateRoot) {
  const child = spawnSync(process.execPath, ['--experimental-vm-modules', proofScript, candidateRoot], { encoding: 'utf8', timeout: 15000, maxBuffer: 2 * 1024 * 1024 });
  assert.equal(child.error, undefined); assert(child.stdout, child.stderr); return JSON.parse(child.stdout);
}

test('actual trusted intake/receipt/base-binding closure is complete, resolved and parse-only', () => {
  const result = probe(root); assert.equal(result.valid, true, result.errors.join('\n'));
  assert.equal(result.repositoryModulesEvaluated, false); assert.deepEqual(result.modules, manifest.modules);
  for (const file of ['shared/agents/executionReceiptV1.mjs', 'shared/agents/mainMovementTolerantOperatorAuthorizationV1.mjs',
    'shared/agents/operatorMergeApprovalGateV2.mjs', 'shared/agents/operatorMergeApprovalGateV2IndependentReviewRunNamePolicyV1.mjs',
    'shared/agents/independentReviewWorkflowDispatchAdmissionV1.mjs']) assert(protectedPaths.includes(file), file);
});

test('existing read-only hosted job explicitly executes every new source proof suite', () => {
  const workflow = readFileSync(join(root, '.github/workflows/operator-merge-approval-gate-test.yml'), 'utf8');
  assert.match(workflow, /permissions:\n  contents: read\n/);
  assert.match(workflow, /protected-merge-source-proof:\n    runs-on: ubuntu-latest/);
  const step = workflow.split('- name: Prove signed specialist intake and closed source authority')[1]?.split('\n      - name:')[0];
  assert(step); assert.match(step, /node --test /);
  for (const path of ['shared/agents/sovereignQualifiedSpecialistReviewV1.test.mjs',
    'shared/agents/sovereignQualifiedSpecialistSourceV1.test.mjs', 'shared/agents/sovereignSpecialistAuthorityClosureV1.test.mjs',
    'shared/agents/sovereignAuthenticatedReviewDiffV1.test.mjs']) assert(step.includes(path), path);
});

for (const path of protectedPaths) test('each authority-closure path alone requires a separate fourth root: ' + path, async () => {
  const f = makeFixture([path]);
  const result = (await isolatedModules(f)).verifier.validateSovereignQualifiedSpecialistArtifactV1(f.artifact, f.expected);
  assert.equal(result.valid, false); assert.deepEqual(result.blockers, ['SOVEREIGN_SPECIALIST_OUT_OF_BAND_ROOT_REQUIRED']);
});

test('Windows case alias retains the same fourth-root requirement', async () => {
  const f = makeFixture(['shared/agents/ExecutionReceiptV1.mjs']);
  const result = (await isolatedModules(f)).verifier.validateSovereignQualifiedSpecialistArtifactV1(f.artifact, f.expected);
  assert.equal(result.valid, false); assert.deepEqual(result.blockers, ['SOVEREIGN_SPECIALIST_OUT_OF_BAND_ROOT_REQUIRED']);
});

for (const [label, mutate] of [
  ['omitted transitive member', dir => { const p = join(dir, declaration), m = JSON.parse(readFileSync(p)); m.modules = m.modules.filter(v => v !== 'shared/agents/executionReceiptV1.mjs'); writeFileSync(p, JSON.stringify(m)); }],
  ['new literal import', dir => writeFileSync(join(dir, 'shared/agents/executionReceiptV1.mjs'), "import './unreviewed-policy.mjs';\n" + readFileSync(join(dir, 'shared/agents/executionReceiptV1.mjs'), 'utf8'))],
  ['computed dynamic import', dir => writeFileSync(join(dir, 'shared/agents/mainMovementTolerantOperatorAuthorizationV1.mjs'), "const untrusted = './hidden.mjs'; await import(untrusted);\n" + readFileSync(join(dir, 'shared/agents/mainMovementTolerantOperatorAuthorizationV1.mjs'), 'utf8'))],
  ['changed fixed switchboard', dir => writeFileSync(join(dir, 'shared/agents/windowsAuthoritySpecialistReviewV1.mjs'), readFileSync(join(dir, 'shared/agents/windowsAuthoritySpecialistReviewV1.mjs'), 'utf8') + '\n// changed pinned interpretation\n')],
  ['undeclared workflow root', dir => writeFileSync(join(dir, '.github/workflows/independent-merge-security-review.yml'), readFileSync(join(dir, '.github/workflows/independent-merge-security-review.yml'), 'utf8') + '\n      - run: node scripts/unreviewed-producer.mjs\n')],
]) test('closure drift rejects ' + label, () => {
  const dir = mkdtempSync(join(tmpdir(), 'sovereign-authority-closure-'));
  try {
    for (const path of protectedPaths) { const target = join(dir, path); mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, readFileSync(join(root, path))); }
    mutate(dir); const result = probe(dir); assert.equal(result.valid, false); assert(result.errors.length > 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
