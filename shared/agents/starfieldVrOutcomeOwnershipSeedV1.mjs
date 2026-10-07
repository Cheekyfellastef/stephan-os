import { readFile, rm } from 'node:fs/promises';

import {
  STARFIELD_VR_OUTCOME_OWNERSHIP_EVENT_ID,
  STARFIELD_VR_OUTCOME_OWNERSHIP_MISSION_ID,
  STARFIELD_VR_OUTCOME_OWNERSHIP_SEED_SCHEMA_V1,
  buildStarfieldVrOutcomeOwnershipContractV1,
} from '../runtime/starfieldVrOutcomeOwnershipContractV1.mjs';

import {
  createSharedWorkspaceEventRecord,
  createSharedWorkspaceStatusRecord,
  ensureSharedWorkspaceLayout,
  resolveSharedWorkspacePath,
  writeAtomicJson,
} from './sharedAgentWorkspaceStore.mjs';

export {
  STARFIELD_VR_OUTCOME_OWNERSHIP_EVENT_ID,
  STARFIELD_VR_OUTCOME_OWNERSHIP_MISSION_ID,
  STARFIELD_VR_OUTCOME_OWNERSHIP_SEED_SCHEMA_V1,
};

function text(value, fallback = '') {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
}

function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  if (Array.isArray(value)) return Object.freeze(value.map(freeze));
  for (const key of Object.keys(value)) value[key] = freeze(value[key]);
  return Object.freeze(value);
}

export function buildStarfieldVrOutcomeOwnershipSeedV1(input = {}) {
  const timestampUtc = text(input.timestampUtc, new Date().toISOString());
  return freeze({
    ...createSharedWorkspaceStatusRecord({
      statusId: STARFIELD_VR_OUTCOME_OWNERSHIP_MISSION_ID,
      participantId: 'flywheel',
      timestampUtc,
      status: 'BOOTSTRAP_ACTIVE',
      summary: 'Starfield VR persistent outcome-ownership seed is active.',
      proofRefs: [],
    }),
    missionId: STARFIELD_VR_OUTCOME_OWNERSHIP_MISSION_ID,
    title: 'Starfield VR: best achievable Battle Bridge experience',
    outcomeOwnershipSeed: buildStarfieldVrOutcomeOwnershipContractV1({ refreshedAtUtc: timestampUtc }),
  });
}

export function buildStarfieldVrOutcomeOwnershipPlantingEventV1(input = {}) {
  const timestampUtc = text(input.timestampUtc, new Date().toISOString());
  return freeze({
    ...createSharedWorkspaceEventRecord({
      eventId: STARFIELD_VR_OUTCOME_OWNERSHIP_EVENT_ID,
      participantId: 'flywheel',
      timestampUtc,
      eventKind: 'outcome-ownership-seed',
      summary: 'Starfield VR Outcome Ownership seed planted into the existing Flywheel and Shared Workspace learning fabric.',
    }),
    outcomeOwnershipSeed: {
      schemaVersion: STARFIELD_VR_OUTCOME_OWNERSHIP_SEED_SCHEMA_V1,
      missionId: STARFIELD_VR_OUTCOME_OWNERSHIP_MISSION_ID,
      growthStage: 'SEEDED',
      nextBestAction: 'Observe current Starfield VR evidence, discover missing outcome-ownership capabilities, and teach those gaps through the closed learning loop.',
      authorityWidened: false,
      createsReplacementMachinery: false,
    },
  });
}

async function matchingRecordExists(root, repoRoot, directory, fileName, predicate) {
  const resolved = resolveSharedWorkspacePath({
    root,
    repoRoot,
    segments: [directory, fileName],
  });
  if (!resolved.ok) return false;
  try {
    const record = JSON.parse(await readFile(resolved.path, 'utf8'));
    return predicate(record);
  } catch {
    return false;
  }
}

