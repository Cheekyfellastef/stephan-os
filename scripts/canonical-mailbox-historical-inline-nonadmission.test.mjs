import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { CANONICAL_MAILBOX_ISSUE } from '../shared/agents/canonicalMailboxAuthorityV1.mjs';

const repository = 'Cheekyfellastef/stephan-os';
const historicalHead = '0b6d131bf9b359c2a118b881f8dedeff4acd8692';
const expectedIdsDigest = 'a073a6d0abca2d7b28d04be73142772c05bb23d0dfc84b13226c5306f53df90e';
const root = fileURLToPath(new URL('../', import.meta.url));
const fixtures = resolve(root, 'tests/fixtures/canonical-mailbox-rotation');
const manifest = JSON.parse(readFileSync(resolve(fixtures, 'historical-0b6-cohort.json'), 'utf8'));
let workspace, checkoutHead, caseNumber = 0;

// Copy real production modules, including their local static imports. No guard
// or receipt builder is replaced. The GitHub transport is inert in the child.
function copyModuleClosure(path, seen = new Set()) {
  if (seen.has(path)) return;
  seen.add(path);
  const sourcePath = resolve(root, path);
  assert.ok(!relative(root, sourcePath).startsWith('..'));
  const source = readFileSync(sourcePath, 'utf8');
  const target = resolve(workspace, path);
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(sourcePath, target);
  const imports = [...source.matchAll(/\bfrom\s*['"](\.{1,2}\/[^'"]+)['"]/g),
    ...source.matchAll(/\bimport\s*['"](\.{1,2}\/[^'"]+)['"]/g)];
  for (const match of imports) {
    copyModuleClosure(relative(root, resolve(dirname(sourcePath), match[1])), seen);
  }
}

function historicalInline(workflow, stepName) {
  const contract = manifest.contracts.find(c => c.path.endsWith('/' + workflow));
  assert.ok(contract, 'exact historical workflow required');
  const lines = readFileSync(resolve(fixtures, contract.fixturePath), 'utf8').split('\n');
  const starts = lines.flatMap((line, index) => line === '      - name: ' + stepName ? [index] : []);
  assert.equal(starts.length, 1, 'historical step must be unique');
  const start = starts[0];
  let end = lines.findIndex((line, index) => index > start && /^      - name: /.test(line));
  if (end < 0) end = lines.length;
  const step = lines.slice(start, end);
  assert.ok(step.includes('        uses: actions/github-script@v7'));
  const marker = step.indexOf('          script: |');
  assert.ok(marker >= 0);
  return step.slice(marker + 1).map(line => {
    assert.ok(line === '' || line.startsWith('            '), 'fixed literal script indentation');
    return line.slice(12);
  }).join('\n').trimEnd() + '\n';
}

// This function is serialized into a separate Node process. The unchanged
// historical inline script imports the real central guard with its defaults.
async function historicalInlineChild() {
  const { readFileSync } = await import('node:fs');
  const { resolve } = await import('node:path');
  const { pathToFileURL } = await import('node:url');
  const data = JSON.parse(readFileSync(process.argv[2], 'utf8'));
  const writes = [], reads = [];
  let mainReads = 0, admittedEarlier = false;
  globalThis.fetch = async (url, options = {}) => {
    if ((options.method || 'GET') !== 'GET') throw Error('TEST_NETWORK_MUTATION_DENIED');
    const path = String(url).replace('https://api.github.com/repos/Cheekyfellastef/stephan-os', '');
    reads.push(path);
    let value;
    if (path === '/branches/main') {
      mainReads++;
      const moved = data.mainMovement === 'during' && mainReads > 1
        || data.mainMovement === 'after-ingress' && admittedEarlier;
      value = { commit: { sha: moved ? 'f'.repeat(40) : data.checkoutHead } };
    } else if (path === '/issues/2315/comments?per_page=100&page=1') {
      value = [];
    } else {
      throw Error('TEST_UNEXPECTED_GITHUB_READ:' + path);
    }
    return { status: 200, text: async () => JSON.stringify(value) };
  };
  const write = name => async args => {
    writes.push({ name, args });
    return { data: { id: 1 } };
  };
  const unexpected = async () => { throw Error('TEST_UNEXPECTED_PUBLISHER_READ'); };
  const github = {
    paginate: unexpected,
    rest: { issues: {
      listComments: unexpected, get: unexpected,
      createComment: write('createComment'), updateComment: write('updateComment'),
      update: write('update'), create: write('create'),
    } },
  };
  const fence = String.fromCharCode(96).repeat(3);
  const historicalRequest = {
    schemaVersion: 'stephanos.battle-bridge-tailscale-bootstrap-prerequisites.v1',
    requestId: 'historical-observer-inline-fixture-v1',
    operation: 'CHECK_BOOTSTRAP_PREREQUISITES',
    repository: 'Cheekyfellastef/stephan-os', issueNumber: 3258,
    expectedHead: data.historicalHead, expiresAt: '2026-11-11T21:00:00.000Z',
  };
  const context = {
    repo: { owner: 'Cheekyfellastef', repo: 'stephan-os' },
    runId: Number(process.env.GITHUB_RUN_ID),
    payload: { comment: { body: fence + 'stephanos-battle-bridge-tailscale-bootstrap-prerequisites\n'
      + JSON.stringify(historicalRequest) + '\n' + fence } },
  };
  const core = { info() {}, setOutput() {}, setFailed(message) { throw Error(message); } };
  let error = '';
  try {
    if (data.mainMovement === 'after-ingress') {
      const guard = await import(pathToFileURL(resolve('scripts/canonical-mailbox-workflow-admission-v1.mjs')).href);
      await guard.assertMailboxRotationWorkflowAdmission({ mode: 'observer' });
      admittedEarlier = true;
    }
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    await new AsyncFunction('github', 'context', 'core', data.script)(github, context, core);
  } catch (caught) {
    error = caught.message;
  }
  process.stdout.write(JSON.stringify({ error, writes, reads, mainReads, admittedEarlier }));
}

