import test from 'node:test';
import assert from 'node:assert/strict';
import {
  runSovereignOllamaCalibrationV1 as run,
  projectSovereignOllamaCalibrationV1 as project,
  probeLocalSovereignOllamaV1 as probe,
  inspectLocalCalibrationGitIdentityV1 as inspectGit,
  
} from './sovereign-reviewer-ollama-calibration-v1.mjs';

const env = Object.freeze({
  STEPHANOS_REVIEW_REPOSITORY: 'Cheekyfellastef/stephan-os',
  STEPHANOS_REVIEW_EXACT_HEAD: 'a'.repeat(40),
  STEPHANOS_REVIEW_EXACT_BASE: 'b'.repeat(40),
  STEPHANOS_REVIEW_EXACT_BRANCH: 'reviewer/exam-only',
  STEPHANOS_REVIEW_IMPLEMENTER_PROVIDER: 'github-builder',
  STEPHANOS_REVIEW_IMPLEMENTER_SESSION: 'implementer-one',
  STEPHANOS_REVIEW_SESSION: 'reviewer-two',
  STEPHANOS_SOVEREIGN_REVIEW_MODEL: 'qwen:14b',
});
const gitProof = (overrides = {}) => ({
  platform: 'linux', sourceRoot: '/tmp/nonproduction-review-fixture',
  gitSpawn(command, args, options) {
    assert.equal(command, '/usr/bin/git');
    assert.equal(options.shell, false);
    assert.equal(options.env.GIT_CONFIG_NOSYSTEM, '1');
    assert.deepEqual(args.slice(0, 2), ['-C', '/tmp/nonproduction-review-fixture']);
    const cmd = args.slice(2).join(' ');
    const results = {
      'rev-parse HEAD': overrides.head ?? 'a'.repeat(40),
      'symbolic-ref --quiet --short HEAD': overrides.branch ?? 'reviewer/exam-only',
      'status --porcelain --untracked-files=normal': overrides.status ?? '',
      ['merge-base --is-ancestor ' + 'b'.repeat(40) + ' ' + 'a'.repeat(40)]: '',
    };
    return Object.hasOwn(results, cmd) && !(cmd.startsWith('merge-base') && overrides.ancestor === false)
      ? { status: 0, stdout: results[cmd] + '\n' }
      : { status: 1, stdout: '' };
  },
});
function noAuthority(r) {
  for (const key of ['independentHostAttestation','signatureVerified','specialistAuthority',
    'independentReviewSatisfied','protectedMergeAuthority','sourceMutationAuthority',
    'leaseReleaseAuthority','windowsCommissioningAuthority','physicalPickupProven']) {
    assert.equal(r[key], false, key);
  }
}
test('real-model route submits ten fixed untrusted patches only to loopback Ollama', async () => {
  const calls = [];
  const result = await run(env, { ...gitProof(), fetchImpl: async (url, options) => {
    const request = JSON.parse(options.body);
    calls.push({ url, options, request });
    assert.ok(options.signal instanceof AbortSignal);
    assert.equal(options.signal.aborted, false);
    const prompt = request.prompt;
    const challengeId = prompt.match(/Challenge: (case-[a-f0-9]{32})/)?.[1];
    const diffSha256 = prompt.match(/SHA256: ([a-f0-9]{64})/)?.[1];
    // All-clean model is unsafe and must FAIL calibration (eight seeded defects).
    const output = JSON.stringify({ challengeId, diffSha256, verdict: 'clean', findings: [] });
    return { ok: true, text: async () => JSON.stringify({ response: output }) };
  }});
  assert.equal(calls.length, 10);
  assert.equal(calls.every(x => x.url === 'http://127.0.0.1:11434/api/generate'), true);
  assert.equal(calls.every(x => x.options.method === 'POST'
    && x.request.model === 'qwen:14b' && x.request.stream === false
    && x.request.format === 'json' && x.request.options.temperature === 0), true);
  assert.equal(result.status, 'CALIBRATION_HELD');
  assert.equal(result.completedCases, 10);
  assert.equal(result.passedCases, 2);
  noAuthority(result);
  const publicResult = project(result);
  assert.equal(publicResult.status, 'CALIBRATION_HELD');
  noAuthority(publicResult);
});
test('unavailable or oversized Ollama responses hold, never pass the exam', async () => {
  for (const fetchImpl of [
    async () => { throw new Error('offline'); },
    async () => ({ ok: false, text: async () => '{}' }),
    async () => ({ ok: true, text: async () => 'x'.repeat(65537) }),
    async () => ({ ok: true, text: async () => '{"response": 3}' }),
  ]) {
    const r = await run(env, { ...gitProof(), fetchImpl });
    assert.equal(r.status, 'CALIBRATION_HELD');
    noAuthority(project(r));
  }
});
test('invalid local model, source and provider identities fail before or during test', async () => {
  let calls = 0;
  const denied = await run({ ...env, STEPHANOS_SOVEREIGN_REVIEW_MODEL: '../bad' }, {
    fetchImpl: async () => { calls++; throw Error('must not call'); },
  });
  assert.equal(denied.status, 'CALIBRATION_HELD');
  assert.equal(calls, 0);
  const sameProvider = await run({ ...env, STEPHANOS_REVIEW_IMPLEMENTER_PROVIDER: 'sovereign-local-ollama' }, {
    ...gitProof(), fetchImpl: async () => { calls++; throw Error('must not call'); },
  });
  assert.equal(sameProvider.reason, 'EXACT_SOURCE_OR_INDEPENDENT_REVIEW_IDENTITY_MISSING');
  assert.equal(calls, 0);
  noAuthority(project(sameProvider));
});
test('public calibration projection rejects forged pass status and authority claims', () => {
  const sample = {
    status: 'CALIBRATION_CANDIDATE_PASSED_UNATTESTED',
    repository: 'Cheekyfellastef/stephan-os', sourceHead: 'a'.repeat(40),
    baseSha: 'b'.repeat(40), completedCases: 10, passedCases: 10,
    manifestSha256: 'c'.repeat(64), observationsSha256: 'd'.repeat(64),
    independentHostAttestation: false, signatureVerified: false,
    specialistAuthority: false, independentReviewSatisfied: false,
    protectedMergeAuthority: false, sourceMutationAuthority: false,
    leaseReleaseAuthority: false, windowsCommissioningAuthority: false,
    physicalPickupProven: false,
  };
  for (const payload of [
    sample,
    { ...sample, specialistAuthority: true },
    { ...sample, leaseReleaseAuthority: true },
    { ...sample, completedCases: 9 },
    { ...sample, sourceHead: sample.baseSha },
    { ...sample, independentHostAttestation: true },
  ]) {
    const projected = project(payload);
    assert.equal(projected.status, 'CALIBRATION_HELD');
    assert.equal(projected.reason, 'CALIBRATION_RESULT_INCONSISTENT');
    noAuthority(projected);
  }
});
test('calibration checks Git source again after the full ten-model-case exam', async () => {
  let gitCalls = 0;
  let modelCalls = 0;
  const original = gitProof();
  const outcome = await run(env, {
    ...original,
    gitSpawn(command, args, options) {
      gitCalls++;
      // A second inspection sees a newly dirty worktree after ten requests.
      if (args.includes('status') && gitCalls > 4) {
        return { status: 0, stdout: ' M changed-during-model-exam.txt\n' };
      }
      return original.gitSpawn(command, args, options);
    },
    fetchImpl: async (_url, options) => {
      modelCalls++;
      const prompt = JSON.parse(options.body).prompt;
      const challengeId = prompt.match(/Challenge: (case-[a-f0-9]{32})/)?.[1];
      const diffSha256 = prompt.match(/SHA256: ([a-f0-9]{64})/)?.[1];
      return { ok: true, text: async () => JSON.stringify({
        response: JSON.stringify({ challengeId, diffSha256,
          verdict: 'clean', findings: [] }),
      }) };
    },
  });
  assert.equal(modelCalls, 10);
  assert.ok(gitCalls >= 7);
  assert.equal(outcome.status, 'CALIBRATION_HELD');
  assert.equal(outcome.reason, 'CALIBRATION_SOURCE_CHANGED_DURING_EXAM');
  noAuthority(project(outcome));
});


