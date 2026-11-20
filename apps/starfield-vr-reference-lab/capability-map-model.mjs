export const STARFIELD_VR_CAPABILITY_MAP_SCHEMA = 'stephanos.starfield-vr-capability-map.v1';

export const STARFIELD_VR_CAPABILITY_DEFINITIONS = Object.freeze([
  Object.freeze({ id: 'visual-fidelity', label: 'Visual Fidelity', icon: '✦', priority: 7, dependencies: ['stereo-stability', 'performance'] }),
  Object.freeze({ id: 'stereo-stability', label: 'Stereo Stability', icon: '◉', priority: 1, dependencies: ['performance', 'route-intelligence'] }),
  Object.freeze({ id: 'performance', label: 'Performance', icon: '⌁', priority: 2, dependencies: ['telemetry'] }),
  Object.freeze({ id: 'comfort', label: 'Comfort', icon: '♡', priority: 3, dependencies: ['stereo-stability', 'performance'] }),
  Object.freeze({ id: 'controls', label: 'Controls & Interaction', icon: '⌘', priority: 6, dependencies: ['launch-exit'] }),
  Object.freeze({ id: 'gameplay', label: 'Gameplay Completeness', icon: '⬡', priority: 9, dependencies: ['controls', 'launch-exit'] }),
  Object.freeze({ id: 'audio', label: 'Audio Routing', icon: '◖', priority: 4, dependencies: ['launch-exit'] }),
  Object.freeze({ id: 'launch-exit', label: 'Launch / Exit Recovery', icon: '↻', priority: 5, dependencies: ['telemetry'] }),
  Object.freeze({ id: 'telemetry', label: 'Telemetry', icon: '▥', priority: 8, dependencies: [] }),
  Object.freeze({ id: 'autonomous-repair', label: 'Autonomous Repair', icon: '⚙', priority: 10, dependencies: ['telemetry'] }),
  Object.freeze({ id: 'route-intelligence', label: 'Route Intelligence', icon: '◇', priority: 11, dependencies: ['telemetry'] }),
]);

const STATE_RANK = Object.freeze({
  BLOCKED: 0,
  NEEDS_WORK: 1,
  UNKNOWN: 2,
  HEALTHY: 3,
});

function text(value, fallback = '') {
  const out = String(value ?? '').trim();
  return out || fallback;
}

