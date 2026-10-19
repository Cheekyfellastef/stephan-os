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
  const coverageHeader = '| Canonical dimension | External-edge audit question | Acceptance witness |';
  const ledgerHeader = '| Canonical dimension | Existing owner candidate, or discovery gap | First original-domain evidence to request |';
  const rows = (section, expectedHeader) => {
    const tableLines = section.split('\n').map((line) => line.trim())
      .filter((line) => line.startsWith('|'));
    assert.equal(tableLines.length, FULL_SOVEREIGNTY_DIMENSIONS_V1.length + 2,
      'table must have one header, one separator and exactly 16 canonical rows');
    assert.equal(tableLines[0], expectedHeader, 'canonical column semantics must not drift');
    assert.match(tableLines[1], /^\|\s*---\s*\|\s*---\s*\|\s*---\s*\|$/,
      'three-column Markdown separator required');
    return tableLines.slice(2).map((line) => {
      assert.ok(line.startsWith('|') && line.endsWith('|'), 'complete table row required');
      const cells = line.slice(1, -1).split('|').map((cell) => cell.trim());
      assert.equal(cells.length, 3, 'one dimension and two evidence/owner cells required');
      assert.match(cells[0], /^`[a-z0-9-]+`$/, 'canonical backticked dimension required');
      return { dimension: cells[0].slice(1, -1), cells: cells.slice(1) };
    });
  };
  const expected = [...FULL_SOVEREIGNTY_DIMENSIONS_V1];
  const coverageRows = rows(coverage, coverageHeader);
  const ownerRows = rows(ledger, ledgerHeader);
  assert.throws(() => rows(coverage.replace(coverageHeader,
    '| Canonical dimension | Claimed PASS | Acceptance witness |'), coverageHeader),
    /canonical column semantics must not drift/,
    'a forged acceptance column must fail closed');
  assert.deepEqual(coverageRows.map((row) => row.dimension), expected, 'coverage table drift or duplicate');
  assert.deepEqual(ownerRows.map((row) => row.dimension), expected, 'owner ledger drift or duplicate');
  assert.throws(() => rows(coverage.replace('| `local-ai-inference-and-router` |',
    '| stray-row | audit | UNVERIFIED |\n| `local-ai-inference-and-router` |'), coverageHeader),
    /exactly 16 canonical rows/, 'unexpected table rows must fail closed');
  assert.throws(() => rows(coverage.replace('| `local-ai-inference-and-router` |',
    '| `local-ai-inference-and-router` | extra-cell |'), coverageHeader),
    /one dimension and two evidence\/owner cells/, 'extra columns must fail closed');
  for (const row of [...coverageRows, ...ownerRows]) {
    assert.equal(row.cells.length, 2, 'each dimension needs two nonempty evidence/owner cells');
    assert.ok(row.cells.every(Boolean));
  }
  // Candidate routing is not authority, but it must not silently introduce a
  // forged, duplicate, or ambiguous original-owner issue reference.
  const allowedOwnerRefs = new Set(buildFullSovereigntySeedV1().existingOwnerIssueRefs);
  const validCandidate = (candidate) => {
    if (candidate === 'UNRESOLVED') return true;
    if (!/^#\d+(?:\s*\/\s*#\d+)*$/.test(candidate)) return false;
    const refs = candidate.match(/#\d+/g) ?? [];
    return refs.length === new Set(refs).size &&
      refs.every((ref) => allowedOwnerRefs.has(ref));
  };
  for (const row of ownerRows) {
    assert.ok(validCandidate(row.cells[0]),
      'owner candidate must be a canonical existing issue or exactly UNRESOLVED');
  }
  assert.ok(ledger.includes('| #1898 |'), 'negative owner-custody fixture requires a canonical row');
  for (const forged of ['#9999', '#1898 / #9999', '#1898 / #1898',
    'UNRESOLVED #1898', '#1898: asserted custody']) {
    const altered = ledger.replace('| #1898 |', '| ' + forged + ' |');
    const alteredRows = rows(altered, ledgerHeader);
    assert.ok(alteredRows.some((row) => !validCandidate(row.cells[0])),
      'forged or ambiguous owner custody must fail closed: ' + forged);
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

test('offline external-edge acceptance requires remote idempotency or verified reconciliation', () => {
  // A durable local queue alone cannot prove exactly-once remote delivery.
  const markdown = readFileSync(new URL('../../docs/architecture/full-sovereignty-external-edge-checklist-v1.md', import.meta.url), 'utf8');
  assert.match(markdown, /remote idempotency or independently verified reconciliation prevents duplicates/);
  assert.match(markdown, /Without remote idempotency or independently verified reconciliation, report delivery as `UNVERIFIED`/);
  assert.doesNotMatch(markdown, /Without a remote idempotency contract, report delivery as `UNVERIFIED`/);
  assert.doesNotMatch(markdown, /later exactly-once guarded delivery is the acceptable behavior/);
});

test('rung-1 owner ledger cannot silently reassign a valid owner or weaken critical evidence', () => {
  // Source-only custody regression: the existing canonical roster alone is
  // insufficient because a different *valid* owner can still be a wrong owner.
  const markdown = readFileSync(new URL('../../docs/architecture/full-sovereignty-external-edge-checklist-v1.md', import.meta.url), 'utf8');
  const section = markdown.split('## Rung-1 owner-discovery ledger')[1]?.split('## First safe evidence sequence')[0];
  assert.ok(section, 'missing original-owner discovery ledger');
  const rows = section.split('\n').map((line) => line.trim())
    .filter((line) => line.startsWith('| `'));
  const expectedOwners = [
    '#1898', 'UNRESOLVED', '#2972', '#2519',
    '#1898 / #2972', '#1898', '#2972 / #2593', '#2593',
    '#2519', 'UNRESOLVED', 'UNRESOLVED', 'UNRESOLVED',
    'UNRESOLVED', '#2968 / #1898', '#2593', '#2670',
  ];
  const expectedWitnesses = new Map([
    ['independent-local-review', 'Qualified independent non-hosted reviewer and negative forgery proof'],
    ['worker-and-controller-endurance', 'Two simultaneous admitted source/test workers and terminal receipts'],
    ['graceful-external-integration-queue', 'Durable offline PENDING and guarded exactly-once delivery'],
    ['provider-and-meter-independence', 'Real alternate qualified worker after all provider meters exhaust'],
  ]);
  const validate = (source) => {
    const section = source.split('## Rung-1 owner-discovery ledger')[1]?.split('## First safe evidence sequence')[0];
    assert.ok(section, 'missing original-owner discovery ledger');
    const lines = section.split('\n').map((line) => line.trim())
      .filter((line) => line.startsWith('| `'));
    assert.equal(lines.length, FULL_SOVEREIGNTY_DIMENSIONS_V1.length,
      'all canonical owner rows must remain present');
    const parsed = lines.map((line) => {
      assert.ok(line.endsWith('|'), 'ledger rows must have complete delimiters');
      const cells = line.slice(1, -1).split('|').map((cell) => cell.trim());
      assert.equal(cells.length, 3, 'ledger row must have exactly three cells');
      return { dimension: cells[0].slice(1, -1), owner: cells[1], witness: cells[2] };
    });
    assert.deepEqual(parsed.map((row) => row.dimension), [...FULL_SOVEREIGNTY_DIMENSIONS_V1],
      'canonical owner rows must retain dimension order');
    assert.deepEqual(parsed.map((row) => row.owner), expectedOwners,
      'an owner change requires explicit original-owner source-contract review');
    for (const row of parsed) {
      if (expectedWitnesses.has(row.dimension)) {
        assert.equal(row.witness, expectedWitnesses.get(row.dimension),
          'critical original-domain evidence cannot be silently weakened');
      }
    }
  };
  assert.equal(rows.length, 16, 'source fixture must expose sixteen original owners');
  validate(markdown);
  for (const [from, to] of [
    ['| `independent-local-review` | #1898 |', '| `independent-local-review` | #2519 |'],
    ['| `worker-and-controller-endurance` | #2972 / #2593 |', '| `worker-and-controller-endurance` | #2972 |'],
    ['| `graceful-external-integration-queue` | UNRESOLVED |', '| `graceful-external-integration-queue` | #1898 |'],
  ]) {
    assert.ok(markdown.includes(from), 'missing adversarial owner fixture');
    assert.throws(() => validate(markdown.replace(from, to)),
      /owner change requires explicit original-owner source-contract review/);
  }
  const required = 'Two simultaneous admitted source/test workers and terminal receipts';
  assert.ok(markdown.includes(required), 'missing physical parallel-pickup evidence fixture');
  assert.throws(() => validate(markdown.replace(required, 'Two selected tasks with queued dispatch')),
    /critical original-domain evidence cannot be silently weakened/);
});

test('all sixteen sovereignty acceptance witnesses remain source-bound', () => {
  const markdown = readFileSync(new URL('../../docs/architecture/full-sovereignty-external-edge-checklist-v1.md', import.meta.url), 'utf8');
  const section = markdown.split('## Coverage checklist: every existing dimension')[1]
    ?.split('## Rung-1 owner-discovery ledger')[0];
  assert.ok(section, 'missing canonical coverage checklist');
  const expected = [
    'Local inference route + provider-loss + gaming transition, with zero-residency evidence',
    'Durable local read/write, restart and replay receipts',
    'Owner-scoped offline approval/admission behavior and reconnection dedupe',
    'Machine-authenticated local probe and offline-mode receipts',
    'Exact path/worker/commit/test proof in isolated custody',
    'Independently qualified local reviewer, non-self-review and adversarial artifact proof',
    'Two overlapping, independently admitted, resource-disjoint seed SELECT–CLAIM–physical PICKUP–source/test executions with separate terminal receipts, plus an unattended repeat cycle',
    'Daemon survival and bounded repair after network loss/restart',
    'Authorized private route, local fallback, terminal receipt and operator scope',
    'Restored local snapshot and verified integrity with cloud disconnected',
    'Tamper-evident local records verified by an independent consumer',
    'Controlled disconnect/reconnect replay with no lost or duplicate tasks',
    'Offline pending receipt, bounded online delivery and deduplication',
    'Provider-blackout routing with a real alternate worker execution proof',
    'Physical cold restart + signed service/worker/served-head proof',
    'Exact-head provenance, fresh external witness and negative forgery tests',
  ];
  const witnessRows = (source) => source.split('\n').filter((line) =>
    line.startsWith('| `') && line.includes(' | ')).map((line) =>
    line.split('|').map((cell) => cell.trim()).at(-2));
  const witnesses = witnessRows(section);
  assert.deepEqual(witnesses, expected, 'all original-domain acceptance witnesses must remain intact');
  for (const [i, witness] of expected.entries()) {
    const altered = section.replace(witness, 'PASS');
    assert.notDeepEqual(witnessRows(altered), expected,
      `witness ${i + 1} must not silently become a self-attested PASS`);
  }
});