before(() => {
  workspace = mkdtempSync(resolve(tmpdir(), 'mailbox-historical-inline-'));
  const seen = new Set();
  for (const path of [
    'scripts/canonical-mailbox-workflow-admission-v1.mjs',
    'shared/agents/battleBridgeTailscalePrerequisiteProofV1.mjs',
    'shared/agents/battleBridgeOutOfBandObserverReceiptV1.mjs',
  ]) copyModuleClosure(path, seen);
  const options = { cwd: workspace, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] };
  execFileSync('git', ['init', '-q', '--initial-branch=main'], options);
  execFileSync('git', ['-c', 'core.autocrlf=false', 'add', '--', 'scripts', 'shared'], options);
  execFileSync('git', ['-c', 'user.name=Mailbox fixture', '-c', 'user.email=fixture@example.invalid',
    '-c', 'commit.gpgsign=false', 'commit', '-qm', 'Isolated production module fixture'], options);
  checkoutHead = execFileSync('git', ['rev-parse', 'HEAD'], options).trim();
  assert.match(checkoutHead, /^[a-f0-9]{40}$/);
  assert.notEqual(checkoutHead, historicalHead);
  writeFileSync(resolve(workspace, 'inline-runner.mjs'),
    '(' + historicalInlineChild.toString() + ')().catch(error => { console.error(error.stack); process.exitCode = 1; });\n');
});
after(() => { if (workspace) rmSync(workspace, { recursive: true, force: true }); });

function executeHistoricalInline(workflow, stepName, {
  eventHead = historicalHead, mainMovement = '', job = 'mirror',
} = {}) {
  const input = resolve(workspace, 'inline-case-' + (++caseNumber) + '.json');
  writeFileSync(input, JSON.stringify({
    script: historicalInline(workflow, stepName), checkoutHead, historicalHead, mainMovement,
  }));
  const env = {
    ...process.env,
    GITHUB_ACTIONS: 'true', GITHUB_EVENT_NAME: 'issue_comment',
    GITHUB_REPOSITORY: repository, GITHUB_REPOSITORY_ID: '1179385578',
    GITHUB_REPOSITORY_OWNER: 'Cheekyfellastef', GITHUB_REPOSITORY_OWNER_ID: '267490109',
    GITHUB_REF: 'refs/heads/main', GITHUB_JOB: job,
    GITHUB_SHA: eventHead, GITHUB_WORKFLOW_SHA: eventHead,
    GITHUB_WORKFLOW_REF: repository + '/.github/workflows/' + workflow + '@refs/heads/main',
    GITHUB_RUN_ID: '43098316466', GITHUB_RUN_ATTEMPT: '1',
    // A file URL preserves the unchanged inline import on Windows as well.
    GITHUB_WORKSPACE: pathToFileURL(workspace).href,
    GITHUB_TOKEN: 'inert-test-token', GH_TOKEN: '',
    SETTINGS_PATH: '', REMOTE_RECEIPT_PATH: '', TAILNET_OUTCOME: '', REMOTE_OUTCOME: '',
  };
  delete env.GIT_DIR;
  delete env.GIT_WORK_TREE;
  return JSON.parse(execFileSync(process.execPath, [resolve(workspace, 'inline-runner.mjs'), input],
    { cwd: workspace, env, encoding: 'utf8', timeout: 15000 }));
}

