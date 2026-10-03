import { readFile } from 'node:fs/promises';

import {
  STARFIELD_VR_OUTCOME_OWNERSHIP_EVENT_ID,
  STARFIELD_VR_OUTCOME_OWNERSHIP_MISSION_ID,
  STARFIELD_VR_OUTCOME_OWNERSHIP_SEED_SCHEMA_V1,
  buildStarfieldVrOutcomeOwnershipContractV1,
} from '../runtime/starfieldVrOutcomeOwnershipContractV1.mjs';

import {
  createSharedWorkspaceEventRecord,
  createSharedWorkspaceGoalRecord,
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
    ...createSharedWorkspaceGoalRecord({
      goalId: STARFIELD_VR_OUTCOME_OWNERSHIP_MISSION_ID,
      participantId: 'flywheel',
      timestampUtc,
      title: 'Starfield VR: best achievable Battle Bridge experience',
      status: 'bootstrap-active',
    }),
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

  const goal = buildStarfieldVrOutcomeOwnershipSeedV1({ timestampUtc });
  const goalWrite = await writeAtomicJson(
    layout.root,
    ['goals', `${STARFIELD_VR_OUTCOME_OWNERSHIP_MISSION_ID}.json`],
    goal,
    { repoRoot, nowMs },
  );

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

  const ok = goalWrite.ok === true && eventWrite.ok === true;
  return freeze({
    schemaVersion: STARFIELD_VR_OUTCOME_OWNERSHIP_SEED_SCHEMA_V1,
    ok,
    reason: ok
      ? 'STARFIELD_VR_OUTCOME_OWNERSHIP_SEED_PUBLISHED'
      : 'STARFIELD_VR_OUTCOME_OWNERSHIP_SEED_DEGRADED',
    missionId: STARFIELD_VR_OUTCOME_OWNERSHIP_MISSION_ID,
    growthStage: 'SEEDED',
    goalWrite,
    eventWrite,
    authorityWidened: false,
    createsReplacementMachinery: false,
    finalVerdict: ok
      ? 'STARFIELD_VR_OUTCOME_OWNERSHIP_SEED_READY'
      : 'STARFIELD_VR_OUTCOME_OWNERSHIP_SEED_DEGRADED',
  });
}
