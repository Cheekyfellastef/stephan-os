#!/usr/bin/env node
import { fileURLToPath } from 'node:url';

import { readBrokeredGithubJson } from '../shared/agents/githubObservationBrokerV1.mjs';

const MAIN_ENDPOINT = 'repos/Cheekyfellastef/stephan-os/branches/main';
const COMPARE_PATTERN = /^repos\/Cheekyfellastef\/stephan-os\/compare\/([0-9a-f]{40})\.\.\.([0-9a-f]{40})$/i;
const SHA40 = /^[0-9a-f]{40}$/i;

export function resolveRecoveryGuardianGithubObservation(argv = []) {
  const [mode, command, endpoint, ...rest] = argv.map((value) => String(value));
  if (!['text', 'json'].includes(mode) || command !== 'api') {
    return Object.freeze({ ok: false, reason: 'GUARDIAN_GITHUB_OBSERVATION_ARGUMENTS_INVALID' });
  }
  if (endpoint === MAIN_ENDPOINT && mode === 'text' && rest.length === 2 && rest[0] === '--jq' && rest[1] === '.commit.sha') {
    return Object.freeze({
      ok: true,
      mode,
      endpoint,
      key: 'recovery-guardian-main-branch',
      ttlMs: 90_000,
      maxStaleMs: 5 * 60_000,
      projection: 'MAIN_SHA',
    });
  }
  const compare = endpoint.match(COMPARE_PATTERN);
  if (compare && mode === 'json' && rest.length === 0) {
    return Object.freeze({
      ok: true,
      mode,
      endpoint,
      key: `recovery-guardian-compare:${compare[1].toLowerCase()}:${compare[2].toLowerCase()}`,
      ttlMs: 24 * 60 * 60_000,
      maxStaleMs: 24 * 60 * 60_000,
      projection: 'JSON',
    });
  }
  return Object.freeze({ ok: false, reason: 'GUARDIAN_GITHUB_OBSERVATION_SURFACE_NOT_ALLOWLISTED' });
}

export function runRecoveryGuardianGithubObservation({
  argv = process.argv.slice(2),
  readObservation = readBrokeredGithubJson,
} = {}) {
  const request = resolveRecoveryGuardianGithubObservation(argv);
  if (!request.ok) return request;
  const observed = readObservation({
    key: request.key,
    endpoint: request.endpoint,
    ttlMs: request.ttlMs,
    maxStaleMs: request.maxStaleMs,
  });
  if (!observed?.ok) {
    return Object.freeze({ ok: false, reason: observed?.reason || 'GUARDIAN_GITHUB_OBSERVATION_READ_FAILED' });
  }
  if (request.projection === 'MAIN_SHA') {
    const sha = String(observed.payload?.commit?.sha || '').trim().toLowerCase();
    if (!SHA40.test(sha)) return Object.freeze({ ok: false, reason: 'GUARDIAN_GITHUB_MAIN_SHA_INVALID' });
    return Object.freeze({ ok: true, output: sha, source: observed.source });
  }
  return Object.freeze({ ok: true, output: JSON.stringify(observed.payload), source: observed.source });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = runRecoveryGuardianGithubObservation();
  if (!result.ok) {
    process.stderr.write(`${result.reason}\n`);
    process.exitCode = 2;
  } else {
    process.stdout.write(`${result.output}\n`);
  }
}
