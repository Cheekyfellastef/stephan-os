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
  // A source-only inventory must not acquire a second or promoted status label
  // while the twelve evidence rows remain UNVERIFIED.
  const statusDeclarations = markdown.match(/\*\*Status:[^*\n]*\*\*/g) ?? [];
  assert.deepEqual(statusDeclarations, ['**Status: SOURCE-ONLY / UNVERIFIED.**'],
    'meter blackout cannot silently promote or duplicate source-only status');
  assert.equal(markdown.split('## Twelve canonical dimensions').length, 2,
    'the acceptance inventory must contain exactly one canonical dimensions section');
  assert.equal(markdown.split('## Verdict and original-owner routing').length, 2,
    'the acceptance inventory must contain exactly one verdict section');
  const dimensionsPosition = markdown.indexOf('## Twelve canonical dimensions');
  const verdictPosition = markdown.indexOf('## Verdict and original-owner routing');
  assert.ok(dimensionsPosition < verdictPosition,
    'canonical inventory must precede the verdict contract');
  const verdictSection = markdown.slice(verdictPosition);
  assert.ok(verdictSection.includes(
    '`PASS` requires a qualified repeatable operation with the metered edge both present and absent, stable original identity, correct terminal outcome, independently reviewed evidence and no unauthorized resource use.'),
  'the verdict contract must retain independent proof and real metered-edge blackout');
  const section = markdown.split('## Twelve canonical dimensions')[1]?.split('## Verdict and original-owner routing')[0];
  assert.ok(section, 'missing bounded meter-specific inventory');
  const rows = section.split('\n').map((line) => line.trim()).filter((line) => line.startsWith('|'));
  // A second table outside the bounded section could otherwise display forged
  // PASS verdicts while this parser silently validates only the original rows.
  const allRows = markdown.split('\n').map((line) => line.trim()).filter((line) => line.startsWith('|'));
  assert.deepEqual(allRows, rows, 'meter evidence table rows must appear only inside the canonical inventory');
  assert.equal(rows.length, SOVEREIGN_METER_INDEPENDENCE_DIMENSIONS_V1.length + 2,
    'the bounded inventory must have one header, one separator and exactly twelve data rows');
  assert.equal(rows[0], '| Dimension | Existing owner candidate / first evidence required | Initial verdict |');
  assert.equal(rows[1], '| --- | --- | --- |');
  // Candidate custody is a reviewed source contract, not a free-form label.
  // A plausible but different canonical owner must not silently inherit work.
  const expectedCustody = [
    '#1898', '#2519', '#2519', '#1898', 'UNRESOLVED', '#1898',
    '#1898 / #2519', '#1898', 'UNRESOLVED', '#1898', 'UNRESOLVED',
    '#1898 / #2519',
  ];
  // Lock the first-evidence requirement, not just owner and verdict.
  // Weakening an original-owner witness needs an explicit source/test review.
  const expectedFirstEvidence = [
    "#1898: same bounded task built without Codex, with exact worker/source/test receipt",
    "#2519: same authorized observation through qualified Sovereign Commander, no paid remote tool",
    "#2519: operator-controlled ingress plus authenticated offline/degraded receipt",
    "#1898: qualified alternative model and explicit gaming zero-residency witness",
    "UNRESOLVED: bounded backoff, local continuity, eventual GitHub reconciliation without quota evasion",
    "#1898: same-worker SELECT→CLAIM→physical PICKUP and actual source/test output during provider blackout",
    "#1898 / #2519: allowlisted action, exact original-owner scope and independent terminal proof",
    "#1898: non-self-review against exact source/base identity with provider offline",
    "UNRESOLVED: independently signed task/source/worker/served correlation and replay rejection",
    "#1898: representative task end-to-end with metered services unavailable",
    "UNRESOLVED: authentic exact-head approval preserved during disconnection and revalidation",
    "#1898 / #2519: classify unavoidable hosted work versus locally replaceable critical path",
  ];
  return rows.slice(2).map((line, index) => {
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
      assert.equal(expectedCustody[index], 'UNRESOLVED',
        'unresolved custody cannot silently replace a named canonical owner');
      assert.match(cells[1], /^UNRESOLVED:\s*\S/,
        'unresolved custody must name the missing evidence, not merely a label');
    } else {
      const separator = cells[1].indexOf(':');
      assert.ok(separator > 0 && cells[1].slice(separator + 1).trim(),
        'owner custody must have a canonical owner prefix and a nonempty witness');
      const ownerPrefix = cells[1].slice(0, separator);
      assert.equal(ownerPrefix.replace(/\s*\/\s*/g, ' / '), expectedCustody[index],
        'original owner custody cannot silently migrate to another valid owner');
      assert.match(ownerPrefix, /^#(?:1898|2519)(?:\s*\/\s*#(?:1898|2519))*$/,
        'owner identity must be an exact canonical issue prefix, not embedded prose');
      assert.deepEqual(ownerRefs, ownerPrefix.match(/#\d+/g) ?? [],
        'owner witness must not introduce an additional hidden owner claim');
      assert.equal(new Set(ownerRefs).size, ownerRefs.length,
        'owner custody must not repeat an existing implementation owner');
    }
    assert.equal(cells[1], expectedFirstEvidence[index],
      'original-owner first-evidence requirement cannot be weakened without review');
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

test('meter-blackout inventory rejects forged live status despite UNVERIFIED rows', () => {
  const markdown = readMeterBlackoutInventory();
  const canonicalStatus = '**Status: SOURCE-ONLY / UNVERIFIED.**';
  assert.ok(markdown.includes(canonicalStatus), 'source-only declaration must exist');
  for (const forged of [
    markdown.replace(canonicalStatus, '**Status: LIVE / VERIFIED.**'),
    markdown.replace(canonicalStatus, ''),
    markdown + '\n**Status: LIVE / PASS.**\n',
  ]) {
    assert.notEqual(forged, markdown, 'adversarial mutation must change the source packet');
    assert.throws(() => parseMeterBlackoutDimensions(forged),
      /meter blackout cannot silently promote or duplicate source-only status/,
      'source-only acceptance cannot become physical proof through a status label');
  }
});

test('meter-blackout inventory rejects a duplicate forged dimensions section', () => {
  const markdown = readMeterBlackoutInventory();
  const duplicate = '\n## Twelve canonical dimensions\n| `forged` | #1898: fabricated | PASS |\n';
  assert.throws(() => parseMeterBlackoutDimensions(markdown + duplicate),
    /exactly one canonical dimensions section/);
  assert.throws(() => parseMeterBlackoutDimensions(markdown + '\n## Verdict and original-owner routing\nPASS'),
    /exactly one verdict section/);
});

test('meter-blackout inventory rejects reordered or weakened PASS verdict contracts', () => {
  const markdown = readMeterBlackoutInventory();
  const dimensionsHeading = '## Twelve canonical dimensions';
  const verdictHeading = '## Verdict and original-owner routing';
  const [prefix, remainder] = markdown.split(dimensionsHeading);
  const [inventory, verdict] = remainder.split(verdictHeading);
  assert.ok(prefix && inventory && verdict, 'the mutation requires both canonical sections');
  const reordered = prefix + verdictHeading + verdict + '\n' + dimensionsHeading + inventory;
  assert.throws(() => parseMeterBlackoutDimensions(reordered),
    /canonical inventory must precede the verdict contract/,
    'a verdict before its evidence table cannot be accepted');
  const weakened = markdown.replace('independently reviewed evidence', 'self-attested evidence');
  assert.notEqual(weakened, markdown, 'the weakening mutation must alter the verdict');
  assert.throws(() => parseMeterBlackoutDimensions(weakened),
    /verdict contract must retain independent proof/,
    'a source-only checklist cannot redefine PASS as self-attested proof');
});

test('meter-blackout inventory rejects forged evidence tables outside its bounded section', () => {
  const markdown = readMeterBlackoutInventory();
  const forged = '| `codex-work-continuity` | #1898: fabricated receipt | PASS |';
  for (const mutated of [
    markdown.replace('## Twelve canonical dimensions', forged + '\n\n## Twelve canonical dimensions'),
    markdown + '\n' + forged + '\n',
    markdown + '\n| Dimension | Existing owner candidate / first evidence required | Initial verdict |\n| --- | --- | --- |\n' + forged + '\n',
  ]) {
    assert.throws(() => parseMeterBlackoutDimensions(mutated),
      /meter evidence table rows must appear only inside the canonical inventory/,
      'an out-of-band PASS table must not launder an UNVERIFIED acceptance inventory');
  }
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

test('meter-blackout inventory rejects silently weakened first-evidence requirements', () => {
  const markdown = readMeterBlackoutInventory();
  const mutations = [
    ['#1898: same bounded task built without Codex, with exact worker/source/test receipt',
      '#1898: source code exists'],
    ['#2519: same authorized observation through qualified Sovereign Commander, no paid remote tool',
      '#2519: observation planned'],
    ['UNRESOLVED: independently signed task/source/worker/served correlation and replay rejection',
      'UNRESOLVED: evidence to be decided'],
  ];
  for (const [original, weakened] of mutations) {
    assert.ok(markdown.includes(original), 'missing original evidence demand: ' + original);
    assert.throws(() => parseMeterBlackoutDimensions(markdown.replace(original, weakened)),
      /first-evidence requirement cannot be weakened/,
      'unchanged owner and UNVERIFIED verdict cannot conceal a weakened acceptance witness');
  }
});

test('meter-blackout inventory rejects silent valid-owner reassignment', () => {
  const markdown = readMeterBlackoutInventory();
  const swaps = [
    ['#1898: same bounded task built without Codex', '#2519: same bounded task built without Codex'],
    ['#2519: same authorized observation through qualified Sovereign Commander',
      '#1898: same authorized observation through qualified Sovereign Commander'],
    ['UNRESOLVED: bounded backoff, local continuity',
      '#1898: bounded backoff, local continuity'],
  ];
  for (const [original, forged] of swaps) {
    assert.ok(markdown.includes(original), 'missing canonical owner witness: ' + original);
    assert.throws(() => parseMeterBlackoutDimensions(markdown.replace(original, forged)),
      'a syntactically valid owner reassignment must require an explicit source-contract review');
  }
});

const assertMeterBlackoutOwnerIntroductions = (markdown) => {
  // The document heading names the owning seed by number; its first body
  // reference, implementation owners and cross-domain custody introductions must be title-bound.
  const body = markdown.slice(markdown.indexOf('\n') + 1);
  const owners = [
    ['2968', 'Seed: Stephanos Sovereign Meter Independence across all metered services', true],
    ['1898', 'Programme: Zero-Codex Continuity and Provider Parity V1', true],
    ['2519', 'Build Sovereign Commander as the unmetered Battle Bridge control surface', true],
    ['3026', 'Seed: Stephanos Full Sovereignty for Every Function, Zero External Critical Dependencies', true],
    ['1903', 'Goal: Stephanos Governed Self-Improvement and Operator Gap-to-Change Loop V1', false],
    ['2962', 'Goal: Repair Native Capacity Publisher generated-dist source gate mismatch', false],
  ];
  for (const [issue, title, beforeEvidenceContract] of owners) {
    const canonical = '[#' + issue + ' — ' + title + '](https://github.com/Cheekyfellastef/stephan-os/issues/' + issue + ')';
    const introduction = body.indexOf(canonical);
    assert.ok(introduction >= 0, 'missing title-bound original owner #' + issue);
    assert.equal(body.indexOf('#' + issue), introduction + 1,
      'first body mention of original owner #' + issue + ' must include its exact linked title');
    if (beforeEvidenceContract) {
      assert.ok(introduction < body.indexOf('## Meter-blackout evidence contract'),
        'the first owner reference must be verifiable before the evidence contract');
    }
  }
};

test('meter blackout acceptance keeps first-use owner titles bound to canonical issues', () => {
  assertMeterBlackoutOwnerIntroductions(readMeterBlackoutInventory());
});

test('meter blackout acceptance rejects a bare owner reference before its linked introduction', () => {
  const markdown = readMeterBlackoutInventory();
  for (const issue of ['2968', '1898', '2519', '3026', '1903', '2962']) {
    const forged = markdown.replace('\n\nCanonical owner:',
      '\n\nOriginal owner #' + issue + ' is assigned here without a title.\n\nCanonical owner:');
    assert.notEqual(forged, markdown, 'the adversarial mutation must change the acceptance packet');
    assert.throws(() => assertMeterBlackoutOwnerIntroductions(forged),
      /first body mention of original owner/,
      'a later correct link cannot launder an earlier bare owner #' + issue);
  }
});

test('stale heartbeat cannot manufacture a live canonical seed goal', () => {
  const payload = feed({ statusRecords: [buildHighLevelFlywheelSeedHeartbeatV1(registrySeed, {
    timestampUtc: '2026-10-09T10:00:00.000Z',
  })] });
  assert.equal(pressure(payload).length, 0);
});

const METER_BLACKOUT_SAFETY_CLAUSES_V1 = [
  [
    "quota non-evasion",
    "never evade quotas, use stolen credentials, bypass a subscription"
  ],
  [
    "provider Retry-After cooldown",
    "honor Retry-After and stop retries until permitted"
  ],
  [
    "offline pending reconciliation",
    "qualify durable local `PENDING` and safe reconnect behavior instead of claiming offline completion"
  ],
  [
    "remote exactly-once proof",
    "Remote delivery requires idempotency or independent reconciliation before claiming exactly-once behavior"
  ],
  [
    "gaming resource custody",
    "Gaming or Quest has absolute priority: do not reserve Battle Bridge CPU/GPU/VRAM for inference or build during gaming."
  ]
];

const assertMeterBlackoutSafetyClauses = (markdown) => {
  for (const [boundary, required] of METER_BLACKOUT_SAFETY_CLAUSES_V1) {
    assert.ok(markdown.includes(required),
      'meter blackout cannot silently weaken ' + boundary);
  }
};

test('meter blackout acceptance rejects weakened provider, offline-delivery and gaming boundaries', () => {
  const markdown = readMeterBlackoutInventory();
  assertMeterBlackoutSafetyClauses(markdown);
  for (const [boundary, required] of METER_BLACKOUT_SAFETY_CLAUSES_V1) {
    const weakened = markdown.replace(required, 'not required for this blackout');
    assert.notEqual(weakened, markdown, 'mutation must reach ' + boundary);
    assert.throws(() => assertMeterBlackoutSafetyClauses(weakened),
      /meter blackout cannot silently weaken/,
      'an unsafe shortcut cannot masquerade as blackout acceptance: ' + boundary);
  }
});
