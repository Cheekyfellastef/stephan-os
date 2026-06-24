import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));
const bootstrapScript = fileURLToPath(new URL('../scripts/stephanos-bootstrap-openclaw-github-keys.mjs', import.meta.url));
const verifierScript = fileURLToPath(new URL('../scripts/verify-mission-operations-receipt.mjs', import.meta.url));
const acceptanceScript = fileURLToPath(new URL('../scripts/windows/verify-openclaw-mission-operations-acceptance.ps1', import.meta.url));

function run(script, args = []) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    shell: false,
  });
}

test('key bootstrap creates an Ed25519 pair once without exposing private material', () => {
  const directory = mkdtempSync(join(tmpdir(), 'stephanos-keys-'));
  const privatePath = join(directory, 'private.pem');
  const publicPath = join(directory, 'public.pem');
  const first = run(bootstrapScript, [privatePath, publicPath]);
  assert.equal(first.status, 0, first.stderr || first.stdout);
  const firstResult = JSON.parse(first.stdout);
  assert.equal(firstResult.finalVerdict, 'STEPHANOS_GITHUB_SIGNING_KEYS_CREATED');
  assert.equal(firstResult.keysCreated, true);
  assert.match(readFileSync(privatePath, 'utf8'), /BEGIN PRIVATE KEY/);
  assert.match(readFileSync(publicPath, 'utf8'), /BEGIN PUBLIC KEY/);
  assert.doesNotMatch(first.stdout, /BEGIN (PRIVATE|PUBLIC) KEY/);

  const second = run(bootstrapScript, [privatePath, publicPath]);
  assert.equal(second.status, 0, second.stderr || second.stdout);
  assert.equal(JSON.parse(second.stdout).finalVerdict, 'STEPHANOS_GITHUB_SIGNING_KEYS_PRESENT');
});

test('key bootstrap blocks an incomplete existing pair', () => {
  const directory = mkdtempSync(join(tmpdir(), 'stephanos-partial-keys-'));
  const privatePath = join(directory, 'private.pem');
  const publicPath = join(directory, 'public.pem');
  writeFileSync(privatePath, 'existing-private-key');
  const result = run(bootstrapScript, [privatePath, publicPath]);
  assert.equal(result.status, 1);
  assert.match(JSON.parse(result.stdout).message, /incomplete/i);
});

test('receipt verifier accepts a completed signed operation projected into the feed', () => {
  const directory = mkdtempSync(join(tmpdir(), 'stephanos-acceptance-receipt-'));
  const missionId = 'mission-operations-production-acceptance';
  writeFileSync(join(directory, 'operation.json'), JSON.stringify({
    schemaVersion: 'stephanos.openclaw-github-operation-result.v1',
    missionId,
    authorizationId: 'auth-mission-operations-acceptance',
    operation: 'inspect',
    repository: 'Cheekyfellastef/stephan-os',
    branch: 'feature/mission-operations-dashboard-v1',
    baseBranch: 'main',
    completedAt: new Date().toISOString(),
    executorExitCode: 0,
    executorOutputHash: 'a'.repeat(64),
    receipts: [{ executable: 'git.exe', exitCode: 0, commandOutputHash: 'b'.repeat(64) }],
    blockers: [],
    finalVerdict: 'OPENCLAW_GITHUB_OPERATION_PASS',
  }));
  const result = run(verifierScript, [directory, missionId]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.missionFound, true);
  assert.equal(payload.missionState, 'COMPLETE');
  assert.equal(payload.finalVerdict, 'STEPHANOS_MISSION_OPERATIONS_ACCEPTANCE_PASS');
});

test('Windows acceptance runner is read-only and uses the signed issuer and bridge', () => {
  const source = readFileSync(acceptanceScript, 'utf8');
  assert.match(source, /operation\s+= "inspect"/);
  assert.match(source, /stephanos-issue-openclaw-github-authorization\.mjs/);
  assert.match(source, /invoke-openclaw-github-operator-bridge\.ps1/);
  assert.match(source, /verify-mission-operations-receipt\.mjs/);
  assert.match(source, /READ_ONLY_OPERATION=True/);
  assert.doesNotMatch(source, /operation\s+= "(commit|push|open-pr|merge-pr)"/);
  assert.doesNotMatch(source, /git\.exe[^\r\n]*(commit|push|merge|checkout|reset)/i);
});
