import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FULL_SOVEREIGNTY_DIMENSIONS_V1,
  FULL_SOVEREIGNTY_ISSUE,
  FULL_SOVEREIGNTY_MISSION_ID,
  buildFullSovereigntySeedV1,
} from './fullSovereigntySeedV1.mjs';
import { HIGH_LEVEL_FLYWHEEL_SEEDS_V1 } from '../project/seedGardenProjectionV1.mjs';
import { buildHighLevelFlywheelSeedHeartbeatV1 } from '../agents/starfieldVrOutcomeOwnershipSeedV1.mjs';
import { deriveFlywheelWorkspaceView } from './upliftWorkspaceProjectionV1.mjs';
import { planSeedGrowthWorkV1 } from './seedGrowthWorkV1.mjs';

const NOW = '2026-10-11T17:30:00.000Z';
const NOW_MS = Date.parse(NOW);
const registrySeed = HIGH_LEVEL_FLYWHEEL_SEEDS_V1.find((seed) => seed.seedId === FULL_SOVEREIGNTY_MISSION_ID);
const feed = (records = {}) => ({
  schemaVersion: 'stephanos.shared-workspace-dashboard-feed.v1',
  state: 'ready',
  errors: [],
  records: { goalRecords: [], eventRecords: [], statusRecords: [], proofRecords: [],
    receiptRecords: [], lessonRecords: [], capabilityRecords: [], ...records },
});
const view = (payload) => deriveFlywheelWorkspaceView(payload, { nowMs: NOW_MS });
const pressure = (payload) => planSeedGrowthWorkV1(view(payload), payload, NOW_MS);
const heartbeat = () => buildHighLevelFlywheelSeedHeartbeatV1(registrySeed, { timestampUtc: '2026-10-11T17:15:00.000Z' });
const rungEvent = (rung, i) => ({
  eventId: 'full-sovereignty-proof-' + i,
  kind: 'stephanos.shared_workspace.event',
  missionId: FULL_SOVEREIGNTY_MISSION_ID,
  relatedIssue: FULL_SOVEREIGNTY_ISSUE,
  participantId: 'flywheel',
  timestampUtc: '2026-10-11T17:20:00.000Z',
  status: 'PASS',
  proofRefs: ['proof/full-sovereignty-' + i],
  fullSovereigntyEvidence: {
    schemaVersion: 'stephanos.full-sovereignty-rung-proof.v1',
    rung,
  },
});

test('new permanent full-sovereignty seed has one canonical registry owner and safe authority', () => {
  const seed = buildFullSovereigntySeedV1();
  assert.ok(registrySeed);
  assert.equal(registrySeed.issue, '#3026');
  assert.equal(registrySeed.source, 'shared/runtime/fullSovereigntySeedV1.mjs');
  assert.equal(seed.growthRungs.length, 8);
  assert.ok(seed.existingOwnerIssueRefs.includes('#2968'));
  assert.ok(seed.existingOwnerIssueRefs.includes('#2670'));
  assert.ok(seed.qualityDimensions.includes('local-ai-inference-and-router'));
  assert.ok(seed.qualityDimensions.includes('network-disconnect-tolerance'));
  assert.equal(seed.authority.mergeAllowedBySeed, false);
  assert.equal(seed.authority.spendingAllowedBySeed, false);
  assert.equal(seed.growthContract.noProviderQuotaOrPaymentBoundaryEvasion, true);
});

test('contract is visible in canopy projection, without inventing live proof or work', () => {
  const unavailable = view(feed());
  const seed = unavailable.outcomeSeeds.find((item) => item.missionId === FULL_SOVEREIGNTY_MISSION_ID);
  assert.ok(seed);
  assert.equal(seed.declared, true);
  assert.equal(seed.planted, false);
  assert.equal(seed.sourceTruth, 'UNKNOWN');
  assert.equal(seed.currentRung, 'AWAITING_LIVE_PROOF');
  assert.deepEqual(pressure(feed()), []);
  const unbound = feed({ statusRecords: [{
    ...heartbeat(),
    seedHeartbeat: { ...heartbeat().seedHeartbeat, contractSource: 'wrong/source.mjs' },
  }] });
  assert.equal(view(unbound).fullSovereigntySeedGrowth.planted, false);
  assert.deepEqual(pressure(unbound), []);
});

test('fresh source-bound seed heartbeat projects once and releases one deduped growth pressure', () => {
  const payload = feed({ statusRecords: [heartbeat()] });
  const full = view(payload).fullSovereigntySeedGrowth;
  assert.equal(full.planted, true);
  assert.equal(full.sourceTruth, 'CURRENT');
  assert.equal(full.proofCount, 0);
  assert.equal(full.nextGrowthRung, 'INVENTORY_ALL_FUNCTIONS_AND_EXTERNAL_EDGES');
  const planned = pressure(payload);
  assert.equal(planned.length, 1);
  assert.equal(planned[0].ownerIssueRef, '#3026');
  assert.equal(planned[0].seedId, FULL_SOVEREIGNTY_MISSION_ID);
  assert.equal(planned[0].pressureKey, 'seed-3026:rung:inventory_all_functions_and_external_edges');
  assert.deepEqual(pressure(payload).map((work) => work.pressureKey), [planned[0].pressureKey]);
  payload.records.eventRecords = [rungEvent(full.nextGrowthRung, 1)];
  assert.equal(view(payload).fullSovereigntySeedGrowth.rungProofCount, 1);
  assert.equal(pressure(payload)[0].pressureKey, 'seed-3026:rung:map_local_sovereign_capabilities');
});

