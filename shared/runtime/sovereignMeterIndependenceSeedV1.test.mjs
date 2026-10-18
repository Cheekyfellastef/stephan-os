import test from 'node:test';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

import {
  SOVEREIGN_METER_INDEPENDENCE_MISSION_ID,
  SOVEREIGN_METER_INDEPENDENCE_ISSUE,
  SOVEREIGN_METER_INDEPENDENCE_DIMENSIONS_V1,
  SOVEREIGN_METER_INDEPENDENCE_EXISTING_OWNERS_V1,
  buildSovereignMeterIndependenceSeedV1,
} from './sovereignMeterIndependenceSeedV1.mjs';
import { HIGH_LEVEL_FLYWHEEL_SEEDS_V1 } from '../project/seedGardenProjectionV1.mjs';
import { buildHighLevelFlywheelSeedHeartbeatV1 } from '../agents/starfieldVrOutcomeOwnershipSeedV1.mjs';
import { deriveFlywheelWorkspaceView } from './upliftWorkspaceProjectionV1.mjs';
import { planSeedGrowthWorkV1 } from './seedGrowthWorkV1.mjs';

const NOW = '2026-10-09T12:30:00.000Z';
const NOW_MS = Date.parse(NOW);
const registrySeed = HIGH_LEVEL_FLYWHEEL_SEEDS_V1.find((seed) => seed.seedId === SOVEREIGN_METER_INDEPENDENCE_MISSION_ID);
const feed = (records = {}) => ({
  schemaVersion: 'stephanos.shared-workspace-dashboard-feed.v1',
  state: 'ready',
  errors: [],
  records: { goalRecords: [], eventRecords: [], statusRecords: [], proofRecords: [],
    receiptRecords: [], lessonRecords: [], capabilityRecords: [], ...records },
});
const view = (payload) => deriveFlywheelWorkspaceView(payload, { nowMs: NOW_MS });
const pressure = (payload) => planSeedGrowthWorkV1(view(payload), payload, NOW_MS);
const heartbeat = () => buildHighLevelFlywheelSeedHeartbeatV1(registrySeed, { timestampUtc: '2026-10-09T12:15:00.000Z' });
const meterEvent = (rung, i) => ({
  eventId: 'meter-proof-' + i,
  kind: 'stephanos.shared_workspace.event',
  missionId: SOVEREIGN_METER_INDEPENDENCE_MISSION_ID,
  relatedIssue: SOVEREIGN_METER_INDEPENDENCE_ISSUE,
  participantId: 'flywheel',
  timestampUtc: '2026-10-09T12:20:00.000Z',
  status: 'PASS',
  proofRefs: ['proof/meter-independence-' + i],
  meterIndependenceEvidence: {
    schemaVersion: 'stephanos.meter-independence-rung-proof.v1',
    rung,
  },
});

test('meter independence is one canonical owner, not a second scheduler or authority path', () => {
  const seed = buildSovereignMeterIndependenceSeedV1();
  assert.ok(registrySeed);
  assert.equal(registrySeed.issue, '#2968');
  assert.equal(registrySeed.source, 'shared/runtime/sovereignMeterIndependenceSeedV1.mjs');
  assert.equal(seed.growthRungs.length, 8);
  assert.deepEqual(seed.existingOwnerIssueRefs, ['#1898', '#2519']);
  assert.equal(seed.authority.mergeAllowedBySeed, false);
  assert.equal(seed.authority.spendingAllowedBySeed, false);
  assert.equal(seed.growthContract.neverEvadeProviderQuotasOrPaymentBoundaries, true);
});

test('an unplanted or source-unbound seed must not release goal pressure or claim green', () => {
  const unavailable = view(feed());
  const meter = unavailable.outcomeSeeds.find((seed) => seed.missionId === SOVEREIGN_METER_INDEPENDENCE_MISSION_ID);
  assert.ok(meter);
  assert.equal(meter.declared, true);
  assert.equal(meter.planted, false);
  assert.equal(meter.sourceTruth, 'UNKNOWN');
  assert.equal(meter.currentRung, 'AWAITING_LIVE_PROOF');
  assert.equal(pressure(feed()).length, 0);

  const unbound = feed({ statusRecords: [{
    ...heartbeat(),
    seedHeartbeat: { ...heartbeat().seedHeartbeat, contractSource: 'wrong/source.mjs' },
  }] });
  assert.equal(view(unbound).sovereignMeterIndependenceSeedGrowth.planted, false);
  assert.equal(pressure(unbound).length, 0);
});

