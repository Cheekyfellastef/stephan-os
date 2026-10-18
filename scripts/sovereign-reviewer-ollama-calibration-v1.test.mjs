import test from 'node:test';
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { SOVEREIGN_CALIBRATION_MANIFEST_SHA256 } from '../shared/agents/sovereignCalibrationV1.mjs';
import assert from 'node:assert/strict';
import {
  runSovereignOllamaCalibrationV1 as run,
  projectSovereignOllamaCalibrationV1 as project,
  probeLocalSovereignOllamaV1 as probe,
  inspectLocalCalibrationGitIdentityV1 as inspectGit,
  inspectLocalSovereignGamingPermissionV1 as gaming,
  persistSovereignCalibrationCandidateV1 as persist,
  observeLocalSovereignOllamaDigestV1 as modelDigest,
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
  gamingGuard: allowGaming,
  modelPin: async () => ({ok:true,digest:'f'.repeat(64)}),
  gitSpawn(command, args, options) {
    assert.equal(command, '/usr/bin/git');
    assert.equal(options.shell, false);
    assert.equal(options.env.GIT_CONFIG_NOSYSTEM, '1');
    assert.deepEqual(args.slice(0, 2), ['-C', '/tmp/nonproduction-review-fixture']);
    const cmd = args.slice(2).join(' ');
    const file = args.at(-1);
    if (cmd.startsWith('ls-files -v -- ')) {
      return { status: 0, stdout: (overrides.indexFlag || 'H') + ' ' + file + '\n' };
    }
    if (cmd.startsWith('rev-parse HEAD:')) {
      return { status: 0, stdout: (overrides.badExpectedBlob ? 'invalid' : 'c'.repeat(40)) + '\n' };
    }
    if (cmd.startsWith('hash-object --no-filters -- ')) {
      return { status: 0, stdout: (overrides.badWorkingBlob ? 'f'.repeat(40) : 'c'.repeat(40)) + '\n' };
    }
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
const allowGaming = () => ({ ok: true });
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
    return { ok: true, text: async () => JSON.stringify({
      model: 'qwen:14b', done: true, done_reason: 'stop', response: output,
    }) };
  }});
  assert.equal(calls.length, 10);
  assert.equal(calls.every(x => x.url === 'http://127.0.0.1:11434/api/generate'), true);
  assert.equal(calls.every(x => x.options.method === 'POST'
    && x.options.redirect === 'error'
    && x.request.model === 'qwen:14b' && x.request.stream === false
    && x.request.format === 'json' && x.request.options.temperature === 0
    && x.request.keep_alive === 0), true);
  assert.equal(result.status, 'CALIBRATION_HELD');
  assert.equal(result.completedCases, 10);
  assert.equal(result.passedCases, 2);
  noAuthority(result);
  const publicResult = project(result);
  assert.equal(publicResult.status, 'CALIBRATION_HELD');
  noAuthority(publicResult);
});
test('loopback-only requests refuse redirect traversal for model prompts and metadata', async () => {
  let inspected = 0;
  const redirected = async (url, options) => {
    inspected++;
    assert.match(url, /^http:\/\/127\.0\.0\.1:11434\/api\/(generate|tags)$/);
    assert.equal(options.redirect, 'error', 'sensitive prompts must not be redirected');
    throw new TypeError('fetch failed: redirect mode is error');
  };
  const calibration = await run(env, { ...gitProof(), fetchImpl: redirected });
  assert.equal(calibration.status, 'CALIBRATION_HELD');
  assert.equal(calibration.completedCases, 0, 'failed first transport must not count as a completed review');
  const preflight = await probe(env, { ...gitProof(), fetchImpl: redirected });
  assert.equal(preflight.status, 'LOCAL_OLLAMA_PREFLIGHT_HELD');
  assert.equal(inspected, 2, 'one refused generate and one refused metadata call');
  noAuthority(project(calibration)); // only the public bounded projection has nine fixed fields
  // Internal read-only preflight may return status rather than ok; no
  // authority can be granted by any of its held result shapes.
  assert.notEqual(preflight.specialistAuthority, true);
  assert.notEqual(preflight.leaseReleaseAuthority, true);
});
test('unavailable or oversized Ollama responses hold, never pass the exam', async () => {
  for (const fetchImpl of [
    async () => { throw new Error('offline'); },
    async () => ({ ok: false, text: async () => '{}' }),
    async () => ({ ok: true, text: async () => 'x'.repeat(65537) }),
    async () => ({ ok: true, text: async () => '{"response": 3}' }),
    async () => ({ ok: true, text: async () => JSON.stringify({
      model:'wrong:latest', done:true, done_reason:'stop', response:'{}',
    }) }),
    async () => ({ ok: true, text: async () => JSON.stringify({
      model:'qwen:14b', done:false, done_reason:'stop', response:'{}',
    }) }),
    async () => ({ ok: true, text: async () => JSON.stringify({
      model:'qwen:14b', done:true, done_reason:'length', response:'{}',
    }) }),
    async () => ({ ok: true, text: async () => JSON.stringify({
      model:'qwen:14b', done:true, done_reason:'stop', response:'x'.repeat(12289),
    }) }),
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
        model: 'qwen:14b', done: true, done_reason: 'stop',
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


test('gaming-governor refuses absent, stale and active gaming signals before model use', async () => {
  const state = {
    schemaVersion: 'stephanos.vr-resource-governor.v1',
    updatedAtUtc: new Date('2026-10-17T20:00:00.000Z').toISOString(),
    active: false, flatGameActive: false, airLinkActive: false,
    localModelAllowed: true, heavyModelAllowed: true,
    ollamaLoadMode: 'balanced', prepareLeaseActive: false,
  };
  const fixedNow = Date.parse(state.updatedAtUtc) + 1_000;
  const validFile = (change = {}) => ({
    platform: 'linux', nowMs: fixedNow,
    openFile(path, flags) {
      assert.match(path, /vr\/vr-resource-governor-current\.json$/);
      assert.equal(flags & 131072, 131072, 'O_NOFOLLOW required');
      return 31;
    },
    statFile(fd) {
      assert.equal(fd, 31);
      return { isFile: () => true, size: 512 };
    },
    readFile(fd, encoding) {
      assert.equal(fd, 31); assert.equal(encoding, 'utf8');
      return JSON.stringify({ ...state, ...change });
    },
    closeFile(fd) { assert.equal(fd, 31); },
  });
  const linuxEnv = { ...env, STEPHANOS_SHARED_AGENT_WORKSPACE: '/mnt/c/Users/Operator/Documents/Stephanos-openclaw-workspace' };
  assert.equal(gaming(linuxEnv, validFile()).ok, true);
  for (const altered of [
    { active: true }, { flatGameActive: true }, { airLinkActive: true },
    { virtualAirLinkTestActive: true }, { localModelAllowed: false },
    { heavyModelAllowed: false }, { prepareLeaseActive: true },
    { updatedAtUtc: '2026-10-17T19:00:00.000Z' },
    { updatedAtUtc: 'not-a-date' },
  ]) {
    const result = gaming(linuxEnv, validFile(altered));
    assert.equal(result.ok, false);
  }
  assert.equal(gaming({ ...linuxEnv, STEPHANOS_SHARED_AGENT_WORKSPACE: '../escape' }, validFile()).ok, false);
  assert.equal(gaming(linuxEnv, { ...validFile(), openFile() { throw Error('missing'); } }).ok, false);
});
test('local-model exam immediately holds when gaming activates between cases', async () => {
  let games = 0;
  let modelCalls = 0;
  const result = await run(env, {
    ...gitProof(),
    gamingGuard: () => ({ ok: ++games < 4, reason: 'CALIBRATION_GAMING_RESOURCE_PROTECTED' }),
    fetchImpl: async (_url, options) => {
      modelCalls++;
      const prompt = JSON.parse(options.body).prompt;
      const id = prompt.match(/Challenge: (case-[a-f0-9]{32})/)?.[1];
      const digest = prompt.match(/SHA256: ([a-f0-9]{64})/)?.[1];
      return {ok: true, text: async () => JSON.stringify({
        model: 'qwen:14b', done: true, done_reason: 'stop',
        response: JSON.stringify({
          challengeId: id, diffSha256: digest, verdict:'clean', findings: [],
        }),
      })};
    },
  });
  assert.equal(modelCalls, 2);
  assert.equal(result.status, 'CALIBRATION_HELD');
  noAuthority(result);
});
test('preflight holds dirty source or active gaming before contacting Ollama', async () => {
  for (const opts of [
    gitProof({ status: ' M operator-file.txt' }),
    { ...gitProof(), gamingGuard: () => ({
      ok: false, reason: 'CALIBRATION_GAMING_RESOURCE_PROTECTED',
    }) },
    { ...gitProof(), gamingGuard: () => ({
      ok: false, reason: 'CALIBRATION_GOVERNOR_STALE_OR_INVALID',
    }) },
  ]) {
    let calls = 0;
    const r = await probe(env, { ...opts,
      fetchImpl: async () => { calls++; throw Error('must not contact Ollama'); },
    });
    assert.equal(r.status, 'LOCAL_OLLAMA_PREFLIGHT_HELD');
    assert.equal(calls, 0);
    noAuthority(r);
  }
});
test('model weight pin refuses alias collision, missing digest and wrong model', async () => {
  for (const [models,expected] of [
    [[{name:'qwen:14b',digest:'f'.repeat(64)}],true],
    [[{name:'qwen:14b',digest:'missing'}],false],
    [[{name:'qwen:14b',digest:'f'.repeat(64)},{model:'qwen:14b',digest:'e'.repeat(64)}],false],
    [[{name:'another:tag',digest:'f'.repeat(64)}],false],
  ]) {
    const r=await modelDigest('qwen:14b',{fetchImpl:async(url,opts)=>{
      assert.equal(url,'http://127.0.0.1:11434/api/tags');
      assert.equal(opts.method,'GET');
      return {ok:true,text:async()=>JSON.stringify({models})};
    }});
    assert.equal(r.ok,expected);
    assert.equal(Object.hasOwn(r,'digest'),expected);
  }
});
test('calibration holds if model weights change during ten cases',async()=>{
  let pins=0,requests=0;
  const r=await run(env,{...gitProof(),
    modelPin:async()=>({ok:true,digest:(++pins===1?'a':'b').repeat(64)}),
    fetchImpl:async(_url,options)=>{
      requests++;
      const prompt=JSON.parse(options.body).prompt;
      const challengeId=prompt.match(/Challenge: (case-[a-f0-9]{32})/)?.[1];
      const diffSha256=prompt.match(/SHA256: ([a-f0-9]{64})/)?.[1];
      return {ok:true,text:async()=>JSON.stringify({model:'qwen:14b',
        done:true,done_reason:'stop',response:JSON.stringify({
          challengeId,diffSha256,verdict:'clean',findings:[],
        })})};
    }});
  assert.equal(requests,10);assert.equal(pins,2);
  assert.equal(r.status,'CALIBRATION_HELD');
  assert.equal(r.reason,'CALIBRATION_MODEL_DIGEST_CHANGED_OR_UNOBSERVED');
  noAuthority(project(r));
});
test('read-only preflight observes only local Ollama model availability', async () => {
  const calls = [];
  const ready = await probe(env, { ...gitProof(), fetchImpl: async (url, options) => {
    calls.push({ url, options });
    return { ok: true, text: async () => JSON.stringify({models:[
      { name: 'qwen:14b', model: 'qwen:14b', digest: 'f'.repeat(64) },
      { name: 'other:latest' },
    ]}) };
  }});
  assert.equal(ready.status, 'LOCAL_OLLAMA_MODEL_OBSERVED_UNATTESTED');
  assert.equal(ready.selectedModelPresent, true);
  assert.equal(ready.modelDigestSha256, 'f'.repeat(64));
  assert.deepEqual(Object.keys(ready).sort(), [
    'status','reason','selectedModelPresent','sourceVerified','gamingClear','modelDigestSha256',
    'independentHostAttestation',
    'signatureVerified','specialistAuthority','independentReviewSatisfied',
    'protectedMergeAuthority','sourceMutationAuthority','leaseReleaseAuthority',
    'windowsCommissioningAuthority','physicalPickupProven',
  ].sort());
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'http://127.0.0.1:11434/api/tags');
  assert.equal(calls[0].options.method, 'GET');
  assert.equal(calls[0].options.redirect, 'error', 'no redirect even on metadata reads');
  noAuthority(ready);
});
test('read-only preflight holds missing model, offline service, oversized inventory', async () => {
  for (const fetchImpl of [
    async () => ({ok:true,text:async()=>JSON.stringify({models:[]})}),
    async () => ({ok:false,text:async()=>'{}'}),
    async () => ({ok:true,text:async()=>'x'.repeat(32769)}),
    async () => { throw Error('offline') },
  ]) {
    const r = await probe(env, { ...gitProof(), fetchImpl });
    assert.equal(r.status,'LOCAL_OLLAMA_PREFLIGHT_HELD');
    noAuthority(r);
  }
});

test('calibration refuses Git skip-worktree, assume-unchanged and changed executable bytes', async () => {
  for (const [scenario, expected] of [
    [{ indexFlag: 'S' }, 'CALIBRATION_EXECUTABLE_INDEX_FLAGS_UNSAFE'],
    [{ indexFlag: 'h' }, 'CALIBRATION_EXECUTABLE_INDEX_FLAGS_UNSAFE'],
    [{ badExpectedBlob: true }, 'CALIBRATION_EXECUTABLE_BYTES_NOT_HEAD'],
    [{ badWorkingBlob: true }, 'CALIBRATION_EXECUTABLE_BYTES_NOT_HEAD'],
  ]) {
    let requestedModel = false;
    const actual = await run(env, {
      ...gitProof(scenario),
      fetchImpl: async () => { requestedModel = true; throw new Error('model must not run'); },
    });
    assert.equal(actual.status, 'CALIBRATION_HELD');
    assert.equal(actual.reason, expected);
    assert.equal(requestedModel, false);
    noAuthority(actual);
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

test('local candidate proof is source-bound, SHA-verified and no-overwrite, never security approval', () => {
  const workspace = mkdtempSync(join(tmpdir(), 'sovereign-audit-fixture-'));
  try {
    mkdirSync(join(workspace, 'proofs'));
    const result = {
      status: 'CALIBRATION_CANDIDATE_PASSED_UNATTESTED',
      repository: env.STEPHANOS_REVIEW_REPOSITORY,
      sourceHead: env.STEPHANOS_REVIEW_EXACT_HEAD,
      baseSha: env.STEPHANOS_REVIEW_EXACT_BASE,
      completedCases: 10, passedCases: 10,
      manifestSha256: SOVEREIGN_CALIBRATION_MANIFEST_SHA256,
      observationsSha256: 'd'.repeat(64), modelDigestSha256:'f'.repeat(64),
      independentHostAttestation: false, signatureVerified: false,
      specialistAuthority: false, independentReviewSatisfied: false,
      protectedMergeAuthority: false, sourceMutationAuthority: false,
      leaseReleaseAuthority: false, windowsCommissioningAuthority: false,
      physicalPickupProven: false,
    };
    const audited = persist(result, {
      ...env, STEPHANOS_REVIEW_PR: '3090',
      STEPHANOS_SHARED_AGENT_WORKSPACE: workspace,
    });
    assert.equal(audited.proofRef, 'proofs/sovereign-calibration-pr-3090-aaaaaaaaaaaa-dddddddddddd.json');
    const file = readFileSync(join(workspace, audited.proofRef));
    assert.equal(createHash('sha256').update(file).digest('hex'), audited.proofSha256);
    const decoded = JSON.parse(file);
    assert.equal(decoded.qualification, 'PENDING_INDEPENDENT_ATTESTATION');
    assert.equal(decoded.auditAuthority, false);
    assert.equal(decoded.protectedReviewSatisfied, false);
    noAuthority(decoded);
    assert.throws(() => persist(result, {
      ...env, STEPHANOS_REVIEW_PR: '3090', STEPHANOS_SHARED_AGENT_WORKSPACE: workspace,
    }), { code: 'EEXIST' });
    assert.throws(() => persist({ ...result, leaseReleaseAuthority: true }, {
      ...env, STEPHANOS_REVIEW_PR: '3091', STEPHANOS_SHARED_AGENT_WORKSPACE: workspace,
    }), /PUBLICATION_NOT_ADMITTED/);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});
