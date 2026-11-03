import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  preparePinnedGithubSkillSourceV2,
  assessPinnedGithubContentsV2,
  fetchPinnedGithubSkillV2,
} from './pinnedGithubSkillIntakeV2.mjs';

const SKILL = '---\nname: example-skill\ndescription: Explain a bounded local task\n---\n# Bounded task\nOnly propose and review steps.\n';
const INPUT = {
  repositoryUrl: 'https://github.com/openai/skills',
  revision: 'a'.repeat(40),
  skillPath: 'skills/.system/skill-creator/SKILL.md',
  registry: 'openai', publisher: 'openai',
  licenseSpdx: 'MIT', name: 'Example skill creator',
};

function contents(content = SKILL) {
  const bytes = Buffer.from(content, 'utf8');
  const gitSha = createHash('sha1').update(Buffer.from('blob ' + bytes.length + '\0')).update(bytes).digest('hex');
  return {
    name: 'SKILL.md', path: INPUT.skillPath, type: 'file',
    encoding: 'base64', sha: gitSha, size: bytes.length,
    content: bytes.toString('base64').replace(/.{76}/g, '$&\n'),
  };
}

test('construct only a pinned github.com single-file read, never a branch or shell', () => {
  const prepared = preparePinnedGithubSkillSourceV2(INPUT);
  assert.equal(prepared.verdict, 'SOURCE_READ_PREPARED');
  assert.equal(prepared.sourceUrl,
    'https://api.github.com/repos/openai/skills/contents/skills/.system/skill-creator/SKILL.md?ref=' + INPUT.revision);
  assert.equal(prepared.canExecute, false);
  for (const changed of [
    { revision: 'main' },
    { repositoryUrl: 'https://github.com.evil.test/openai/skills' },
    { repositoryUrl: 'http://github.com/openai/skills' },
    { skillPath: '../SKILL.md' },
    { skillPath: 'skills/%2e%2e/SKILL.md' },
    { skillPath: 'skills/foo\\bar/SKILL.md' },
    { skillPath: 'skills/a/SKILL.md?token=x' },
  ]) assert.equal(preparePinnedGithubSkillSourceV2({ ...INPUT, ...changed }).verdict, 'SOURCE_HELD');
});

test('pure byte assessor never authenticates source even with self-consistent Git blob metadata', () => {
  const result = assessPinnedGithubContentsV2(INPUT, contents());
  assert.equal(result.verdict, 'UNTRUSTED_BYTES_MATCHED_REVIEW_REQUIRED');
  assert.equal(result.sourceVerified, false);
  assert.equal(result.sourceProof.verification, 'SELF_CONSISTENT_UNAUTHENTICATED_BYTES');
  assert.equal(result.sourceProof.contentSha256, createHash('sha256').update(SKILL).digest('hex'));
  assert.equal(result.sourceProof.licenseVerified, false);
  assert.equal(result.sourceProof.publisherIdentityVerified, false);
  assert.equal(result.candidate.provenance, 'EXTERNAL_DRAFT_NOT_INSTALLED');
  assert.equal(result.candidate.activated, false);
  assert.equal(result.canInstall, false);
  assert.equal(result.canGrantPermissions, false);
  assert.ok(!JSON.stringify(result).includes('# Bounded task'));
});

test('strictly reject inconsistent or swapped GitHub content', () => {
  const good = contents();
  for (const bad of [
    { ...good, sha: 'b'.repeat(40) },
    { ...good, path: 'skills/other/SKILL.md' },
    { ...good, type: 'dir' },
    { ...good, encoding: 'utf-8' },
    { ...good, size: good.size + 1 },
    { ...good, content: good.content + '???' },
  ]) {
    const result = assessPinnedGithubContentsV2(INPUT, bad);
    assert.equal(result.sourceVerified, false);
    assert.equal(result.canInstall, false);
    assert.equal(result.candidate, null);
  }
  assert.equal(assessPinnedGithubContentsV2(INPUT, contents('x'.repeat(65537))).verdict, 'SOURCE_HELD');
});

test('a UTF-8 BOM stays bound to the exact source bytes and cannot alter the candidate identity', () => {
  const raw = '\uFEFF' + SKILL;
  const result = assessPinnedGithubContentsV2(INPUT, contents(raw));
  const exact = createHash('sha256').update(Buffer.from(raw, 'utf8')).digest('hex');
  assert.equal(result.verdict, 'UNTRUSTED_BYTES_MATCHED_REVIEW_REQUIRED');
  assert.equal(result.sourceProof.contentSha256, exact);
  assert.equal(result.candidate.contentSha256, exact);
  assert.equal(result.sourceProof.contentBytes, Buffer.byteLength(raw, 'utf8'));
  assert.equal(result.sourceVerified, false);
});

test('import cannot authenticate or execute malformed skill even when bytes match', () => {
  const result = assessPinnedGithubContentsV2(INPUT, contents('NOT AN ADMISSIBLE SKILL'));
  assert.equal(result.verdict, 'UNTRUSTED_BYTES_MATCHED_DRAFT_BLOCKED');
  assert.equal(result.sourceVerified, false);
  assert.equal(result.candidate.verdict, 'STRUCTURALLY_BLOCKED');
  assert.equal(result.canExecute, false);
});

test('invalid input is refused before any network operation, with no injectable verified transport', async () => {
  const fake = () => { throw Error('should not execute'); };
  const result = await fetchPinnedGithubSkillV2({ ...INPUT, revision: 'main' }, { fetchFn: fake });
  assert.equal(result.verdict, 'SOURCE_HELD');
  assert.equal(result.sourceVerified, false);
  assert.equal(result.canInstall, false);
  assert.equal(fetchPinnedGithubSkillV2.length, 0); // defaulted one-input API, no callback argument
});
