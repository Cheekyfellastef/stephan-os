import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { planWindowsSovereignReviewerV1, runWindowsSovereignReviewerV1 } from './sovereign-reviewer-wsl-bridge-v1.mjs';

const ROOT = 'C:\\Users\\Operator\\Documents\\GitHub\\stephan-os';
const env = Object.freeze({
  STEPHANOS_SHARED_AGENT_WORKSPACE: 'C:\\Users\\Operator\\Documents\\Stephanos-openclaw-workspace',
  STEPHANOS_REVIEW_EXACT_HEAD: 'a'.repeat(40),
  STEPHANOS_REVIEW_EXACT_BASE: 'b'.repeat(40),
  STEPHANOS_REVIEW_EXACT_BRANCH: 'fix/repair-3059',
  STEPHANOS_REVIEW_REPOSITORY: 'Cheekyfellastef/stephan-os',
  STEPHANOS_REVIEW_ISSUE: '3059',
  STEPHANOS_REVIEW_PR: '3059',
  STEPHANOS_REVIEW_IMPLEMENTER_PROVIDER: 'github-builder',
  STEPHANOS_REVIEW_IMPLEMENTER_SESSION: 'builder-session-1',
  STEPHANOS_REVIEW_SESSION: 'reviewer-session-2',
  STEPHANOS_SOVEREIGN_REVIEW_MODEL: 'qwen:14b',
});
const context = { platform: 'win32', sourceRoot: ROOT, exists: () => true };

test('Windows runner admits only fixed reviewed source and exact PR/head identity', () => {
  const plan = planWindowsSovereignReviewerV1(env, context);
  assert.equal(plan.ok, true);
  assert.equal(plan.reviewer, ROOT + '\\scripts\\sovereign-reviewer-v1.mjs');
  assert.equal(plan.mergeAuthority, false);
  assert.deepEqual(Object.keys(plan.reviewEnv).sort(), [
    'STEPHANOS_REVIEW_EXACT_HEAD', 'STEPHANOS_REVIEW_EXACT_BASE',
    'STEPHANOS_REVIEW_EXACT_BRANCH', 'STEPHANOS_REVIEW_REPOSITORY',
    'STEPHANOS_REVIEW_ISSUE', 'STEPHANOS_REVIEW_PR',
    'STEPHANOS_REVIEW_IMPLEMENTER_PROVIDER', 'STEPHANOS_REVIEW_IMPLEMENTER_SESSION',
    'STEPHANOS_REVIEW_SESSION', 'STEPHANOS_SOVEREIGN_REVIEW_MODEL',
  ].sort());
});

