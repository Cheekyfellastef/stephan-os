import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { deflateRawSync } from 'node:zlib';
import {
  MAILBOX_FREE_GOAL_NOMINATION_SCHEMA,
  decodeMailboxFreeReadbackArchiveV1,
  projectMailboxFreeGoalNominationV1,
} from './mailboxFreeGoalNominationV1.mjs';

const REPO = 'Cheekyfellastef/stephan-os';
const HEAD = 'dffef528c6486a0a5fe8ef1c665de1a510cffc40';
const READBACK = 40604711141;
const ORIGIN = 40604678763;
const ZIP_NAME = 'mailbox-free-goal-readback.json';
const sha = value => createHash('sha256').update(value).digest('hex');
function crc32(value) {
  let crc = 0xffffffff;
  for (const octet of value) {
    crc ^= octet;
    for (let n = 0; n < 8; n++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function oneZip(value, { method = 8, name = ZIP_NAME, descriptor = false } = {}) {
  const raw = Buffer.from(JSON.stringify(value), 'utf8');
  const data = method === 8 ? deflateRawSync(raw) : raw;
  const filename = Buffer.from(name);
  const crc = crc32(raw);
  const flags = descriptor ? 8 : 0;
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(flags, 6);
  local.writeUInt16LE(method, 8);
  if (!descriptor) {
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
  }
  local.writeUInt16LE(filename.length, 26);
  const dataEnd = local.length + filename.length + data.length;
  const tail = descriptor ? Buffer.alloc(16) : Buffer.alloc(0);
  if (descriptor) {
    tail.writeUInt32LE(0x08074b50, 0);
    tail.writeUInt32LE(crc, 4);
    tail.writeUInt32LE(data.length, 8);
    tail.writeUInt32LE(raw.length, 12);
  }
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(flags, 8);
  central.writeUInt16LE(method, 10);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(raw.length, 24);
  central.writeUInt16LE(filename.length, 28);
  const centralOffset = dataEnd + tail.length;
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + filename.length, 12);
  end.writeUInt32LE(centralOffset, 16);
  return Buffer.concat([local, filename, data, tail, central, filename, end]);
}
function proof() {
  return {
    schemaVersion: 'stephanos.mailbox-free-auto-readback-stage4.v1',
    verdict: 'READ_ONLY_GITHUB_EVIDENCE_CORRELATED',
    blocker: '',
    originRunId: ORIGIN,
    goalNumber: 2961,
    sourceHead: HEAD,
    originatingArtifactId: 12779797432,
    artifactSha256: '6d57a187cf12f647489ab9273833d93d000126c3e1dc22c7a9c2b822a888f470',
    sourceProofKind: 'GITHUB_RUN_ARTIFACT_AND_GOAL_GET_VERIFIED',
    originalGoalAdmissionGranted: false,
    exclusiveClaimGranted: false,
    executionAuthorized: false,
    sourceMutationAllowed: false,
    protectedMergeAllowed: false,
    nativePickupProven: false,
    independentlyAuthenticatedNativeCustody: false,
    nextGate: 'ORIGINAL_MISSION_OWNER_SOURCE_LEASE_AND_PICKUP_PROOF',
  };
}
function makeRun({ id, workflowId, path, name, event, created, updated } ) {
  return {
    id, workflow_id: workflowId, path, name, event,
    run_attempt: 1, status: 'completed', conclusion: 'success',
    head_branch: 'main', head_sha: HEAD,
    repository: { full_name: REPO, id: 1179385578 },
    actor: { login: 'Cheekyfellastef', id: 267490109 },
    triggering_actor: { login: 'Cheekyfellastef' },
    created_at: created, updated_at: updated,
  };
}
function fixture() {
  const archive = oneZip(proof());
  return {
    readbackRun: makeRun({
      id: READBACK, workflowId: 398829071,
      path: '.github/workflows/stephanos-mailbox-free-auto-readback.yml',
      name: 'Stephanos Control Tower - Automatic Read-Only Proof Readback',
      event: 'workflow_run',
      created: '2026-10-27T23:49:17Z', updated: '2026-10-27T23:49:29Z',
    }),
    originRun: makeRun({
      id: ORIGIN, workflowId: 398609082,
      path: '.github/workflows/stephanos-mailbox-free-readonly.yml',
      name: 'Stephanos Control Tower - Mailbox-Free Read-Only Pilot',
      event: 'workflow_dispatch',
      created: '2026-10-27T23:48:59Z', updated: '2026-10-27T23:49:15Z',
    }),
    artifact: {
      id: 12780691240,
      name: 'stephanos-mailbox-free-auto-readback-' + ORIGIN + '-' + READBACK,
      expired: false, size_in_bytes: archive.length,
      digest: 'sha256:' + sha(archive),
      workflow_run: { id: READBACK, repository_id: 1179385578,
        head_branch: 'main', head_sha: HEAD },
    },
    archive, mainHead: HEAD, goal: { number: 2961, state: 'open' },
    nowUtc: '2026-10-27T23:55:00.000Z',
  };
}
function tamperedProof(packet, changes) {
  packet.archive = oneZip({ ...proof(), ...changes });
  packet.artifact.size_in_bytes = packet.archive.length;
  packet.artifact.digest = 'sha256:' + sha(packet.archive);
  return packet;
}
function held(packet, code) {
  const result = projectMailboxFreeGoalNominationV1(packet);
  assert.equal(result.schemaVersion, MAILBOX_FREE_GOAL_NOMINATION_SCHEMA);
  assert.equal(result.disposition, 'HELD');
  assert.equal(result.blocker, code);
  assert.equal(result.schedulerEligible, false);
  assert.equal(result.exclusiveClaimGranted, false);
  assert.equal(result.sourceMutationAllowed, false);
  assert.equal(result.executionAuthorized, false);
  assert.equal(result.protectedMergeAllowed, false);
  assert.equal(result.nativePickupProven, false);
  assert.equal(result.independentlyAuthenticatedTransport, false);
  assert.equal(Object.isFrozen(result), true);
}

test('genuine-shaped correlated Stage4 evidence produces only an ineligible nomination', () => {
  const record = projectMailboxFreeGoalNominationV1(fixture());
  assert.equal(record.disposition, 'DISCOVERY_ONLY_NOT_ADMITTED');
  assert.equal(record.goalIssueNumber, 2961);
  assert.equal(record.originRunId, ORIGIN);
  assert.equal(record.readbackRunId, READBACK);
  assert.equal(record.readbackArtifactId, 12780691240);
  assert.equal(record.sourceHead, HEAD);
  assert.equal(record.schedulerEligible, false);
  assert.equal(record.originalGoalAdmissionGranted, false);
  assert.equal(record.exclusiveClaimGranted, false);
  assert.equal(record.sourceMutationAllowed, false);
  assert.equal(record.protectedMergeAllowed, false);
  assert.equal(record.executionAuthorized, false);
  assert.equal(record.nativePickupProven, false);
  assert.equal(record.independentlyAuthenticatedNativeCustody, false);
  assert.equal(record.independentlyAuthenticatedTransport, false);
  assert.equal(Object.isFrozen(record), true);
});
test('fixed ZIP parser supports stored, deflated and signed-descriptor inputs', () => {
  for (const params of [{ method: 0 }, { method: 8 }, { method: 8, descriptor: true }]) {
    assert.deepEqual(decodeMailboxFreeReadbackArchiveV1(oneZip(proof(), params)), proof());
  }
});
test('forged origin event, wrong workflow and second attempt remain ineligible', () => {
  for (const overrides of [
    { event: 'push' }, { run_attempt: 2 }, { workflow_id: 9 },
    { head_branch: 'pull/23' }, { status: 'in_progress' }, { conclusion: 'failure' },
  ]) {
    const f = fixture(); Object.assign(f.originRun, overrides);
    held(f, 'ORIGIN_OR_READBACK_RUN_IDENTITY_UNPROVEN');
  }
});
test('forged readback event, head, workflow or operator remains ineligible', () => {
  for (const overrides of [
    { event: 'workflow_dispatch' }, { run_attempt: 2 },
    { workflow_id: 398609082 }, { head_branch: 'feature' },
    { path: '.github/workflows/untrusted.yml' },
  ]) {
    const f = fixture(); Object.assign(f.readbackRun, overrides);
    held(f, 'ORIGIN_OR_READBACK_RUN_IDENTITY_UNPROVEN');
  }
  const f = fixture(); f.readbackRun.actor.id = 1;
  held(f, 'ORIGIN_OR_READBACK_RUN_IDENTITY_UNPROVEN');
});
test('different protected main or cross-run source head must fail closed', () => {
  const a = fixture(); a.mainHead = 'b'.repeat(40);
  held(a, 'CURRENT_MAIN_NOT_EXACTLY_BOUND');
  const b = fixture(); b.originRun.head_sha = 'b'.repeat(40);
  held(b, 'CURRENT_MAIN_NOT_EXACTLY_BOUND');
});
test('outdated observation or future run is never a new task', () => {
  const a = fixture(); a.nowUtc = '2026-11-01T23:55:00.000Z';
  held(a, 'RUN_FRESHNESS_OR_CLOCK_UNPROVEN');
  const b = fixture(); b.nowUtc = '2026-10-27T23:00:00.000Z';
  held(b, 'RUN_FRESHNESS_OR_CLOCK_UNPROVEN');
  const c = fixture(); c.readbackRun.updated_at = 'not-a-date';
  held(c, 'ORIGIN_OR_READBACK_RUN_IDENTITY_UNPROVEN');
});
test('artifact digest, run identity, name and size must agree', () => {
  const a = fixture(); a.artifact.digest = 'sha256:' + '0'.repeat(64);
  held(a, 'READBACK_ARTIFACT_ID_OR_DIGEST_UNPROVEN');
  const b = fixture(); b.artifact.workflow_run.id = 99;
  held(b, 'READBACK_ARTIFACT_ID_OR_DIGEST_UNPROVEN');
  const c = fixture(); c.artifact.name += '-replayed';
  held(c, 'READBACK_ARTIFACT_ID_OR_DIGEST_UNPROVEN');
  const d = fixture(); d.artifact.size_in_bytes++;
  held(d, 'READBACK_ARTIFACT_ID_OR_DIGEST_UNPROVEN');
  const e = fixture(); e.artifact.expired = true;
  held(e, 'READBACK_ARTIFACT_ID_OR_DIGEST_UNPROVEN');
});
test('archive corruption, traversal, oversize and false ZIP metadata are denied', () => {
  const a = fixture(); a.archive = Buffer.from(a.archive);
  a.archive[41] ^= 0xff;
  held(a, 'READBACK_ARTIFACT_ID_OR_DIGEST_UNPROVEN');
  assert.equal(decodeMailboxFreeReadbackArchiveV1(oneZip(proof(), {name: '../evil.json'})), null);
  const b = oneZip(proof()); b.writeUInt32LE(0, 14);
  assert.equal(decodeMailboxFreeReadbackArchiveV1(b), null);
  const c = oneZip(proof(), {descriptor: true});
  c.writeUInt32LE(0, c.length - 22 - (46 + Buffer.byteLength(ZIP_NAME)) - 12);
  assert.equal(decodeMailboxFreeReadbackArchiveV1(c), null);
  assert.equal(decodeMailboxFreeReadbackArchiveV1(Buffer.alloc(65537)), null);
});
test('readback proof schema cannot carry extra attacker authorization fields', () => {
  const a = tamperedProof(fixture(), { operatorApproval: true });
  held(a, 'READBACK_ARCHIVE_INVALID_OR_UNBOUNDED');
});
test('every proof authority boolean must remain exactly false', () => {
  for (const field of ['originalGoalAdmissionGranted', 'exclusiveClaimGranted',
    'executionAuthorized', 'sourceMutationAllowed', 'protectedMergeAllowed',
    'nativePickupProven', 'independentlyAuthenticatedNativeCustody']) {
    held(tamperedProof(fixture(), { [field]: true }), 'READBACK_SCOPE_OR_DENIAL_INVALID');
  }
});
test('run, source, goal, digest and next-gate tampering never grants nomination', () => {
  for (const patch of [
    { originRunId: ORIGIN + 1 }, { sourceHead: 'b'.repeat(40) },
    { artifactSha256: 'fake' },
    { originatingArtifactId: 0 }, { verdict: 'SOURCE_ADMITTED' },
    { nextGate: 'START_NATIVE_WORKER' },
  ]) held(tamperedProof(fixture(), patch), 'READBACK_SCOPE_OR_DENIAL_INVALID');
  // A positive alternate goal number is structurally valid, but is not the
  // real observed original GitHub issue and must remain ineligible.
  held(tamperedProof(fixture(), { goalNumber: 24 }),
    'ORIGINAL_GOAL_NOT_CURRENTLY_OPEN');
});
test('replaced source proof kind and nonempty blocker are held', () => {
  held(tamperedProof(fixture(), { sourceProofKind: 'SIGNED_OWNER_GRANT' }),
    'READBACK_SCOPE_OR_DENIAL_INVALID');
  held(tamperedProof(fixture(), { blocker: 'NOT_STARTED' }),
    'READBACK_SCOPE_OR_DENIAL_INVALID');
});
test('closed or wrong issue cannot be promoted into scheduler inventory', () => {
  const a = fixture(); a.goal.state = 'closed';
  held(a, 'ORIGINAL_GOAL_NOT_CURRENTLY_OPEN');
  const b = fixture(); b.goal.number = 1;
  held(b, 'ORIGINAL_GOAL_NOT_CURRENTLY_OPEN');
  const c = fixture(); c.goal.pull_request = {};
  held(c, 'ORIGINAL_GOAL_NOT_CURRENTLY_OPEN');
});
test('untrusted, incomplete or injected objects remain held', () => {
  held({}, 'ORIGIN_OR_READBACK_RUN_IDENTITY_UNPROVEN');
  const a = fixture(); delete a.readbackRun.actor;
  held(a, 'ORIGIN_OR_READBACK_RUN_IDENTITY_UNPROVEN');
  const b = fixture(); delete b.artifact.workflow_run;
  held(b, 'READBACK_ARTIFACT_ID_OR_DIGEST_UNPROVEN');
  const c = fixture(); c.archive = null;
  held(c, 'READBACK_ARTIFACT_ID_OR_DIGEST_UNPROVEN');
});