function list(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function hasSignal(findings, expression) {
  return findings.some((entry) => expression.test(String(entry)));
}

function positiveSignal(findings, expression) {
  return findings.some((entry) => expression.test(String(entry)));
}

function result(id, state, reason, evidence = []) {
  const definition = STARFIELD_VR_CAPABILITY_DEFINITIONS.find((entry) => entry.id === id);
  return Object.freeze({
    ...definition,
    state,
    reason,
    evidence: Object.freeze([...new Set(list(evidence).map((entry) => text(entry)).filter(Boolean))]),
  });
}

function starfieldLatest(feed = {}) {
  return feed?.starfieldReferenceLab?.latest
    || feed?.latest?.labProjections?.starfieldReferenceLab
    || {};
}

function rawLatest(feed = {}) {
  return feed?.latest && typeof feed.latest === 'object' ? feed.latest : {};
}

function deriveCapabilityStates(feed = {}) {
  const star = starfieldLatest(feed);
  const raw = rawLatest(feed);
  const findings = list(star.findings || raw.findings).map(String);
  const findingText = findings.join(' | ');
  const current = String(feed?.state || '').toLowerCase() === 'ready' && star?.current !== false;
  const stale = String(feed?.state || '').toLowerCase() === 'stale' || star?.current === false;
  const sequenceFaultCount = Number(star.sequenceFaultCount ?? raw?.telemetry?.sequenceFaultCount ?? 0) || 0;
  const maxAbsDelta = Number(star.maxAbsDelta ?? raw?.telemetry?.maxAbsDelta);
  const nextMode = text(star.nextMode || raw?.labProjections?.starfieldReferenceLab?.nextMode, 'OBSERVE').toUpperCase();
  const rollback = text(star.rollback || raw?.rollback?.state, 'UNKNOWN').toUpperCase();
  const route = text(star.route || raw.route || raw.provider, 'UNKNOWN');
  const mode = text(star.mode || raw.mode, 'UNKNOWN');
  const provenanceRef = text(star.provenanceRef || raw.provenanceRef, '');
  const proofBits = [provenanceRef, ...findings];

  const stereoBad = sequenceFaultCount > 0 || hasSignal(findings, /alternate[- ]?eye|stereo|shimmer|ghost|double|depth inconsisten|per[- ]?eye|aer fault/i);
  const performanceBad = hasSignal(findings, /low fps|frame pac|stutter|judder|reprojection|gpu|cpu|latency|slow/i);
  const comfortBad = hasSignal(findings, /nause|sick|comfort|motion artefact|motion artifact|world judder|discomfort/i);
  const controlsBad = hasSignal(findings, /controller|gamepad|input|mapping|freeze|drift/i);
  const audioBad = hasSignal(findings, /audio|sound|handback|device switch|headset.*speaker|speaker.*headset/i);
  const launchBad = hasSignal(findings, /crash|launch fail|exit fail|hang|rollback fail/i);
  const visualBad = hasSignal(findings, /stretch|particle|visual|artifact|artefact|blur|clarity|image break|ghost|shimmer/i);

  const states = [];

  states.push(result(
    'telemetry',
    current ? 'HEALTHY' : stale ? 'NEEDS_WORK' : 'UNKNOWN',
    current ? 'A current canonical Starfield VR playtest packet is reaching the Lab.'
      : stale ? 'The canonical playtest packet exists but is stale.'
        : 'No current canonical Starfield VR playtest packet is available.',
    proofBits,
  ));

  states.push(result(
    'stereo-stability',
    stereoBad ? 'BLOCKED' : current && nextMode === 'PROTECT' ? 'HEALTHY' : current ? 'NEEDS_WORK' : 'UNKNOWN',
    stereoBad
      ? 'Current evidence reports stereo or alternate-eye instability. This blocks the north-star experience.'
      : current && nextMode === 'PROTECT'
        ? 'Current evidence has no stereo fault signal and the playtest loop has reached PROTECT.'
        : current
          ? 'No current stereo fault is reported, but the route has not yet earned protected status.'
          : 'Stereo stability has no current headset proof.',
    [
      sequenceFaultCount ? 'AER sequence faults: ' + sequenceFaultCount : '',
      Number.isFinite(maxAbsDelta) ? 'Maximum eye delta: ' + maxAbsDelta : '',
      ...findings.filter((entry) => /alternate[- ]?eye|stereo|shimmer|ghost|depth|aer/i.test(entry)),
      provenanceRef,
    ],
  ));

  states.push(result(
    'performance',
    performanceBad ? 'BLOCKED' : current ? 'NEEDS_WORK' : 'UNKNOWN',
    performanceBad
      ? 'Current evidence reports frame-time, FPS, stutter or reprojection pressure.'
      : current
        ? 'The route is observable, but sustained smooth-frame proof has not been promoted yet.'
        : 'Performance needs current runtime telemetry and headset evidence.',
    [...findings.filter((entry) => /fps|frame|stutter|judder|reprojection|gpu|cpu|latency|slow/i.test(entry)), provenanceRef],
  ));

  states.push(result(
    'comfort',
    comfortBad ? 'BLOCKED' : positiveSignal(findings, /comfortable|comfort.*good|smooth movement|no nausea/i) ? 'HEALTHY' : current ? 'NEEDS_WORK' : 'UNKNOWN',
    comfortBad
      ? 'Movement or motion evidence currently contains a comfort blocker.'
      : positiveSignal(findings, /comfortable|comfort.*good|smooth movement|no nausea/i)
        ? 'A current playtest reports positive comfort evidence.'
        : current
          ? 'Comfort is not yet strongly proven across movement and longer sessions.'
          : 'Comfort requires headset playtest evidence.',
    [...findings.filter((entry) => /comfort|nause|sick|motion|judder/i.test(entry)), provenanceRef],
  ));

  states.push(result(
    'controls',
    controlsBad ? 'NEEDS_WORK' : positiveSignal(findings, /controller.*reliable|controls.*good|input.*stable/i) ? 'HEALTHY' : 'UNKNOWN',
    controlsBad
      ? 'The latest evidence contains a controller or input reliability issue.'
      : positiveSignal(findings, /controller.*reliable|controls.*good|input.*stable/i)
        ? 'The latest evidence contains positive controller proof.'
        : 'No current proof establishes controller reliability across the experience.',
    [...findings.filter((entry) => /controller|gamepad|input|mapping|freeze|drift/i.test(entry)), provenanceRef],
  ));

  states.push(result(
    'audio',
    audioBad ? 'NEEDS_WORK' : positiveSignal(findings, /audio.*restor|audio.*good|sound.*good/i) ? 'HEALTHY' : 'UNKNOWN',
    audioBad
      ? 'The latest evidence contains an audio-routing or handback issue.'
      : positiveSignal(findings, /audio.*restor|audio.*good|sound.*good/i)
        ? 'The latest evidence contains positive audio-routing proof.'
        : 'Audio routing and desktop handback do not yet have current proof.',
    [...findings.filter((entry) => /audio|sound|handback|device/i.test(entry)), provenanceRef],
  ));

  states.push(result(
    'launch-exit',
    launchBad || /FAIL|ERROR|BLOCK/.test(rollback) ? 'BLOCKED'
      : /RESTORED|VERIFIED|PASS|READY|CLEAN/.test(rollback) ? 'HEALTHY'
        : current ? 'NEEDS_WORK' : 'UNKNOWN',
    launchBad
      ? 'The latest evidence contains a launch, crash or exit-recovery failure.'
      : /RESTORED|VERIFIED|PASS|READY|CLEAN/.test(rollback)
        ? 'Rollback / recovery evidence is currently positive.'
        : current
          ? 'The route is running, but clean exit and rollback are not yet fully proven.'
          : 'Launch and exit recovery need current runtime proof.',
    ['Rollback: ' + rollback, ...findings.filter((entry) => /launch|exit|crash|rollback|hang/i.test(entry)), provenanceRef],
  ));

  states.push(result(
    'visual-fidelity',
    visualBad || stereoBad ? 'NEEDS_WORK'
      : positiveSignal(findings, /visual.*good|image.*stable|clarity.*good/i) ? 'HEALTHY'
        : 'UNKNOWN',
    visualBad || stereoBad
      ? 'Image quality is constrained by current rendering artefacts or stereo instability.'
      : positiveSignal(findings, /visual.*good|image.*stable|clarity.*good/i)
        ? 'The current playtest contains positive visual evidence.'
        : 'Visual fidelity has not yet earned current end-to-end proof.',
    [...findings.filter((entry) => /visual|image|clarity|stretch|particle|artifact|artefact|ghost|shimmer/i.test(entry)), provenanceRef],
  ));

  states.push(result(
    'gameplay',
    positiveSignal(findings, /mission|quest|inventory|dialog|combat|ship|outpost|gameplay/i) ? 'NEEDS_WORK' : 'UNKNOWN',
    positiveSignal(findings, /mission|quest|inventory|dialog|combat|ship|outpost|gameplay/i)
      ? 'Some gameplay evidence exists, but whole-game VR completeness is not yet proven.'
      : 'Whole-game Starfield feature coverage has not yet been proven in the current playtest feed.',
    [...findings.filter((entry) => /mission|quest|inventory|dialog|combat|ship|outpost|gameplay/i.test(entry)), provenanceRef],
  ));

  const flywheelPresent = Boolean(feed?.flywheel?.latestProtectReady !== undefined || feed?.flywheel?.lessonId || raw?.flywheel?.lessonId);
  const protectReady = feed?.flywheel?.latestProtectReady === true;
  states.push(result(
    'autonomous-repair',
    protectReady ? 'HEALTHY' : flywheelPresent ? 'NEEDS_WORK' : 'UNKNOWN',
    protectReady
      ? 'The Flywheel has current evidence ready for protected promotion.'
      : flywheelPresent
        ? 'The Flywheel is receiving evidence, but protected autonomous closure is not yet proven.'
        : 'No current Flywheel repair proof is attached to this Starfield session.',
    [text(feed?.flywheel?.lessonId || raw?.flywheel?.lessonId, ''), provenanceRef],
  ));

  states.push(result(
    'route-intelligence',
    route !== 'UNKNOWN' && current ? 'NEEDS_WORK' : 'UNKNOWN',
    route !== 'UNKNOWN' && current
      ? 'The active route is known, but cross-route superiority still requires comparable evidence.'
      : 'No current route identity is available for comparison.',
    ['Route: ' + route, 'Mode: ' + mode, provenanceRef],
  ));

  return Object.freeze({
    current,
    stale,
    route,
    mode,
    nextMode,
    rollback,
    sequenceFaultCount,
    maxAbsDelta: Number.isFinite(maxAbsDelta) ? maxAbsDelta : null,
    provenanceRef,
    findings: Object.freeze(findings),
    capabilities: Object.freeze(states),
  });
}

export function deriveStarfieldVrCapabilityMap(feed = {}) {
  const derived = deriveCapabilityStates(feed);
  const ordered = [...derived.capabilities].sort((a, b) => a.priority - b.priority);
  const blockerPool = ordered.filter((entry) => entry.state === 'BLOCKED');
  const needsPool = ordered.filter((entry) => entry.state === 'NEEDS_WORK');
  const unknownPool = ordered.filter((entry) => entry.state === 'UNKNOWN');
  const biggestBlocker = blockerPool[0] || needsPool[0] || unknownPool[0] || null;
  const critical = ordered.filter((entry) => ['stereo-stability', 'performance', 'comfort', 'launch-exit'].includes(entry.id));
  const northStarState = critical.every((entry) => entry.state === 'HEALTHY')
    ? 'HEALTHY'
    : critical.some((entry) => entry.state === 'BLOCKED')
      ? 'BLOCKED'
      : critical.some((entry) => entry.state === 'NEEDS_WORK')
        ? 'NEEDS_WORK'
        : 'UNKNOWN';

  return Object.freeze({
    schemaVersion: STARFIELD_VR_CAPABILITY_MAP_SCHEMA,
    target: 'Skyrim-VR-class Starfield experience',
    targetState: northStarState,
    route: derived.route,
    mode: derived.mode,
    nextMode: derived.nextMode,
    rollback: derived.rollback,
    sourceState: text(feed?.state, 'unknown').toUpperCase(),
    currentEvidence: derived.current,
    biggestBlocker,
    bottlenecks: Object.freeze(
      [...blockerPool, ...needsPool, ...unknownPool]
        .sort((a, b) => (STATE_RANK[a.state] - STATE_RANK[b.state]) || a.priority - b.priority)
        .slice(0, 5),
    ),
    capabilities: Object.freeze(ordered),
    findings: derived.findings,
    sequenceFaultCount: derived.sequenceFaultCount,
    maxAbsDelta: derived.maxAbsDelta,
    provenanceRef: derived.provenanceRef,
    evidenceBoundary: 'Only current Shared Workspace / headset evidence may promote a capability to healthy. Missing proof stays UNKNOWN.',
  });
}
