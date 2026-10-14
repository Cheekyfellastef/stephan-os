import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CURATED_SKILL_CATALOG_SCHEMA, CURATED_PILOT,
  gitBlobSha1OfBytes, reviewCuratedSourcePilotV1,
} from './curatedExternalSkillPilotV1.mjs';

test('official pilot stays exact-source pinned and OpenClaw Local only', () => {
  assert.equal(CURATED_PILOT.repositoryUrl, 'https://github.com/openai/skills');
  assert.match(CURATED_PILOT.revision, /^[a-f0-9]{40}$/);
  assert.match(CURATED_PILOT.expectedGitBlobSha1, /^[a-f0-9]{40}$/);
  assert.equal(CURATED_PILOT.targetActor, 'openclaw-local');
  assert.equal(CURATED_PILOT.importDisposition, 'REVIEW_ONLY_NOT_INSTALLED');
  assert.equal(CURATED_PILOT.licenseSpdxClaim, 'Apache-2.0');
});

test('git blob hashing uses exactly the source byte sequence', () => {
  assert.equal(gitBlobSha1OfBytes(Buffer.from('hello world\n')), '3b18e512dba79e4c8300dd08aeb37f8e728b8dad');
  assert.notEqual(gitBlobSha1OfBytes(Buffer.from('hello world')), gitBlobSha1OfBytes(Buffer.from('hello world\n')));
});

test('unlisted skills and arbitrary source bytes cannot become an installation', () => {
  const input = Buffer.from('---\nname: other\ndescription: test\n---\n');
  const badId = reviewCuratedSourcePilotV1('another-skill', input);
  assert.equal(badId.schemaVersion, CURATED_SKILL_CATALOG_SCHEMA);
  assert.equal(badId.blocker, 'CURATED_SOURCE_NOT_ALLOWLISTED');
  assert.equal(badId.canInstall, false);
  const badBytes = reviewCuratedSourcePilotV1(CURATED_PILOT.id, input);
  assert.equal(badBytes.blocker, 'UPSTREAM_PINNED_SKILL_BYTES_MISMATCH');
  assert.equal(badBytes.canInstall, false);
  assert.equal(badBytes.activated, false);
  assert.equal(badBytes.candidate, undefined);
});

test('oversize and non-byte content fail closed', () => {
  for (const value of [null, 'a string', Buffer.alloc(65537, 0x41)]) {
    const result = reviewCuratedSourcePilotV1(CURATED_PILOT.id, value);
    assert.equal(result.blocker, 'CURATED_BYTES_NOT_ADMITTED');
    assert.equal(result.canInstall, false);
  }
});