test('source-bound heartbeat enters the existing canonical seed-to-goal conveyor once', () => {
  const payload = feed({ statusRecords: [heartbeat()] });
  const meter = view(payload).sovereignMeterIndependenceSeedGrowth;
  assert.equal(meter.planted, true);
  assert.equal(meter.sourceTruth, 'CURRENT');
  assert.equal(meter.proofCount, 0);
  assert.equal(meter.nextGrowthRung, 'INVENTORY_METERS');
  const planned = pressure(payload);
  assert.equal(planned.length, 1);
  assert.equal(planned[0].ownerIssueRef, '#2968');
  assert.equal(planned[0].seedId, SOVEREIGN_METER_INDEPENDENCE_MISSION_ID);
  assert.equal(planned[0].pressureKey, 'seed-2968:rung:inventory_meters');
  assert.deepEqual(pressure(payload).map((item) => item.pressureKey), [planned[0].pressureKey]);

  payload.records.eventRecords = [meterEvent('INVENTORY_METERS', 1)];
  assert.equal(pressure(payload)[0].pressureKey, 'seed-2968:rung:map_existing_sovereign_routes');
  assert.equal(view(payload).sovereignMeterIndependenceSeedGrowth.rungProofCount, 1);
});

test('missing or merely asserted proof never advances; full typed proof stops repair pressure', () => {
  const seed = buildSovereignMeterIndependenceSeedV1();
  const payload = feed({ statusRecords: [heartbeat()] });
  payload.records.eventRecords = [{ ...meterEvent(seed.growthRungs[0], 1), proofRefs: [] }];
  assert.equal(view(payload).sovereignMeterIndependenceSeedGrowth.rungProofCount, 0);
  assert.equal(pressure(payload)[0].pressureKey, 'seed-2968:rung:inventory_meters');
  payload.records.eventRecords = seed.growthRungs.map(meterEvent);
  const meter = view(payload).sovereignMeterIndependenceSeedGrowth;
  assert.equal(meter.rungProofCount, 8);
  assert.equal(meter.nextGrowthRung, '');
  assert.equal(meter.pressureState, 'CURRENT');
  assert.equal(pressure(payload).length, 0);
});

const readMeterBlackoutInventory = () => readFileSync(
  new URL('../../docs/architecture/sovereign-meter-blackout-acceptance-v1.md', import.meta.url), 'utf8');