test('read-only preflight observes only local Ollama model availability', async () => {
  const calls = [];
  const ready = await probe(env, { fetchImpl: async (url, options) => {
    calls.push({ url, options });
    return { ok: true, text: async () => JSON.stringify({models:[
      { name: 'qwen:14b', model: 'qwen:14b' },
      { name: 'other:latest' },
    ]}) };
  }});
  assert.equal(ready.status, 'LOCAL_OLLAMA_MODEL_OBSERVED_UNATTESTED');
  assert.equal(ready.selectedModelPresent, true);
  assert.deepEqual(Object.keys(ready).sort(), [
    'status','reason','selectedModelPresent','independentHostAttestation',
    'signatureVerified','specialistAuthority','independentReviewSatisfied',
    'protectedMergeAuthority','sourceMutationAuthority','leaseReleaseAuthority',
    'windowsCommissioningAuthority','physicalPickupProven',
  ].sort());
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'http://127.0.0.1:11434/api/tags');
  assert.equal(calls[0].options.method, 'GET');
  noAuthority(ready);
});
test('read-only preflight holds missing model, offline service, oversized inventory', async () => {
  for (const fetchImpl of [
    async () => ({ok:true,text:async()=>JSON.stringify({models:[]})}),
    async () => ({ok:false,text:async()=>'{}'}),
    async () => ({ok:true,text:async()=>'x'.repeat(32769)}),
    async () => { throw Error('offline') },
  ]) {
    const r = await probe(env, {fetchImpl});
    assert.equal(r.status,'LOCAL_OLLAMA_PREFLIGHT_HELD');
    noAuthority(r);
  }
});

test('calibration refuses dirty, stale, wrong-branch and unrelated WSL checkout before model call', async () => {
  for (const git of [
    gitProof({ head: 'f'.repeat(40) }),
    gitProof({ branch: 'main' }),
    gitProof({ status: ' M preserved-original-worktree.txt' }),
    gitProof({ ancestor: false }),
  ]) {
    let modelCalls = 0;
    const outcome = await run(env, {
      ...git, fetchImpl: async () => { modelCalls++; throw Error('model should never run'); },
    });
    assert.equal(outcome.status, 'CALIBRATION_HELD');
    assert.equal(modelCalls, 0);
    noAuthority(outcome);
  }
  assert.equal(inspectGit(env, gitProof()).ok, true);
  assert.equal(inspectGit({ ...env, STEPHANOS_REVIEW_EXACT_HEAD: 'unknown' }, gitProof()).ok, false);
});
