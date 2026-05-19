import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveGithubRepoConfig } from '../services/githubPrEvidenceService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const routeSource = fs.readFileSync(path.join(__dirname, '../routes/github.js'), 'utf8');

test('github route is read-only GET and has no write endpoints', () => {
  assert.match(routeSource, /router\.get\('\/pr-evidence'/);
  assert.doesNotMatch(routeSource, /router\.(post|put|patch|delete)\('/);
});

test('repo config resolver reads canonical owner/repo from slug env', () => {
  const repo = resolveGithubRepoConfig({ GITHUB_REPOSITORY: 'Cheekyfellastef/stephan-os' });
  assert.deepEqual(repo, { owner: 'Cheekyfellastef', repo: 'stephan-os' });
});

test('repo config resolver returns null when owner/repo unavailable', () => {
  const repo = resolveGithubRepoConfig({});
  assert.equal(repo, null);
});


test('github route surfaces needs-pr-number contract for missing PR query', () => {
  assert.match(routeSource, /needs-pr-number/);
});
