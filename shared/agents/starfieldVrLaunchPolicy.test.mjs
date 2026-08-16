import assert from 'node:assert/strict';
import test from 'node:test';

import {
  STARFIELD_VR_LAUNCH_ACTIONS,
  STARFIELD_VR_LAUNCH_EVIDENCE_VERDICT,
  STARFIELD_VR_LAUNCH_SCHEMA,
  evaluateStarfieldVrLaunch,
} from './starfieldVrLaunchPolicy.mjs';

const hash = (character) => character.repeat(64);
const gamePath = 'C:\\Program Files (x86)\\Steam\\steamapps\\common\\Starfield\\Starfield.exe';
const proxyPath = 'C:\\Program Files (x86)\\Steam\\steamapps\\common\\Starfield\\dxgi.dll';
const metaClientPath = 'C:\\Program Files\\Oculus\\Support\\oculus-client\\OculusClient.exe';

function mutarProfile() {
  return {
    schemaVersion: STARFIELD_VR_LAUNCH_SCHEMA,
    goal: 1591,
    workerGoal: 1595,
    status: 'ready',
    selectedProvider: 'mutar-openxr',
    transport: 'meta-air-link',
    game: {
      installationRoot: 'C:\\Program Files (x86)\\Steam\\steamapps\\common\\Starfield',
      launchExecutablePath: gamePath,
      launchExecutableSha256: hash('a'),
    },
    runtime: { openxrRuntime: 'meta' },
    provider: {
      version: 'v2.0.1.Public',
      files: [{ role: 'injection-proxy', path: proxyPath, sha256: hash('b') }],
    },
    evidence: {
      verdict: STARFIELD_VR_LAUNCH_EVIDENCE_VERDICT,
      packetPath: 'C:\\Users\\Stephan Callear\\Documents\\Stephanos-openclaw-workspace\\vr\\evidence\\packet.json',
      verifiedAtUtc: '2026-07-30T07:00:00.000Z',
    },
  };
}

function mutarObservations() {
  return {
    platform: 'win32',
    gameLauncher: { path: gamePath, sha256: hash('a'), exists: true },
    providerFiles: [{ path: proxyPath, sha256: hash('b'), exists: true }],
    metaClient: { path: metaClientPath, exists: true },
    airLinkSession: { active: true },
    activeOpenXrRuntimePath: 'C:\\Program Files\\Oculus\\Support\\oculus-runtime\\oculus_openxr_64.json',
  };
}

test('verified Mutar OpenXR profile launches through Meta Air Link', () => {
  const result = evaluateStarfieldVrLaunch(mutarProfile(), mutarObservations(), {
    now: new Date('2026-07-30T08:00:00.000Z'),
  });
  assert.equal(result.ok, true);
  assert.equal(result.action, STARFIELD_VR_LAUNCH_ACTIONS.MUTAR_OPENXR);
  assert.deepEqual(result.blockers, []);
});

test('Air Link must already be active before Starfield starts', () => {
  const observations = mutarObservations();
  observations.airLinkSession.active = false;
  const result = evaluateStarfieldVrLaunch(mutarProfile(), observations);
  assert.equal(result.action, STARFIELD_VR_LAUNCH_ACTIONS.BLOCKED);
  assert.ok(result.blockers.includes('meta-air-link-session-not-active'));
});

test('game and provider hashes bind launch to the verified evidence packet', () => {
  const observations = mutarObservations();
  observations.gameLauncher.sha256 = hash('c');
  observations.providerFiles[0].sha256 = hash('d');
  const result = evaluateStarfieldVrLaunch(mutarProfile(), observations);
  assert.ok(result.blockers.includes('game-launcher-identity-mismatch'));
  assert.ok(result.blockers.includes('provider-file-identity-mismatch:injection-proxy'));
});

test('Mutar cannot launch through a non-Meta OpenXR runtime', () => {
  const observations = mutarObservations();
  observations.activeOpenXrRuntimePath = 'C:\\Program Files (x86)\\Steam\\steamapps\\common\\SteamVR\\steamxr_win64.json';
  const result = evaluateStarfieldVrLaunch(mutarProfile(), observations);
  assert.ok(result.blockers.includes('meta-openxr-runtime-not-active'));
});

test('arbitrary executable paths are rejected even with matching hashes', () => {
  const profile = mutarProfile();
  const observations = mutarObservations();
  profile.game.launchExecutablePath = 'C:\\Windows\\System32\\cmd.exe';
  observations.gameLauncher.path = profile.game.launchExecutablePath;
  const result = evaluateStarfieldVrLaunch(profile, observations);
  assert.ok(result.blockers.includes('game-launcher-not-allowlisted'));
});

test('verified VorpX fallback remains a first-class launch action', () => {
  const profile = mutarProfile();
  profile.selectedProvider = 'vorpx';
  profile.provider = {
    version: 'operator-owned-baseline',
    companionExecutablePath: 'C:\\Program Files (x86)\\Animation Labs\\vorpX\\vorpControl.exe',
    companionExecutableSha256: hash('c'),
  };
  profile.runtime = { openxrRuntime: 'not-required' };
  const observations = mutarObservations();
  observations.companionExecutable = {
    path: profile.provider.companionExecutablePath,
    sha256: hash('c'),
    exists: true,
  };
  observations.activeOpenXrRuntimePath = '';
  const result = evaluateStarfieldVrLaunch(profile, observations);
  assert.equal(result.ok, true);
  assert.equal(result.action, STARFIELD_VR_LAUNCH_ACTIONS.VORPX);
});

test('a merely present dxgi.dll is not enough without verified evidence', () => {
  const profile = mutarProfile();
  profile.evidence.verdict = 'UNVERIFIED';
  const result = evaluateStarfieldVrLaunch(profile, mutarObservations());
  assert.ok(result.blockers.includes('verified-launch-evidence-missing'));
});