test('mere prose, missing proof or wrong mission cannot advance the seed', () => {
  const seed = buildFullSovereigntySeedV1();
  const payload = feed({ statusRecords: [heartbeat()] });
  payload.records.eventRecords = [{ ...rungEvent(seed.growthRungs[0], 1), proofRefs: [] }];
  assert.equal(view(payload).fullSovereigntySeedGrowth.rungProofCount, 0);
  payload.records.eventRecords = [{ ...rungEvent(seed.growthRungs[0], 1), missionId: 'other-mission' }];
  assert.equal(view(payload).fullSovereigntySeedGrowth.rungProofCount, 0);
  payload.records.eventRecords = seed.growthRungs.map(rungEvent);
  assert.equal(view(payload).fullSovereigntySeedGrowth.rungProofCount, 8);
  assert.equal(view(payload).fullSovereigntySeedGrowth.nextGrowthRung, '');
  assert.deepEqual(pressure(payload), []);
});

test('stale source heartbeat cannot release build work', () => {
  const stale = feed({ statusRecords: [buildHighLevelFlywheelSeedHeartbeatV1(registrySeed, {
    timestampUtc: '2026-10-11T15:00:00.000Z',
  })] });
  assert.deepEqual(pressure(stale), []);
});

test('rung-1 sovereignty acceptance tables stay bound to the 16 canonical dimensions', () => {
  // This checks SOURCE CONTRACT CONSISTENCY, never physical seed pickup or a PASS verdict.
  const markdown = readFileSync(new URL('../../docs/architecture/full-sovereignty-external-edge-checklist-v1.md', import.meta.url), 'utf8');
  const coverage = markdown.split('## Coverage checklist: every existing dimension')[1]?.split('## Rung-1 owner-discovery ledger')[0];
  const ledger = markdown.split('## Rung-1 owner-discovery ledger')[1]?.split('## First safe evidence sequence')[0];
  assert.ok(coverage, 'missing acceptance coverage table');
  assert.ok(ledger, 'missing original-owner discovery table');
  const rows = (section) => section.split('\n')
    .filter((line) => line.startsWith('| `'))
    .map((line) => {
      const cells = line.split('|').map((cell) => cell.trim()).filter(Boolean);
      return { dimension: cells[0].replaceAll('`', ''), cells: cells.slice(1) };
    });
  const expected = [...FULL_SOVEREIGNTY_DIMENSIONS_V1];
  const coverageRows = rows(coverage);
  const ownerRows = rows(ledger);
  assert.deepEqual(coverageRows.map((row) => row.dimension), expected, 'coverage table drift or duplicate');
  assert.deepEqual(ownerRows.map((row) => row.dimension), expected, 'owner ledger drift or duplicate');
  for (const row of [...coverageRows, ...ownerRows]) {
    assert.equal(row.cells.length, 2, 'each dimension needs two nonempty evidence/owner cells');
    assert.ok(row.cells.every(Boolean));
  }
  for (const row of ownerRows) {
    assert.ok(row.cells[0].includes('UNRESOLVED') || row.cells[0].includes('#'), 'owner must be an existing issue or explicitly unresolved');
  }
  assert.ok(markdown.includes('Every row remains `UNVERIFIED`'));
  assert.match(markdown, /not evidence that external dependence has been removed/);
});

test('sovereignty owner references retain exact canonical titles at first mention', () => {
  // Source-only regression for the independent owner-title review finding.
  // These reviewed issue-title snapshots are not authority or custody assignments.
  const markdown = readFileSync(new URL('../../docs/architecture/full-sovereignty-external-edge-checklist-v1.md', import.meta.url), 'utf8');
  const titles = new Map([
    ['3026', 'Seed: Stephanos Full Sovereignty for Every Function, Zero External Critical Dependencies'],
    ['2968', 'Seed: Stephanos Sovereign Meter Independence across all metered services'],
    ['1898', 'Programme: Zero-Codex Continuity and Provider Parity V1'],
    ['2519', 'Build Sovereign Commander as the unmetered Battle Bridge control surface'],
    ['2670', 'Mission: Stephanos Whole-System Capability Closure'],
    ['2972', 'Seed: Continuous Goal Conveyor & Fleet Care'],
    ['2593', 'Goal: Stephanos Core Daemon and meter-free Sovereign inspection'],
    ['2962', 'Goal: Repair Native Capacity Publisher generated-dist source gate mismatch'],
  ]);
  const exactLink = (issue, title) =>
    `[#${issue} — ${title}](https://github.com/Cheekyfellastef/stephan-os/issues/${issue})`;
  const firstMentionIsTitleBound = (document, issue, title) => {
    const first = document.indexOf(`#${issue}`);
    return first >= 0 && document.indexOf(exactLink(issue, title)) === first - 1;
  };
  assert.deepEqual([...buildFullSovereigntySeedV1().existingOwnerIssueRefs].sort(),
    [...titles.keys()].filter((issue) => issue !== '3026' && issue !== '2962').map((issue) => `#${issue}`).sort(),
    'owner-title snapshot must track the canonical owner roster');
  for (const [issue, title] of titles) {
    assert.equal(firstMentionIsTitleBound(markdown, issue, title), true,
      `#${issue} must first appear with its exact canonical title and issue URL`);
    const stripped = markdown.replace(exactLink(issue, title), `#${issue}`);
    const renamed = markdown.replace(exactLink(issue, title),
      exactLink(issue, 'Incorrect owner title'));
    assert.equal(firstMentionIsTitleBound(stripped, issue, title), false);
    assert.equal(firstMentionIsTitleBound(renamed, issue, title), false);
  }
});
