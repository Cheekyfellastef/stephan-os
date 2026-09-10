import test from 'node:test';
import assert from 'node:assert/strict';
import { reviewExactHead } from './exact-head-review.mjs';

const base = {
  repository: 'Cheekyfellastef/stephan-os',
  prNumber: 42,
  baseSha: 'a'.repeat(40),
  headSha: 'b'.repeat(40),
  changedFiles: ['shared/runtime/example.mjs'],
  patch: 'diff --git a/shared/runtime/example.mjs b/shared/runtime/example.mjs\n+export const safe = true;\n',
};

test('passes a bounded non-authority exact-head patch', () => {
  const receipt = reviewExactHead(base);
  assert.equal(receipt.verdict, 'STEPHANOS_REVIEW_PASS');
  assert.deepEqual(receipt.findings, []);
  assert.equal(receipt.headSha, base.headSha);
  assert.equal(receipt.authority.mayMerge, false);
});

test('fails closed when full SHA evidence is absent', () => {
  const receipt = reviewExactHead({ ...base, headSha: 'abc' });
  assert.equal(receipt.verdict, 'STEPHANOS_REVIEW_FINDINGS');
  assert.ok(receipt.findings.some(({ code }) => code === 'INVALID_SHA'));
});

test('escalates every authority-sensitive workflow change', () => {
  const receipt = reviewExactHead({ ...base, changedFiles: ['.github/workflows/merge.yml'] });
  assert.ok(receipt.findings.some(({ code, severity }) => code === 'AUTHORITY_SURFACE_CHANGED' && severity === 'P2'));
});

test('detects common child-process execution entry points', () => {
  for (const call of ['exec(command)', 'execSync(command)', 'execFile(file)', 'spawn(command)', 'spawnSync(command)', 'fork(modulePath)']) {
    const receipt = reviewExactHead({ ...base, patch: `+${call}\n` });
    assert.ok(receipt.findings.some(({ code }) => code === 'DYNAMIC_EXECUTION'), call);
  }
});

test('ignores inert execution-shaped strings and direct RegExp exec while retaining real execution calls', () => {
  for (const patch of [
    "+const fixture = \"spawnSync('powershell.exe')\";\n",
    "+const fixture = 'exec(command)';\n",
    "+const fixture = \`shell: true spawnSync(command)\`;\n",
    "+const match = /^goal-(\\d+)-pr-(\\d+)$/i.exec(text(missionId));\n",
  ]) {
    const receipt = reviewExactHead({ ...base, patch });
    assert.equal(receipt.findings.some(({ code }) => code === 'DYNAMIC_EXECUTION'), false, patch);
  }

  for (const patch of [
    "+spawnSync('powershell.exe', [], { shell: false });\n",
    "+child_process.exec(command);\n",
    "+const fixture = 'spawnSync(command)'; spawnSync(command);\n",
  ]) {
    const receipt = reviewExactHead({ ...base, patch });
    assert.equal(receipt.findings.some(({ code }) => code === 'DYNAMIC_EXECUTION'), true, patch);
  }
});

test('blocks likely secrets and conflict markers without matching quoted detector fixtures', () => {
  const receipt = reviewExactHead({
    ...base,
    patch: '+<<<<<<< HEAD\n+-----BEGIN PRIVATE KEY-----\n',
  });
  assert.ok(receipt.findings.some(({ code }) => code === 'CONFLICT_MARKER'));
  assert.ok(receipt.findings.some(({ code }) => code === 'SECRET_PATTERN'));

  const quotedFixture = reviewExactHead({
    ...base,
    patch: "+const fixture = '+-----BEGIN PRIVATE KEY-----';\n",
  });
  assert.equal(quotedFixture.findings.some(({ code }) => code === 'SECRET_PATTERN'), false);
});