test('Windows WSL runner makes only fixed shell-free calls and emits candidate, never approval', () => {
  const calls = [];
  const receipt = {
    status: 'LOCAL_REVIEW_EVIDENCE_READY', sourceHead: env.STEPHANOS_REVIEW_EXACT_HEAD,
    prNumber: 3059, verdict: 'clean',
    proofRef: 'proofs/sovereign-review-pr-3059-aaaaaaaaaaaa.json',
    proofSha256: 'd'.repeat(64), mergeAuthority: false,
  };
  const result = runWindowsSovereignReviewerV1(env, {
    ...context,
    spawn(command, args, options) {
      calls.push({ command, args, options });
      if (calls.length === 1) return { status: 0, stdout: '/mnt/c/Users/Operator/Documents/GitHub/stephan-os/scripts/sovereign-reviewer-v1.mjs\n' };
      if (calls.length === 2) return { status: 0, stdout: '/mnt/c/Users/Operator/Documents/Stephanos-openclaw-workspace\n' };
      if (calls.length === 3) return { status: 0, stdout: 'SOVEREIGN_REVIEWER_RESULT=' + JSON.stringify(receipt) + '\n' };
      assert.deepEqual(args.slice(0, 3), ['--exec', '/usr/bin/sha256sum', '--']);
      assert.equal(args.at(-1), '/mnt/c/Users/Operator/Documents/Stephanos-openclaw-workspace/' + receipt.proofRef);
      return { status: 0, stdout: 'd'.repeat(64) + '  ' + args.at(-1) + '\n' };
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.qualification, 'PENDING_INDEPENDENT_ATTESTATION');
  assert.equal(result.mergeAuthority, false);
  assert.equal(result.approvalAuthority, false);
  assert.equal(result.proofSha256, 'd'.repeat(64));
  assert.equal(calls.length, 4);
  assert.equal(calls.every(x => x.command === path.win32.resolve('C:/Windows/System32/wsl.exe') && x.args[0] === '--exec' && x.options.shell === false), true);
  assert.equal(calls.every(x => x.options.env.WSLENV === ''), true);
  assert.deepEqual(calls.map(x => x.options.timeout), [12_000, 12_000, 150_000, 12_000]);
  assert.equal(calls.every(x => x.command !== 'wsl.exe'), true, 'never resolve executable from cwd or PATH');
  assert.equal(calls.every(x => path.win32.isAbsolute(x.command)), true, 'absolute Windows executable required');
  assert.deepEqual(calls[2].args.slice(0, 6), ['--exec', '/usr/bin/env', '-i', 'PATH=/usr/bin:/bin', 'HOME=/tmp', 'STEPHANOS_REVIEW_EXACT_HEAD=' + 'a'.repeat(40)]);
  assert.equal(calls[2].args.includes('/usr/bin/node'), true);
  assert.equal(calls[2].args.some(x => x === 'STEPHANOS_SHARED_AGENT_WORKSPACE=/mnt/c/Users/Operator/Documents/Stephanos-openclaw-workspace'), true);
});

test('Windows bridge refuses unsupported platform, fake path, missing identity, hostile WSL output', () => {
  const cases = [
    { env, options: { ...context, platform: 'linux' }, reason: 'WINDOWS_HOST_REQUIRED' },
    { env, options: { ...context, sourceRoot: '\\\\attacker\\share' }, reason: 'REVIEWER_SOURCE_UNAVAILABLE' },
    { env, options: { ...context, exists: () => false }, reason: 'REVIEWER_SOURCE_UNAVAILABLE' },
    { env: { ...env, STEPHANOS_REVIEW_EXACT_HEAD: 'none' }, options: context, reason: 'EXACT_GIT_IDENTITY_REQUIRED' },
    { env: { ...env, STEPHANOS_SHARED_AGENT_WORKSPACE: '\\\\server\\share' }, options: context, reason: 'LOCAL_WORKSPACE_REQUIRED' },
    { env: { ...env, STEPHANOS_REVIEW_SESSION: '' }, options: context, reason: 'INDEPENDENT_REVIEW_IDENTITIES_REQUIRED' },
    { env: { ...env, STEPHANOS_REVIEW_SESSION: 'BUILDER-SESSION-1' },
      options: context, reason: 'REVIEWER_IMPLEMENTER_SESSION_COLLISION' },
  ];
  for (const entry of cases) {
    const got = runWindowsSovereignReviewerV1(entry.env, { ...entry.options, spawn() { throw Error('unexpected call'); } });
    assert.equal(got.ok, false);
    assert.equal(got.reason, entry.reason);
  }
  const poisoned = runWindowsSovereignReviewerV1(env, { ...context, spawn: () => ({ status: 0, stdout: '../outside\n' }) });
  assert.equal(poisoned.reason, 'WSL_PATH_TRANSLATION_UNAVAILABLE');
});

test('preflight safely exposes only closed-list HOLD reasons from fixed Linux stdout', () => {
  const authority = {
    independentHostAttestation: false, signatureVerified: false,
    specialistAuthority: false, independentReviewSatisfied: false,
    protectedMergeAuthority: false, sourceMutationAuthority: false,
    leaseReleaseAuthority: false, windowsCommissioningAuthority: false,
    physicalPickupProven: false,
  };
  function read(exitCode, receipt, extra = '') {
    let n = 0;
    const result = runWindowsSovereignReviewerV1(env, { ...context, mode: 'preflight',
      spawn: () => {
        n++;
        if (n <= 2) return { status: 0, stdout: '/mnt/c/safe\n' };
        return { status: exitCode, stdout: extra
          + 'SOVEREIGN_REVIEW_PREFLIGHT_RESULT=' + JSON.stringify(receipt) + '\n' };
      },
    });
    assert.equal(n, 3);
    assert.equal(result.ok, false);
    assert.equal(result.mergeAuthority, false);
    assert.equal(result.approvalAuthority, false);
    return result;
  }
  for (const reason of [
    'CALIBRATION_CLEAN_EXACT_CHECKOUT_REQUIRED',
    'CALIBRATION_GAMING_RESOURCE_PROTECTED',
    'CALIBRATION_GOVERNOR_STALE_OR_INVALID',
    'LOCAL_OLLAMA_NOT_REACHABLE',
    'LOCAL_OLLAMA_MODEL_DIGEST_UNPROVEN',
  ]) {
    const r = read(2, { status: 'LOCAL_OLLAMA_PREFLIGHT_HELD', reason, ...authority });
    assert.equal(r.reason, reason);
  }
  assert.equal(read(2, { status: 'LOCAL_OLLAMA_PREFLIGHT_HELD',
    reason: 'C:/secret/private-credential', ...authority }).reason,
  'LOCAL_OLLAMA_PREFLIGHT_UNQUALIFIED');
  assert.equal(read(2, { status: 'LOCAL_OLLAMA_PREFLIGHT_HELD',
    reason: 'LOCAL_OLLAMA_NOT_REACHABLE', ...authority,
    protectedMergeAuthority: true }).reason, 'LOCAL_OLLAMA_PREFLIGHT_UNQUALIFIED');
  assert.equal(read(0, { status: 'LOCAL_OLLAMA_PREFLIGHT_HELD',
    reason: 'LOCAL_OLLAMA_NOT_REACHABLE', ...authority }).reason,
  'LOCAL_OLLAMA_PREFLIGHT_UNQUALIFIED');
  const doubled = 'SOVEREIGN_REVIEW_PREFLIGHT_RESULT=' + JSON.stringify({
    status: 'LOCAL_OLLAMA_PREFLIGHT_HELD', reason: 'LOCAL_OLLAMA_NOT_REACHABLE',
    ...authority,
  }) + '\n';
  assert.equal(read(2, { status: 'LOCAL_OLLAMA_PREFLIGHT_HELD',
    reason: 'LOCAL_OLLAMA_NOT_REACHABLE', ...authority }, doubled).reason,
  'WSL_REVIEWER_EXECUTION_HELD');
});

test('Windows WSL preflight uses only fixed read-only Ollama probe and rejects forged authority', () => {
  const make = receipt => {
    let called = 0;
    const result = runWindowsSovereignReviewerV1(env, {
      ...context, mode: 'preflight', spawn: (_command, args, opts) => {
        called++;
        assert.equal(opts.shell, false);
        if (called < 3) return { status: 0, stdout: '/mnt/c/safe\n' };
        assert.equal(args.at(-1), '--preflight');
        return { status: 0, stdout: 'SOVEREIGN_REVIEW_PREFLIGHT_RESULT='
          + JSON.stringify(receipt) + '\n' };
      },
    });
    assert.equal(called, 3);
    return result;
  };
  const available = {
    status: 'LOCAL_OLLAMA_MODEL_OBSERVED_UNATTESTED',
    selectedModelPresent: true, sourceVerified: true, gamingClear: true,
    modelDigestSha256:'f'.repeat(64),
    independentHostAttestation: false,
    signatureVerified: false, specialistAuthority: false,
    protectedMergeAuthority: false, leaseReleaseAuthority: false,
  };
  const ready = make(available);
  assert.equal(ready.ok, true);
  assert.equal(ready.approvalAuthority, false);
  assert.equal(ready.mergeAuthority, false);
  for (const fake of [
    { ...available, specialistAuthority: true },
    { ...available, leaseReleaseAuthority: true },
    { ...available, selectedModelPresent: false },
    { ...available, sourceVerified: false },
    { ...available, gamingClear: false },
    { ...available, status: 'LOCAL_OLLAMA_PREFLIGHT_HELD' },
  ]) {
    const bad = make(fake);
    assert.equal(bad.ok, false);
    assert.equal(bad.reason, 'LOCAL_OLLAMA_PREFLIGHT_UNQUALIFIED');
  }
});

test('Windows WSL calibration proof must be re-read at the claimed SHA256', () => {
  let done = 0;
  const candidate = {
    status: 'CALIBRATION_CANDIDATE_PASSED_UNATTESTED',
    repository: env.STEPHANOS_REVIEW_REPOSITORY,
    sourceHead: env.STEPHANOS_REVIEW_EXACT_HEAD,
    baseSha: env.STEPHANOS_REVIEW_EXACT_BASE,
    completedCases: 10, passedCases: 10,
    manifestSha256: 'c'.repeat(64), observationsSha256: 'd'.repeat(64),
    modelDigestSha256:'f'.repeat(64),
    proofRef: 'proofs/sovereign-calibration-pr-3059-aaaaaaaaaaaa-dddddddddddd.json',
    proofSha256: 'e'.repeat(64), qualification: 'PENDING_INDEPENDENT_ATTESTATION',
    independentHostAttestation: false, signatureVerified: false,
    specialistAuthority: false, independentReviewSatisfied: false,
    leaseReleaseAuthority: false, protectedMergeAuthority: false,
  };
  function attempt({ proofStatus = 0, hash = candidate.proofSha256, source = candidate } = {}) {
    let stage = 0;
    const r = runWindowsSovereignReviewerV1(env, { ...context, mode: 'calibration',
      spawn: (_, args, options) => {
        stage++;
        assert.equal(options.timeout, stage === 3 ? 570_000 : 12_000);
        if (stage <= 2) return { status: 0, stdout: '/mnt/c/safe\n' };
        if (stage === 3) return { status: 0,
          stdout: 'SOVEREIGN_REVIEW_CALIBRATION_RESULT=' + JSON.stringify(source) + '\n' };
        done++;
        assert.deepEqual(args.slice(0, 3), ['--exec', '/usr/bin/sha256sum', '--']);
        return { status: proofStatus,
          stdout: hash + '  /mnt/c/safe/' + candidate.proofRef + '\n' };
      },
    });
    return r;
  }
  assert.equal(attempt().ok, true);
  assert.equal(attempt({ hash: 'f'.repeat(64) }).reason, 'CALIBRATION_PROOF_FILE_HASH_MISMATCH');
  assert.equal(attempt({ proofStatus: 1 }).reason, 'CALIBRATION_PROOF_FILE_UNREADABLE');
  assert.equal(attempt({ source: { ...candidate, proofSha256: 'bad' } }).reason,
    'CALIBRATION_EVIDENCE_UNQUALIFIED');
  assert.equal(done, 3);
});

test('Windows WSL bridge accepts only a complete untrusted calibration candidate', () => {
  let calls = 0;
  const summary = {
    status: 'CALIBRATION_CANDIDATE_PASSED_UNATTESTED',
    repository: env.STEPHANOS_REVIEW_REPOSITORY,
    sourceHead: env.STEPHANOS_REVIEW_EXACT_HEAD,
    baseSha: env.STEPHANOS_REVIEW_EXACT_BASE,
    completedCases: 10, passedCases: 10,
    manifestSha256: 'c'.repeat(64), observationsSha256: 'd'.repeat(64),
    modelDigestSha256:'f'.repeat(64),
    proofRef: 'proofs/sovereign-calibration-pr-3059-aaaaaaaaaaaa-dddddddddddd.json',
    proofSha256: 'e'.repeat(64), qualification: 'PENDING_INDEPENDENT_ATTESTATION',
    independentHostAttestation: false, signatureVerified: false,
    specialistAuthority: false, independentReviewSatisfied: false,
    leaseReleaseAuthority: false, protectedMergeAuthority: false,
  };
  const run = receipt => {
    let stageCount = 0;
    return runWindowsSovereignReviewerV1(env, {
    ...context, mode: 'calibration',
    spawn: (_, args) => {
      calls++;
      stageCount++;
      const stage = (stageCount - 1) % 4;
      assert.equal(args.includes('/usr/bin/sha256sum') || stage < 2
        ? true : args.includes('/usr/bin/node'), true);
      if (stage < 2) return { status: 0, stdout: '/mnt/c/safe\n' };
      if (stage === 2) {
        assert.equal(args.includes('/usr/bin/node'), true);
        assert.equal(args.at(-1), '--once', 'fixed calibration CLI is mandatory');
        return { status: 0, stdout: 'SOVEREIGN_REVIEW_CALIBRATION_RESULT=' + JSON.stringify(receipt) + '\n' };
      }
      assert.deepEqual(args.slice(0, 3), ['--exec', '/usr/bin/sha256sum', '--']);
      const path = '/mnt/c/safe/' + summary.proofRef;
      assert.equal(args.at(-1), path);
      return { status: 0, stdout: summary.proofSha256 + '  ' + path + '\n' };
    },
    });
  };
  const candidate = run(summary);
  assert.equal(candidate.ok, true);
  assert.equal(candidate.qualification, 'PENDING_INDEPENDENT_ATTESTATION');
  assert.equal(candidate.approvalAuthority, false);
  assert.equal(candidate.mergeAuthority, false);
  assert.equal(candidate.proofRef, summary.proofRef);
  for (const bad of [
    { ...summary, passedCases: 9 },
    { ...summary, independentReviewSatisfied: true },
    { ...summary, leaseReleaseAuthority: true },
    { ...summary, sourceHead: 'b'.repeat(40) },
    { ...summary, observationsSha256: 'bad' },
    { ...summary, proofRef: 'proofs/sovereign-calibration-pr-666-aaaaaaaaaaaa-dddddddddddd.json' },
    { ...summary, proofSha256: 'bad' },
  ]) {
    const result = run(bad);
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'CALIBRATION_EVIDENCE_UNQUALIFIED');
  }
  assert.equal(calls, 25);
  // Ten real local calls can take longer than one standard review, but each
  // attempt has a bounded wall-clock, not a new arbitrary remote command.
  // Checks apply to the synthetic Windows spawn adapter, not physical WSL.
  const denied = runWindowsSovereignReviewerV1(env, { ...context, mode: 'arbitrary', spawn: () => { throw Error('must not run'); } });
  assert.equal(denied.reason, 'REVIEW_MODE_UNSUPPORTED');
});

test('Windows bridge refuses forged success, mismatched PR/head, no Linux proof', () => {
  const check = (receipt, expectedReason) => {
    let calls = 0;
    const result = runWindowsSovereignReviewerV1(env, {
      ...context,
      spawn: () => {
        calls++;
        if (calls <= 2) return { status: 0, stdout: '/mnt/c/safe\n' };
        return { status: 0, stdout: 'SOVEREIGN_REVIEWER_RESULT=' + JSON.stringify(receipt) + '\n' };
      },
    });
    assert.equal(result.reason, expectedReason);
    assert.equal(result.mergeAuthority, false);
  };
  check({ status: 'LOCAL_REVIEW_EVIDENCE_READY', sourceHead: 'c'.repeat(40), prNumber: 3059,
    proofRef: 'proofs/sovereign-review-pr-3059-aaaaaaaaaaaa.json', mergeAuthority: false },
    'REVIEWER_RECEIPT_UNBOUND');
  check({ status: 'LOCAL_REVIEW_EVIDENCE_READY', sourceHead: 'a'.repeat(40), prNumber: 1234,
    proofRef: 'proofs/sovereign-review-pr-3059-aaaaaaaaaaaa.json', mergeAuthority: false },
    'REVIEWER_RECEIPT_UNBOUND');
  check({ status: 'LOCAL_REVIEW_EVIDENCE_READY', sourceHead: 'a'.repeat(40), prNumber: 3059,
    proofRef: 'proofs/sovereign-review-pr-3059-aaaaaaaaaaaa.json', mergeAuthority: true },
    'REVIEWER_RECEIPT_UNBOUND');
  // A formally valid but different proof filename must not be promoted.
  check({ status: 'LOCAL_REVIEW_EVIDENCE_READY', sourceHead: 'a'.repeat(40), prNumber: 3059,
    verdict: 'clean', proofRef: 'proofs/sovereign-review-pr-7777-aaaaaaaaaaaa.json', mergeAuthority: false },
    'REVIEWER_RECEIPT_UNBOUND');
  check({ status: 'LOCAL_REVIEW_EVIDENCE_READY', sourceHead: 'a'.repeat(40), prNumber: 3059,
    verdict: 'clean', proofRef: 'proofs/sovereign-review-pr-3059-bbbbbbbbbbbb.json', mergeAuthority: false },
    'REVIEWER_RECEIPT_UNBOUND');
  check({ status: 'LOCAL_REVIEW_EVIDENCE_READY', sourceHead: 'a'.repeat(40), prNumber: 3059,
    verdict: 'approved', proofRef: 'proofs/sovereign-review-pr-3059-aaaaaaaaaaaa.json', mergeAuthority: false },
    'REVIEWER_RECEIPT_UNBOUND');
  check({ status: 'SOVEREIGN_REVIEW_HELD', reason: 'LOCAL_MODEL_UNAVAILABLE' }, 'REVIEWER_RECEIPT_UNBOUND');
});


test('ordinary local review cannot be READY unless its exact proof file hashes on WSL', () => {
  const receipt = {
    status: 'LOCAL_REVIEW_EVIDENCE_READY', sourceHead: env.STEPHANOS_REVIEW_EXACT_HEAD,
    prNumber: 3059, verdict: 'clean',
    proofRef: 'proofs/sovereign-review-pr-3059-aaaaaaaaaaaa.json',
    proofSha256: 'e'.repeat(64), mergeAuthority: false,
  };
  const proof = '/mnt/c/safe/' + receipt.proofRef;
  const run = (hashResult) => {
    let stage = 0;
    const result = runWindowsSovereignReviewerV1(env, { ...context,
      spawn(_, args) {
        stage++;
        if (stage <= 2) return { status: 0, stdout: '/mnt/c/safe\n' };
        if (stage === 3) return {
          status: 0, stdout: 'SOVEREIGN_REVIEWER_RESULT=' + JSON.stringify(receipt) + '\n',
        };
        assert.deepEqual(args.slice(0, 3), ['--exec', '/usr/bin/sha256sum', '--']);
        assert.equal(args.at(-1), proof);
        return hashResult;
      },
    });
    assert.equal(stage, 4, 'the candidate must physically read back a file');
    assert.equal(result.approvalAuthority, false);
    assert.equal(result.mergeAuthority, false);
    return result;
  };
  assert.equal(run({ status: 0, stdout: 'e'.repeat(64) + '  ' + proof + '\n' }).ok, true);
  assert.equal(run({ status: 0, stdout: 'f'.repeat(64) + '  ' + proof + '\n' }).reason,
    'REVIEWER_PROOF_HASH_MISMATCH', 'same path with replaced bytes must fail');
  assert.equal(run({ status: 1, stdout: '' }).reason, 'REVIEWER_PROOF_FILE_UNREADABLE');
  assert.equal(run({ status: 0, stdout: 'forged proof' }).reason, 'REVIEWER_PROOF_READBACK_INVALID');
  assert.equal(run({ status: 0, stdout: 'e'.repeat(64) + '  /mnt/c/other.json\n' }).reason,
    'REVIEWER_PROOF_READBACK_INVALID');
});