const parseMeterBlackoutDimensions = (markdown) => {
  const section = markdown.split('## Twelve canonical dimensions')[1]?.split('## Verdict and original-owner routing')[0];
  assert.ok(section, 'missing bounded meter-specific inventory');
  const rows = section.split('\n').map((line) => line.trim()).filter((line) => line.startsWith('|'));
  assert.equal(rows.length, SOVEREIGN_METER_INDEPENDENCE_DIMENSIONS_V1.length + 2,
    'the bounded inventory must have one header, one separator and exactly twelve data rows');
  assert.equal(rows[0], '| Dimension | Existing owner candidate / first evidence required | Initial verdict |');
  assert.equal(rows[1], '| --- | --- | --- |');
  return rows.slice(2).map((line) => {
    assert.ok(line.startsWith('|') && line.endsWith('|'), 'each row must be a complete Markdown table row');
    const cells = line.slice(1, -1).split('|').map((value) => value.trim());
    assert.equal(cells.length, 3, 'dimension, original owner candidate and verdict are required');
    assert.match(cells[0], /^`[a-z0-9-]+`$/, 'dimension must be a single exact backticked identifier');
    // A '#' in prose is not owner custody. The acceptance packet must
    // reference only the seed's canonical existing implementation owners.
    const ownerRefs = cells[1].match(/#[A-Za-z0-9_-]+/g) ?? [];
    const unresolved = cells[1].startsWith('UNRESOLVED:');
    assert.ok(unresolved !== (ownerRefs.length > 0),
      'exactly one of canonical owner refs or unresolved custody is required');
    assert.ok(!cells[1].includes('UNRESOLVED') || unresolved,
      'unresolved custody must be explicit, not buried in an owner claim');
    for (const ownerRef of ownerRefs) {
      assert.ok(SOVEREIGN_METER_INDEPENDENCE_EXISTING_OWNERS_V1.includes(ownerRef),
        'owner reference must belong to the original seed owner roster');
    }
    if (unresolved) {
      assert.match(cells[1], /^UNRESOLVED:\s*\S/,
        'unresolved custody must name the missing evidence, not merely a label');
    } else {
      const separator = cells[1].indexOf(':');
      assert.ok(separator > 0 && cells[1].slice(separator + 1).trim(),
        'owner custody must have a canonical owner prefix and a nonempty witness');
      const ownerPrefix = cells[1].slice(0, separator);
      assert.match(ownerPrefix, /^#(?:1898|2519)(?:\s*\/\s*#(?:1898|2519))*$/,
        'owner identity must be an exact canonical issue prefix, not embedded prose');
      assert.deepEqual(ownerRefs, ownerPrefix.match(/#\d+/g) ?? [],
        'owner witness must not introduce an additional hidden owner claim');
      assert.equal(new Set(ownerRefs).size, ownerRefs.length,
        'owner custody must not repeat an existing implementation owner');
    }
    assert.equal(cells[2], 'UNVERIFIED', 'a source checklist cannot certify a live blackout');
    return cells[0].slice(1, -1);
  });
};

test('meter-blackout acceptance inventory remains aligned to canonical 12 dimensions', () => {
  // Source-only acceptance check, never a live blackout or worker pickup.
  const markdown = readMeterBlackoutInventory();
  assert.deepEqual(parseMeterBlackoutDimensions(markdown), [...SOVEREIGN_METER_INDEPENDENCE_DIMENSIONS_V1],
    'each canonical meter dimension must appear once and in source order');
  assert.match(markdown, /same original task ID and worker identity/);
  assert.match(markdown, /Gaming or Quest has absolute priority/);
  assert.match(markdown, /never from publication of this checklist/);
});

test('meter-blackout inventory rejects malformed or forged evidence rows', () => {
  const markdown = readMeterBlackoutInventory();
  assert.throws(() => parseMeterBlackoutDimensions(
    markdown.replace('| `codex-work-continuity` |', '| codex-work-continuity |')));
  assert.throws(() => parseMeterBlackoutDimensions(
    markdown.replace('| `codex-work-continuity` |', '| `codex-work-continuity` | #1898 |')));
  assert.throws(() => parseMeterBlackoutDimensions(
    markdown.replace(' | UNVERIFIED |', ' | PASS |')));
  assert.throws(() => parseMeterBlackoutDimensions(
    markdown.replace('| `codex-work-continuity` |', '| stray-row | #1898 | UNVERIFIED |\n| `codex-work-continuity` |')));
});

test('meter-blackout inventory rejects forged or ambiguous owner custody', () => {
  const markdown = readMeterBlackoutInventory();
  const original = '#1898: same bounded task built without Codex, with exact worker/source/test receipt';
  assert.ok(markdown.includes(original), 'owner spoof regression needs original row');
  for (const invalid of [
    '#9999: same bounded task',
    '#1898bogus: same bounded task',
    '#not-an-owner: same bounded task',
    'UNRESOLVED: #1898 same bounded task',
    'owner not identified: same bounded task',
    'prefix#1898: same bounded task',
    '#1898 #2519: same bounded task',
    '#1898 / #1898: same bounded task',
    '#1898 / #2519 / #1898: same bounded task',
    '#1898: same bounded task #2519',
    'UNRESOLVED:',
  ]) {
    assert.throws(() => parseMeterBlackoutDimensions(markdown.replace(original, invalid)),
      'forged or ambiguous owner custody must fail closed: ' + invalid);
  }
});

test('stale heartbeat cannot manufacture a live canonical seed goal', () => {
  const payload = feed({ statusRecords: [buildHighLevelFlywheelSeedHeartbeatV1(registrySeed, {
    timestampUtc: '2026-10-09T10:00:00.000Z',
  })] });
  assert.equal(pressure(payload).length, 0);
});
