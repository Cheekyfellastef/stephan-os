import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { deflateRawSync } from 'node:zlib';
import {
  MAILBOX_FREE_GOAL_DISCOVERY_SCHEMA,
  decodeMailboxFreeGoalProofArchiveV1,
  classifyMailboxFreeGoalDiscoveryV1,
} from './mailboxFreeGoalDiscoveryV1.mjs';

const REPO = 'Cheekyfellastef/stephan-os';
const HEAD = 'c456bc0a0c97c7b267c8b4916fcd82ad90f52f8c';
const RUN_ID = 40573665291;
const JOB_ID = 122434245550;
const digest = bytes => 'sha256:' + createHash('sha256').update(bytes).digest('hex');
function crc32(buffer) {
  let crc = 0xffffffff;
  for (const octet of buffer) {
    crc ^= octet;
    for (let n = 0; n < 8; n++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
// Minimal one-entry ZIP fixture, generated rather than relying on test-cached
// metadata or the unavailable private GitHub artifact contents.
function makeZip(value, { name = 'stephanos-mailbox-free-readonly-proof.json', method = 0 } = {}) {
  const raw = Buffer.from(JSON.stringify(value));
  const data = method === 8 ? deflateRawSync(raw) : raw;
  const n = Buffer.from(name, 'utf8');
  const checksum = crc32(raw);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(method, 8);
  local.writeUInt32LE(checksum, 14);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(raw.length, 22);
  local.writeUInt16LE(n.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(method, 10);
  central.writeUInt32LE(checksum, 16);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(raw.length, 24);
  central.writeUInt16LE(n.length, 28);
  const centralLength = central.length + n.length;
  const localLength = local.length + n.length + data.length;
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(centralLength, 12);
  end.writeUInt32LE(localLength, 16);
  return Buffer.concat([local, n, data, central, n, end]);
}
function proof() {
  return {
    schemaVersion: 'stephanos.mailbox-free-dispatch-readonly.v1',
    verdict: 'READ_ONLY_OBSERVED',
    mode: 'READ_GOAL_STATUS',
    requestId: 'actions-run-' + RUN_ID + '-1',
    runId: RUN_ID,
    runAttempt: 1,
    goalNumber: 2961,
    goalState: 'OPEN',
    goalCommentCount: 253,
    sourceHead: HEAD,
    observedAtUtc: '2026-10-27T19:57:13.553Z',
    goalUrl: 'https://github.com/' + REPO + '/issues/2961',
    runUrl: 'https://github.com/' + REPO + '/actions/runs/' + RUN_ID,
    independentVerificationPerformed: false,
    executionAuthorized: false,
    nativePickupProven: false,
    sourceMutationAllowed: false,
    protectedMergeAllowed: false,
    nextGate: 'EXISTING_GOAL_OWNER_ADMISSION_AND_INDEPENDENT_REVIEW',
  };
}
function fixture() {
  const zip = makeZip(proof());
  return {
    run: {
      id: RUN_ID,
      workflow_id: 398609082,
      name: 'Stephanos Control Tower - Mailbox-Free Read-Only Pilot',
      path: '.github/workflows/stephanos-mailbox-free-readonly.yml',
      event: 'workflow_dispatch',
      run_attempt: 1,
      status: 'completed',
      conclusion: 'success',
      head_branch: 'main',
      head_sha: HEAD,
      repository: { full_name: REPO, id: 1179385578 },
      actor: { login: 'Cheekyfellastef', id: 267490109 },
      triggering_actor: { login: 'Cheekyfellastef' },
      created_at: '2026-10-27T19:57:03Z',
      updated_at: '2026-10-27T19:57:18Z',
    },
    jobs: { jobs: [
      { id: JOB_ID, run_id: RUN_ID, name: 'inspect-goal', status: 'completed', conclusion: 'success' },
      { id: JOB_ID + 1, run_id: RUN_ID, name: 'contract-test', status: 'completed', conclusion: 'skipped' },
    ] },
    artifact: {
      id: 12765876671,
      name: 'stephanos-mailbox-free-readonly-' + RUN_ID,
      expired: false, size_in_bytes: zip.length, digest: digest(zip),
      workflow_run: { id: RUN_ID, head_sha: HEAD },
    },
    archive: zip,
    mainHead: HEAD,
    goal: { number: 2961, state: 'open' },
    nowUtc: '2026-10-27T19:58:00.000Z',
  };
}
function repack(value, patch) {
  value.archive = makeZip({ ...proof(), ...patch });
  value.artifact.size_in_bytes = value.archive.length;
  value.artifact.digest = digest(value.archive);
  return value;
}
function held(value, expected) {
  const actual = classifyMailboxFreeGoalDiscoveryV1(value);
  assert.equal(actual.schemaVersion, MAILBOX_FREE_GOAL_DISCOVERY_SCHEMA);
  assert.equal(actual.disposition, 'HELD');
  assert.equal(actual.blocker, expected);
  assert.equal(actual.executionAuthorized, false);
  assert.equal(actual.sourceMutationAllowed, false);
  assert.equal(actual.nativePickupProven, false);
  assert.equal(Object.isFrozen(actual), true);
}

test('actual-shaped read-only goal observation becomes only a nonauthoritative discovery candidate', () => {
  const outcome = classifyMailboxFreeGoalDiscoveryV1(fixture());
  assert.equal(outcome.disposition, 'DISCOVERY_CANDIDATE_ONLY');
  assert.equal(outcome.goalNumber, 2961);
  assert.equal(outcome.runId, RUN_ID);
  assert.equal(outcome.artifactId, 12765876671);
  assert.equal(outcome.sourceHead, HEAD);
  assert.equal(outcome.proofObservedAtUtc, '2026-10-27T19:57:13.553Z');
  assert.equal(outcome.independentlyAuthenticatedTransport, false);
  assert.equal(outcome.originalGoalAdmissionGranted, false);
  assert.equal(outcome.exclusiveClaimGranted, false);
  assert.equal(outcome.sourceMutationAllowed, false);
  assert.equal(outcome.nativePickupProven, false);
  assert.equal(outcome.executionAuthorized, false);
  assert.equal(outcome.protectedMergeAllowed, false);
  assert.equal(Object.isFrozen(outcome), true);
});
test('single bounded ZIP parser also accepts deflated artifact data, without writing files', () => {
  const compressed = makeZip(proof(), {method: 8});
  assert.deepEqual(decodeMailboxFreeGoalProofArchiveV1(compressed), proof());
  assert.equal(decodeMailboxFreeGoalProofArchiveV1(Buffer.from('not a zip')), null);
});
test('wrong run event, branch, attempted rerun or wrong workflow cannot nominate goals', () => {
  for (const patch of [
    {event:'pull_request'}, {head_branch:'feature'}, {run_attempt:2},
    {workflow_id:9}, {path:'.github/workflows/untrusted.yml'},
    {status:'in_progress'}, {conclusion:'failure'}, {name:'Untrusted workflow'},
  ]) held({...fixture(),run:{...fixture().run,...patch}}, 'RUN_OR_OPERATOR_IDENTITY_UNPROVEN');
});
test('wrong GitHub owner, numeric actor, repository ID or triggering actor fail closed', () => {
  const a=fixture(); a.run.actor.id=1; held(a,'RUN_OR_OPERATOR_IDENTITY_UNPROVEN');
  const b=fixture(); b.run.repository.id=23; held(b,'RUN_OR_OPERATOR_IDENTITY_UNPROVEN');
  const c=fixture(); c.run.triggering_actor.login='attacker'; held(c,'RUN_OR_OPERATOR_IDENTITY_UNPROVEN');
});
test('changed main or changed head cannot be treated as current', () => {
  const a=fixture(); a.mainHead='b'.repeat(40); held(a,'CURRENT_MAIN_OR_RUN_HEAD_MOVED');
  const b=fixture(); b.run.head_sha='b'.repeat(40); held(b,'CURRENT_MAIN_OR_RUN_HEAD_MOVED');
});
test('missing, failed, duplicate, or appended physical jobs are rejected', () => {
  const a=fixture(); a.jobs.jobs[0].conclusion='failure'; held(a,'EXACT_TERMINAL_INSPECTION_JOB_UNPROVEN');
  const b=fixture(); b.jobs.jobs.push({...b.jobs.jobs[0]}); held(b,'EXACT_TERMINAL_INSPECTION_JOB_UNPROVEN');
  const c=fixture(); c.jobs.jobs[1].name='writer'; held(c,'EXACT_TERMINAL_INSPECTION_JOB_UNPROVEN');
  const d=fixture(); d.jobs.jobs[0].run_id=42; held(d,'EXACT_TERMINAL_INSPECTION_JOB_UNPROVEN');
});
test('artifact must belong to original run and exact source, not just have a familiar name', () => {
  const a=fixture(); a.artifact.workflow_run.head_sha='b'.repeat(40);
  held(a,'IMMUTABLE_ARTIFACT_IDENTITY_OR_SHA256_INVALID');
  const b=fixture(); b.artifact.workflow_run.id=999; held(b,'IMMUTABLE_ARTIFACT_IDENTITY_OR_SHA256_INVALID');
  const c=fixture(); c.artifact.name+='-copy'; held(c,'IMMUTABLE_ARTIFACT_IDENTITY_OR_SHA256_INVALID');
  const d=fixture(); d.artifact.expired=true; held(d,'IMMUTABLE_ARTIFACT_IDENTITY_OR_SHA256_INVALID');
});
test('ZIP digest corruption and metadata tampering block before JSON is read', () => {
  const a=fixture(); a.artifact.digest='sha256:'+'0'.repeat(64);
  held(a,'IMMUTABLE_ARTIFACT_IDENTITY_OR_SHA256_INVALID');
  const b=fixture(); b.archive=Buffer.from(b.archive); b.archive[35]^=0x01;
  held(b,'IMMUTABLE_ARTIFACT_IDENTITY_OR_SHA256_INVALID');
});
test('bounded archive rejects unexpected filename, CRC mismatch and an injected extra proof field', () => {
  const badName=makeZip(proof(),{name:'../proof.json'});
  assert.equal(decodeMailboxFreeGoalProofArchiveV1(badName),null);
  const badCrc=makeZip(proof()); badCrc.writeUInt32LE(0,14);
  assert.equal(decodeMailboxFreeGoalProofArchiveV1(badCrc),null);
  const extra=makeZip({...proof(),sourceMutationAllowed:false,extraGrant:true});
  assert.equal(decodeMailboxFreeGoalProofArchiveV1(extra),null);
});
test('artifact proof cannot authorize execution by changing any protected boolean', () => {
  for (const field of ['executionAuthorized','sourceMutationAllowed','protectedMergeAllowed',
    'nativePickupProven','independentVerificationPerformed']) {
    held(repack(fixture(),{[field]:true}),'READ_ONLY_GOAL_PROOF_SCOPE_INVALID');
  }
});
test('forged goal number, read-only verdict, run binding and source binding all hold', () => {
  for(const patch of [
    {goalNumber:1}, {verdict:'BUILDING'}, {runId:RUN_ID+1},
    {requestId:'actions-run-99-1'}, {sourceHead:'b'.repeat(40)},
    {runAttempt:2}, {nextGate:'AUTO_APPROVE'},
    {goalUrl:'https://attacker.invalid/issues/2961'},
  ]) held(repack(fixture(),patch),'READ_ONLY_GOAL_PROOF_SCOPE_INVALID');
});
test('closed or mismatched original goal is never a builder discovery candidate', () => {
  const a=fixture(); a.goal.state='closed'; held(a,'CURRENT_CANONICAL_GOAL_NOT_OPEN');
  const b=fixture(); b.goal.number=5000; held(b,'CURRENT_CANONICAL_GOAL_NOT_OPEN');
  const c=fixture(); c.goal.pull_request={}; held(c,'CURRENT_CANONICAL_GOAL_NOT_OPEN');
});
test('stale proof, clock poisoning, backwards run times and future proof are refused', () => {
  const a=fixture(); a.nowUtc='2026-10-29T19:58:00.000Z';
  held(a,'OBSERVATION_OUTSIDE_FRESH_RUN_WINDOW');
  const b=fixture(); b.nowUtc='not a timestamp'; held(b,'OBSERVATION_CLOCK_UNTRUSTED');
  const c=fixture(); c.run.updated_at='2026-10-27T19:56:00Z';
  held(c,'OBSERVATION_OUTSIDE_FRESH_RUN_WINDOW');
  const d=repack(fixture(),{observedAtUtc:'2026-10-27T20:30:00.000Z'});
  held(d,'OBSERVATION_OUTSIDE_FRESH_RUN_WINDOW');
});
test('missing evidence and arbitrary packets always fail closed', () => {
  held({},'RUN_OR_OPERATOR_IDENTITY_UNPROVEN');
  const a=fixture(); a.jobs={}; held(a,'EXACT_TERMINAL_INSPECTION_JOB_UNPROVEN');
  const b=fixture(); b.archive=Buffer.alloc(64*1024+1); b.artifact.size_in_bytes=b.archive.length;
  held(b,'IMMUTABLE_ARTIFACT_IDENTITY_OR_SHA256_INVALID');
});
