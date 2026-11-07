import { readFile, rm } from 'node:fs/promises';

import {
  STARFIELD_VR_OUTCOME_OWNERSHIP_EVENT_ID,
  STARFIELD_VR_OUTCOME_OWNERSHIP_MISSION_ID,
  STARFIELD_VR_OUTCOME_OWNERSHIP_SEED_SCHEMA_V1,
  buildStarfieldVrOutcomeOwnershipContractV1,
} from '../runtime/starfieldVrOutcomeOwnershipContractV1.mjs';
import { HIGH_LEVEL_FLYWHEEL_SEEDS_V1 } from '../project/seedGardenProjectionV1.mjs';

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

export const HIGH_LEVEL_FLYWHEEL_SEED_HEARTBEAT_SCHEMA_V1 =
  'stephanos.high-level-flywheel-seed-heartbeat.v1';

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

export function buildHighLevelFlywheelSeedHeartbeatV1(seed = {}, input = {}) {
  const timestampUtc = text(input.timestampUtc, new Date().toISOString());
  const missionId = text(seed.seedId);
  if (!missionId) throw new TypeError('seed.seedId is required');
  const issueRef = text(seed.issue);
  const title = text(seed.title, missionId);

  return freeze({
    ...createSharedWorkspaceStatusRecord({
      statusId: missionId,
      participantId: 'flywheel',
      timestampUtc,
      relatedIssue: issueRef,
      status: 'SEED_ACTIVE',
      summary: `${title} persistent seed heartbeat is active.`,
      proofRefs: [],
    }),
    missionId,
    issueRef,
    title,
    seedKind: text(seed.seedKind, 'persistent-outcome-seed'),
    persistent: true,
    seedContractSource: text(seed.source),
    seedHeartbeat: {
      schemaVersion: HIGH_LEVEL_FLYWHEEL_SEED_HEARTBEAT_SCHEMA_V1,
      missionId,
      issueRef,
      title,
      seedKind: text(seed.seedKind, 'persistent-outcome-seed'),
      contractSource: text(seed.source),
      refreshedAtUtc: timestampUtc,
      authorityWidened: false,
      createsReplacementMachinery: false,
    },
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

async function publishCompanionSeedHeartbeats(layout, {
  repoRoot,
  timestampUtc,
  nowMs,
} = {}) {
  const companionSeeds = HIGH_LEVEL_FLYWHEEL_SEEDS_V1.filter(
    (seed) => seed.seedId !== STARFIELD_VR_OUTCOME_OWNERSHIP_MISSION_ID,
  );
  const writes = [];
  for (const seed of companionSeeds) {
    const record = buildHighLevelFlywheelSeedHeartbeatV1(seed, { timestampUtc });
    const write = await writeAtomicJson(
      layout.root,
      ['status', `${seed.seedId}.json`],
      record,
      { repoRoot, nowMs },
    );
    writes.push(freeze({
      seedId: seed.seedId,
      issueRef: seed.issue,
      title: seed.title,
      contractSource: seed.source,
      ok: write.ok === true,
      reason: write.reason,
      write,
    }));
  }
  return freeze(writes);
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

  const companionSeedHeartbeatWrites = await publishCompanionSeedHeartbeats(layout, {
    repoRoot,
    timestampUtc,
    nowMs,
  });
  const seedHeartbeatWrites = freeze([
    freeze({
      seedId: STARFIELD_VR_OUTCOME_OWNERSHIP_MISSION_ID,
      issueRef: HIGH_LEVEL_FLYWHEEL_SEEDS_V1.find(
        (seed) => seed.seedId === STARFIELD_VR_OUTCOME_OWNERSHIP_MISSION_ID,
      )?.issue || '',
      title: HIGH_LEVEL_FLYWHEEL_SEEDS_V1.find(
        (seed) => seed.seedId === STARFIELD_VR_OUTCOME_OWNERSHIP_MISSION_ID,
      )?.title || 'Starfield VR Excellence',
      contractSource: 'shared/runtime/starfieldVrOutcomeOwnershipContractV1.mjs',
      ok: statusWrite.ok === true,
      reason: statusWrite.reason,
      write: statusWrite,
    }),
    ...companionSeedHeartbeatWrites,
  ]);

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

  const seedHeartbeatsOk = seedHeartbeatWrites.every((entry) => entry.ok === true);
  const ok = seedHeartbeatsOk
    && eventWrite.ok === true
    && legacyGoalRetirement.ok === true;
  return freeze({
    schemaVersion: STARFIELD_VR_OUTCOME_OWNERSHIP_SEED_SCHEMA_V1,
    ok,
    reason: ok
      ? 'STARFIELD_VR_OUTCOME_OWNERSHIP_SEED_PUBLISHED'
      : 'STARFIELD_VR_OUTCOME_OWNERSHIP_SEED_DEGRADED',
    missionId: STARFIELD_VR_OUTCOME_OWNERSHIP_MISSION_ID,
    growthStage: 'SEEDED',
    statusWrite,
    seedHeartbeatWrites,
    publishedHighLevelSeedCount: seedHeartbeatWrites.filter((entry) => entry.ok === true).length,
    expectedHighLevelSeedCount: HIGH_LEVEL_FLYWHEEL_SEEDS_V1.length,
    eventWrite,
    legacyGoalRetirement,
    authorityWidened: false,
    createsReplacementMachinery: false,
    finalVerdict: ok
      ? 'STARFIELD_VR_OUTCOME_OWNERSHIP_SEED_READY'
      : 'STARFIELD_VR_OUTCOME_OWNERSHIP_SEED_DEGRADED',
  });
}
