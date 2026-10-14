import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  PINNED_GITHUB_SKILL_INTAKE_SCHEMA,
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
    encoding: 'base64', sha: gitSha,
    size: bytes.length, content: bytes.toString('base64').replace(/.{76}/g, '$&\n'),
  };
}
function mockedResponse(json, headers = {}) {
  return new Response(JSON.stringify(json), {
    status: 200, headers: { 'Content-Type': 'application/json', ...headers },
  });
}

test('construct only a pinned github.com single-file read, never a branch or shell', () => {
  const prepared = preparePinnedGithubSkillSourceV2(INPUT);
  assert.equal(prepared.verdict, 'SOURCE_READ_PREPARED');
  assert.equal(prepared.sourceUrl,
    'https://api.github.com/repos/openai/skills/contents/skills/.system/skill-creator/SKILL.md?ref=' + INPUT.revision);
  assert.equal(prepared.autoDownload, false);
  for (const changed of [
    { revision: 'main' },
    { repositoryUrl: 'https://github.com.evil.test/openai/skills' },
    { repositoryUrl: 'http://github.com/openai/skills' },
    { skillPath: '../SKILL.md' },
    { skillPath: 'skills/%2e%2e/SKILL.md' },
    { skillPath: 'skills/foo\\bar/SKILL.md' },
    { skillPath: 'skills/a/SKILL.md?token=x' },
  ]) {
    assert.equal(preparePinnedGithubSkillSourceV2({ ...INPUT, ...changed }).verdict, 'SOURCE_HELD');
  }
});

test('byte/metadata proof keeps candidate uninstalled and publisher/licence unverified', () => {
  const result = assessPinnedGithubContentsV2(INPUT, contents());
  assert.equal(result.schemaVersion, PINNED_GITHUB_SKILL_INTAKE_SCHEMA);
  assert.equal(result.verdict, 'SOURCE_VERIFIED_REVIEW_REQUIRED');
  assert.equal(result.sourceVerified, true);
  assert.equal(result.sourceProof.verification, 'PINNED_GITHUB_CONTENTS_API_BLOB_MATCHED');
  assert.equal(result.sourceProof.contentSha256.length, 64);
  assert.equal(result.sourceProof.licenseVerified, false);
  assert.equal(result.sourceProof.publisherIdentityVerified, false);
  assert.equal(result.candidate.verdict, 'REVIEW_REQUIRED');
  assert.equal(result.candidate.provenance, 'EXTERNAL_DRAFT_NOT_INSTALLED');
  assert.equal(result.candidate.activated, false);
  assert.equal(result.canInstall, false);
  assert.equal(result.canExecute, false);
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
  const oversized = contents('x'.repeat(65537));
  assert.equal(assessPinnedGithubContentsV2(INPUT, oversized).verdict, 'SOURCE_HELD');
});

test('authenticated transport is fixed to exactly one read with no redirection or mutation', async () => {
  const calls = [];
  const result = await fetchPinnedGithubSkillV2(INPUT, {
    fetchFn: async (url, options) => {
      calls.push({ url, options });
      return mockedResponse(contents(), { 'x-ratelimit-limit': '5000', 'x-ratelimit-remaining': '4800' });
    },
  });
  assert.equal(result.verdict, 'SOURCE_VERIFIED_REVIEW_REQUIRED');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.method, 'GET');
  assert.equal(calls[0].options.redirect, 'error');
  assert.equal('Authorization' in calls[0].options.headers, false);
  assert.equal(result.sourceProof.runtimeInstalled, false);
});

test('budget reserve, bad API response and network failure fail closed', async () => {
  const overBudget = await fetchPinnedGithubSkillV2(INPUT, {
    fetchFn: async () => mockedResponse(contents(), {
      'x-ratelimit-limit': '5000', 'x-ratelimit-remaining': '500',
    }),
  });
  assert.equal(overBudget.blocker, 'GITHUB_API_RESERVE_HOLD');
  assert.equal(overBudget.sourceVerified, false);
  const malformed = await fetchPinnedGithubSkillV2(INPUT, { fetchFn: async () => new Response('{', { status: 200 }) });
  assert.equal(malformed.verdict, 'SOURCE_HELD');
  const networkDown = await fetchPinnedGithubSkillV2(INPUT, { fetchFn: async () => { throw Error('secret'); } });
  assert.equal(networkDown.blocker, 'GITHUB_PINNED_READ_FAILED');
  assert.equal(JSON.stringify(networkDown).includes('secret'), false);
});

test('even a verified source without proper skill frontmatter remains blocked', () => {
  const result = assessPinnedGithubContentsV2(INPUT, contents('NOT AN ADMISSIBLE SKILL'));
  assert.equal(result.verdict, 'SOURCE_VERIFIED_DRAFT_BLOCKED');
  assert.equal(result.sourceVerified, true);
  assert.equal(result.candidate.verdict, 'STRUCTURALLY_BLOCKED');
  assert.equal(result.canInstall, false);
});