test('fixed historical cohort preserves all exact source blobs and 162 unique run identities', () => {
  assert.equal(manifest.expectedCount, 162);
  const ids = manifest.contracts.flatMap(c => c.runIds).sort((a, b) => a - b);
  assert.equal(ids.length, 162);
  assert.equal(new Set(ids).size, 162);
  assert.equal(createHash('sha256').update(JSON.stringify(ids)).digest('hex'), expectedIdsDigest);
  assert.equal(manifest.contracts.filter(c => c.kind === 'static-checkout').flatMap(c => c.runIds).length, 17);
  assert.equal(manifest.contracts.filter(c => c.kind === 'event-generation').flatMap(c => c.runIds).length, 145);
  for (const item of [...manifest.contracts, ...manifest.staticSourceClosure]) {
    assert.equal(item.head, historicalHead);
    const bytes = readFileSync(resolve(fixtures, item.fixturePath));
    assert.equal(createHash('sha1').update('blob ' + bytes.length + '\0').update(bytes).digest('hex'), item.blob);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), item.sourceSha256);
  }
});

const publishers = [
  ['mailbox-receipt-index.yml', 'Update compact receipt truth surfaces', 'mirror'],
  ['mailbox-receipt-index.yml', 'Observe capacity and prepare one inactive successor through existing owner', 'mirror'],
  ['codex-banked-reset-telemetry.yml', 'Replace compact telemetry issue body from trusted receipts', 'mirror'],
  ['battle-bridge-out-of-band-observer-v1.yml', 'Publish terminal external observer receipt', 'observe'],
];
for (const [workflow, step, job] of publishers) {
  test('actual old inline publisher denies stale event before any GitHub write: ' + step, () => {
    const result = executeHistoricalInline(workflow, step, { job });
    assert.equal(result.error, 'MAILBOX_WORKFLOW_EVENT_SOURCE_STALE');
    assert.deepEqual(result.writes, []);
  });
}

const observerWorkflow = 'battle-bridge-out-of-band-observer-v1.yml';
const observerStep = 'Publish terminal external observer receipt';
for (const eventHead of ['', 'not-a-valid-source-sha']) {
  test('actual observer always-finalizer denies ' + (eventHead ? 'malformed' : 'missing') + ' event source', () => {
    const result = executeHistoricalInline(observerWorkflow, observerStep, { eventHead, job: 'observe' });
    assert.equal(result.error, 'MAILBOX_WORKFLOW_EVENT_CONTEXT_INVALID');
    assert.deepEqual(result.writes, []);
  });
}

test('actual observer always-finalizer rechecks source after an earlier successful ingress', () => {
  const result = executeHistoricalInline(observerWorkflow, observerStep, {
    eventHead: checkoutHead, job: 'observe', mainMovement: 'after-ingress',
  });
  assert.equal(result.admittedEarlier, true);
  assert.equal(result.error, 'MAILBOX_WORKFLOW_SOURCE_STALE');
  assert.deepEqual(result.writes, []);
});

test('actual observer always-finalizer denies main movement within its own recheck', () => {
  const result = executeHistoricalInline(observerWorkflow, observerStep, {
    eventHead: checkoutHead, job: 'observe', mainMovement: 'during',
  });
  assert.equal(result.error, 'MAILBOX_WORKFLOW_MAIN_MOVED');
  assert.deepEqual(result.writes, []);
});

test('fresh workflow generation can publish a historical request receipt through the actual inline finalizer', () => {
  const result = executeHistoricalInline(observerWorkflow, observerStep, { eventHead: checkoutHead, job: 'observe' });
  assert.equal(result.error, '');
  assert.equal(result.writes.length, 1);
  assert.equal(result.writes[0].name, 'createComment');
  assert.equal(result.writes[0].args.issue_number, CANONICAL_MAILBOX_ISSUE);
  assert.ok(result.writes[0].args.body.includes(historicalHead));
  assert.ok(result.writes[0].args.body.includes('historical-observer-inline-fixture-v1'));
});
