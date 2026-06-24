import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCoBuilderOperationalPacket } from './coBuilderOperationalPacket.mjs';

const base = {
  missionId: 'root-file-glob-regression',
  operatorIntent: 'Implement a bounded source-only change.',
  intendedOutcome: 'Safe source scopes remain eligible for operator approval.',
  missionStatus: 'active',
  missionBrainNextAction: {
    missionObjective: 'Implement bounded source change',
    nextBestAction: 'Edit bounded source files',
    proofRequiredBeforeMerge: [],
  },
  missionIntelligenceSummary: {
    missionIntelligenceStatus: 'active',
    nextBestAction: 'Edit bounded source files',
  },
  agentWorkRoutingProjection: {
    requiredProof: ['focused test output'],
    requiredTests: ['node --test shared/agents/coBuilderOperationalPacket.rootFileGlob.test.mjs'],
  },
  verificationReturnIntake: {
    missingEvidence: [],
    suppliedEvidence: [{
      requirement: 'focused test output',
      source: 'node-test',
      evidenceType: 'test-output',
      verified: true,
      exitCode: 0,
    }],
  },
};

function buildWithScopes(allowedFileScopes, forbiddenFileScopes) {
  return buildCoBuilderOperationalPacket({
    ...base,
    harnessAgentProjection: {
      allowedFileScopes,
      forbiddenFileScopes,
      requiredTests: ['node --test shared/agents/coBuilderOperationalPacket.rootFileGlob.test.mjs'],
      definitionOfDone: ['focused-tests-pass'],
      browserProofRequired: false,
    },
  });
}

test('root file globs do not overlap safe nested source scopes', () => {
  const packet = buildWithScopes(['shared/**', 'tests/**'], ['*.bin']);

  assert.equal(packet.finalVerdict, 'READY_FOR_OPERATOR_APPROVAL');
  assert.deepEqual(packet.scopeOverlaps, []);
});

test('root file globs still overlap matching root files and root wildcard scopes', () => {
  const exactFile = buildWithScopes(['artifact.bin'], ['*.bin']);
  assert.equal(exactFile.finalVerdict, 'BLOCKED');
  assert.deepEqual(exactFile.scopeOverlaps, ['artifact.bin overlaps *.bin']);

  const rootWildcard = buildWithScopes(['*.bin'], ['*.bin']);
  assert.equal(rootWildcard.finalVerdict, 'BLOCKED');
  assert.deepEqual(rootWildcard.scopeOverlaps, ['*.bin overlaps *.bin']);
});

test('global wildcard scopes remain blocked by root file globs', () => {
  const packet = buildWithScopes(['**'], ['*.bin']);

  assert.equal(packet.finalVerdict, 'BLOCKED');
  assert.ok(packet.scopeOverlaps.includes('** overlaps *.bin'));
});