export async function publishStarfieldVrOutcomeOwnershipSeedV1(input = {}) {
  const repoRoot = input.repoRoot || process.cwd();
  const timestampUtc = text(input.timestampUtc, new Date().toISOString());
  const nowMs = Number.isFinite(input.nowMs) ? input.nowMs : Date.parse(timestampUtc);
  const layout = await ensureSharedWorkspaceLayout({
    root: input.root,
    repoRoot,
  });
  if (!layout.ok) {
    return freeze({
      schemaVersion: STARFIELD_VR_OUTCOME_OWNERSHIP_SEED_SCHEMA_V1,
      ok: false,
      reason: layout.reason,
      missionId: STARFIELD_VR_OUTCOME_OWNERSHIP_MISSION_ID,
      finalVerdict: 'STARFIELD_VR_OUTCOME_OWNERSHIP_SEED_BLOCKED',
    });
  }

  const seedStatus = buildStarfieldVrOutcomeOwnershipSeedV1({ timestampUtc });
  const statusWrite = await writeAtomicJson(
    layout.root,
    ['status', `${STARFIELD_VR_OUTCOME_OWNERSHIP_MISSION_ID}.json`],
    seedStatus,
    { repoRoot, nowMs },
  );

  let legacyGoalRetirement = {
    ok: true,
    reason: 'STARFIELD_VR_OUTCOME_OWNERSHIP_LEGACY_GOAL_ALREADY_ABSENT',
  };
  if (statusWrite.ok === true) {
    const legacyGoal = resolveSharedWorkspacePath({
      root: layout.root,
      repoRoot,
      segments: ['goals', `${STARFIELD_VR_OUTCOME_OWNERSHIP_MISSION_ID}.json`],
    });
    if (!legacyGoal.ok) {
      legacyGoalRetirement = {
        ok: false,
        reason: legacyGoal.reason || 'STARFIELD_VR_OUTCOME_OWNERSHIP_LEGACY_GOAL_PATH_INVALID',
      };
    } else {
      try {
        await rm(legacyGoal.path, { force: true });
        legacyGoalRetirement = {
          ok: true,
          reason: 'STARFIELD_VR_OUTCOME_OWNERSHIP_LEGACY_GOAL_RETIRED_OR_ABSENT',
        };
      } catch {
        legacyGoalRetirement = {
          ok: false,
          reason: 'STARFIELD_VR_OUTCOME_OWNERSHIP_LEGACY_GOAL_RETIRE_FAILED',
        };
      }
    }
  }

  const eventFile = `${STARFIELD_VR_OUTCOME_OWNERSHIP_EVENT_ID}.json`;
  const eventExists = await matchingRecordExists(
    layout.root,
    repoRoot,
    'events',
    eventFile,
    (record) => record?.eventId === STARFIELD_VR_OUTCOME_OWNERSHIP_EVENT_ID
      && record?.outcomeOwnershipSeed?.schemaVersion === STARFIELD_VR_OUTCOME_OWNERSHIP_SEED_SCHEMA_V1,
  );
  let eventWrite = {
    ok: true,
    reason: 'STARFIELD_VR_OUTCOME_OWNERSHIP_PLANTING_EVENT_ALREADY_PRESENT',
  };
  if (!eventExists) {
    eventWrite = await writeAtomicJson(
      layout.root,
      ['events', eventFile],
      buildStarfieldVrOutcomeOwnershipPlantingEventV1({ timestampUtc }),
      { repoRoot, nowMs },
    );
  }

  const ok = statusWrite.ok === true && eventWrite.ok === true && legacyGoalRetirement.ok === true;
  return freeze({
    schemaVersion: STARFIELD_VR_OUTCOME_OWNERSHIP_SEED_SCHEMA_V1,
    ok,
    reason: ok
      ? 'STARFIELD_VR_OUTCOME_OWNERSHIP_SEED_PUBLISHED'
      : 'STARFIELD_VR_OUTCOME_OWNERSHIP_SEED_DEGRADED',
    missionId: STARFIELD_VR_OUTCOME_OWNERSHIP_MISSION_ID,
    growthStage: 'SEEDED',
    statusWrite,
    eventWrite,
    legacyGoalRetirement,
    authorityWidened: false,
    createsReplacementMachinery: false,
    finalVerdict: ok
      ? 'STARFIELD_VR_OUTCOME_OWNERSHIP_SEED_READY'
      : 'STARFIELD_VR_OUTCOME_OWNERSHIP_SEED_DEGRADED',
  });
}
