import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  classifyExactCurrentMainReviewTarget,
  filterExactCurrentMainReviewTargets,
  main,
  parseReviewPlanTargets,
  resolveExactCurrentMainReviewTargets,
} from './exact-head-review-current-main-admission-v1.mjs';

const REPOSITORY = 'Cheekyfellastef/stephan-os';
const MAIN = '3c14072e57d1235e897a89226405dfee569c3ecf';
const OLD_MAIN = 'ddff35b514125e71b4d742e433628b79538887da';
const HEAD = 'dea9de4cee5346fef3cd21b010e3c93e7b8b9ec6';
const WORKFLOW_URL = new URL('../.github/workflows/exact-head-review-dispatch.yml', import.meta.url);

function pr(number, baseSha = MAIN, overrides = {}) {
  return {
    number,
    state: 'open',
    base: { ref: 'main', sha: baseSha },
    head: { sha: HEAD, repo: { full_name: REPOSITORY } },
    ...overrides,
  };
}

function response(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() { return JSON.stringify(payload); },
  };
}

test('parses a bounded unique PR target list and rejects duplicate or malformed identities', () => {
  assert.deepEqual(parseReviewPlanTargets('[{"prNumber":2010},{"prNumber":1742}]'), [{ prNumber: 2010 }, { prNumber: 1742 }]);
  assert.throws(() => parseReviewPlanTargets('[{"prNumber":1742},{"prNumber":1742}]'), /duplicate review plan target/);
  assert.throws(() => parseReviewPlanTargets('[{"prNumber":"nope"}]'), /positive integer prNumber/);
});

test('reproduces the #1742 stale-base lane and holds it outside scheduled coordination', () => {
  const classification = classifyExactCurrentMainReviewTarget({ repository: REPOSITORY, currentMainSha: MAIN, pullRequest: pr(1742, OLD_MAIN) });
  assert.equal(classification.eligible, false);
  assert.equal(classification.reason, 'BASE_NOT_EXACT_CURRENT_MAIN');
  assert.equal(classification.baseSha, OLD_MAIN);
  assert.equal(classification.currentMainSha, MAIN);
});

test('keeps a canonical current-main lane eligible so bounded stalled-receipt recovery is not disabled', () => {
  const classification = classifyExactCurrentMainReviewTarget({ repository: REPOSITORY, currentMainSha: MAIN, pullRequest: pr(2010, MAIN) });
  assert.equal(classification.eligible, true);
  assert.equal(classification.reason, 'EXACT_CURRENT_MAIN');
});

test('filters stale, closed and cross-repository lanes while retaining exact-current-main targets', () => {
  const result = filterExactCurrentMainReviewTargets({
    repository: REPOSITORY,
    currentMainSha: MAIN,
    targets: [{ prNumber: 1742 }, { prNumber: 2010 }, { prNumber: 2001 }, { prNumber: 2000 }],
    pullRequests: [
      pr(1742, OLD_MAIN),
      pr(2010, MAIN),
      pr(2001, MAIN, { state: 'closed' }),
      pr(2000, MAIN, { head: { sha: HEAD, repo: { full_name: 'someone/fork' } } }),
    ],
  });
  assert.deepEqual(result.targets, [{ prNumber: 2010 }]);
  assert.deepEqual(result.held.map((entry) => entry.reason), ['BASE_NOT_EXACT_CURRENT_MAIN', 'PR_NOT_OPEN', 'CROSS_REPOSITORY_HEAD']);
});

test('read-only resolver binds the plan to the live main ref and exact PR base', async () => {
  const seen = [];
  const fetchFn = async (url, options) => {
    seen.push({ url, method: options?.method });
    if (url.endsWith('/git/ref/heads/main')) return response({ object: { sha: MAIN } });
    if (url.endsWith('/pulls/1742')) return response(pr(1742, OLD_MAIN));
    if (url.endsWith('/pulls/2010')) return response(pr(2010, MAIN));
    return response({ message: 'not found' }, 404);
  };
  const result = await resolveExactCurrentMainReviewTargets({
    repository: REPOSITORY,
    rawTargets: '[{"prNumber":1742},{"prNumber":2010}]',
    token: 'test-token',
    fetchFn,
  });
  assert.equal(result.currentMainSha, MAIN);
  assert.deepEqual(result.targets, [{ prNumber: 2010 }]);
  assert.equal(result.held[0].reason, 'BASE_NOT_EXACT_CURRENT_MAIN');
  assert.ok(seen.every((entry) => entry.method === 'GET'));
});

test('resolver fails closed when live current-main identity cannot be proven', async () => {
  const fetchFn = async () => response({ object: { sha: 'not-a-sha' } });
  await assert.rejects(
    resolveExactCurrentMainReviewTargets({ repository: REPOSITORY, rawTargets: '[{"prNumber":2010}]', token: 'test-token', fetchFn }),
    /current protected main SHA is unproven/,
  );
});

test('CLI writes only admitted targets and a bounded held summary', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stephanos-current-main-admission-'));
  const outputPath = path.join(dir, 'github-output.txt');
  const fetchFn = async (url) => {
    if (url.endsWith('/git/ref/heads/main')) return response({ object: { sha: MAIN } });
    if (url.endsWith('/pulls/1742')) return response(pr(1742, OLD_MAIN));
    return response({ message: 'not found' }, 404);
  };
  await main({
    env: {
      GITHUB_REPOSITORY: REPOSITORY,
      GITHUB_TOKEN: 'test-token',
      GITHUB_OUTPUT: outputPath,
      STEPHANOS_REVIEW_PLAN_TARGETS: '[{"prNumber":1742}]',
    },
    fetchFn,
    outputPath,
  });
  const output = fs.readFileSync(outputPath, 'utf8');
  assert.match(output, /^targets=\[\]$/m);
  assert.match(output, /BASE_NOT_EXACT_CURRENT_MAIN/);
  assert.doesNotMatch(output, /test-token/);
});

test('workflow filters the global plan and rechecks each matrix target before any coordinator mutation', () => {
  const workflow = fs.readFileSync(WORKFLOW_URL, 'utf8').replaceAll('\r\n', '\n');
  assert.match(workflow, /outputs:\n\s+targets: \$\{\{ steps\.admit\.outputs\.targets \}\}/);
  assert.match(workflow, /- name: Admit only exact-current-main review targets[\s\S]*?id: admit[\s\S]*?scripts\/exact-head-review-current-main-admission-v1\.mjs/);
  assert.match(workflow, /- name: Recheck target exact-current-main admission[\s\S]*?id: recheck_current_main[\s\S]*?scripts\/exact-head-review-current-main-admission-v1\.mjs/);
  assert.match(workflow, /- name: Evaluate and advance one PR-scoped exact-head review state\n\s+id: coordinate\n\s+if: steps\.recheck_current_main\.outputs\.targets != '\[\]'/);
  assert.doesNotMatch(workflow, /continue-on-error:\s*true/);
});
