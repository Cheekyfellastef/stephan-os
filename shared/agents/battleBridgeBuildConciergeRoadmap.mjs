export const BATTLE_BRIDGE_BUILD_CONCIERGE_ROADMAP_SCHEMA = 'stephanos.battle-bridge-build-concierge-roadmap.v4-v8-source-spec';

export const BATTLE_BRIDGE_BUILD_CONCIERGE_SURFACES = Object.freeze([
  'Mission Operations',
  'Mission Dashboard',
  'standalone landing-page Goal Dashboard',
]);

export const BATTLE_BRIDGE_BUILD_CONCIERGE_ROADMAP = Object.freeze([
  Object.freeze({
    version: 'V2',
    title: 'Operator Surfaces',
    status: 'implemented',
    intent: 'Project selected PR/goal, proof readiness, command plan, dirty-tree status, approval token state, proof packet summary, merge hold state, and next operator action into Mission Operations and Goal Dashboard.',
    sourceCanon: ['#1392 V2'],
  }),
  Object.freeze({
    version: 'V3',
    title: 'Local Proof Runner',
    status: 'implemented_guarded',
    intent: 'Use an isolated proof worktree for a supplied PR, run allowlisted build/test commands, clean generated artifacts, and emit a canonical proof packet; unsafe contexts return truthful blockers.',
    sourceCanon: ['#1394 V3 local proof runner and overflow fix'],
  }),
  Object.freeze({
    version: 'V4',
    title: 'Browser Proof Capture',
    status: 'implemented_guarded',
    intent: 'Integrate browser proof runner where available and record checklist, screenshot path, console errors, and caveats without claiming browser proof when unavailable.',
    sourceCanon: ['#1391 V1', '#1392 V2', '#1393 Goal Dashboard rail', '#1394 V3 local proof runner and overflow fix'],
    requiredSurfaces: BATTLE_BRIDGE_BUILD_CONCIERGE_SURFACES,
    guardrails: [
      'Browser proof runner integration is conditional on an available browser proof runner.',
      'Capture checklist, screenshot path, console errors, and caveats as source-owned proof fields.',
      'No browser proof claim is allowed when the browser runner is unavailable.',
      'Mission Operations, Mission Dashboard, and standalone landing-page Goal Dashboard must all show V4 status.',
    ],
    testsRequired: ['Each required surface shows V4 Browser Proof Capture implemented_guarded status plus browser-proof blocked/verified truth.'],
  }),
  Object.freeze({
    version: 'V5',
    title: 'Auto Pick Next Safe Work',
    status: 'planned_guarded',
    intent: 'Inspect PR and goal candidates and rank safe candidates by mergeability, blockers, labels, and declared proof commands while preserving unknown truth.',
    sourceCanon: ['#1391 V1', '#1392 V2', '#1393 Goal Dashboard rail', '#1394 V3 local proof runner and overflow fix'],
    requiredSurfaces: BATTLE_BRIDGE_BUILD_CONCIERGE_SURFACES,
    guardrails: [
      'Candidate inspection may rank only from observed mergeability, blockers, labels, and declared proof commands.',
      'Unknown stays unknown; missing GitHub, label, blocker, or proof-command evidence must not be inferred as safe.',
      'No fake GitHub proof or live PR proof may be claimed from static or unavailable evidence.',
      'Mission Operations, Mission Dashboard, and standalone landing-page Goal Dashboard must all show V5 status.',
    ],
    testsRequired: ['Each required surface shows V5 Auto Pick Next Safe Work and planned_guarded status.'],
  }),
  Object.freeze({
    version: 'V6',
    title: 'Operator Approval Surface',
    status: 'planned_guarded',
    intent: 'Expose one approve/reject UI state while exact-head approval remains bound to PR number and current head SHA, with no UI merge without an approval token.',
    sourceCanon: ['#1391 V1', '#1392 V2', '#1393 Goal Dashboard rail', '#1394 V3 local proof runner and overflow fix'],
    requiredSurfaces: BATTLE_BRIDGE_BUILD_CONCIERGE_SURFACES,
    guardrails: [
      'Approval UI has one approve/reject state and must not fork competing approval surfaces.',
      'Approval is exact-head bound to PR number plus current head SHA.',
      'The UI must not merge without a matching approval token.',
      'Mission Operations, Mission Dashboard, and standalone landing-page Goal Dashboard must all show V6 status.',
    ],
    testsRequired: ['Each required surface shows V6 Operator Approval Surface and planned_guarded status.'],
  }),
  Object.freeze({
    version: 'V7',
    title: 'Post-Merge Sync and Reproof',
    status: 'planned_guarded',
    intent: 'After an approved merge only, pull main, restart or refresh only if needed, prove backend freshness, and update surfaces without dirty-tree mutation or PC restart.',
    sourceCanon: ['#1391 V1', '#1392 V2', '#1393 Goal Dashboard rail', '#1394 V3 local proof runner and overflow fix'],
    requiredSurfaces: BATTLE_BRIDGE_BUILD_CONCIERGE_SURFACES,
    guardrails: [
      'Post-merge sync starts only after an approved merge.',
      'Pull main and restart/refresh only when required by proof state.',
      'Backend freshness proof must be recorded before claiming current status.',
      'Dirty-tree auto mutation and PC restart are prohibited.',
      'Mission Operations, Mission Dashboard, and standalone landing-page Goal Dashboard must all show V7 status.',
    ],
    testsRequired: ['Each required surface shows V7 Post-Merge Sync and Reproof and planned_guarded status.'],
  }),
  Object.freeze({
    version: 'V8',
    title: 'Multi-Goal Queue',
    status: 'planned_guarded',
    intent: 'Maintain a safe queue of proofable goals and PRs with one active proof lane unless isolation is explicit, exposing blockers, progress, and next action.',
    sourceCanon: ['#1391 V1', '#1392 V2', '#1393 Goal Dashboard rail', '#1394 V3 local proof runner and overflow fix'],
    requiredSurfaces: BATTLE_BRIDGE_BUILD_CONCIERGE_SURFACES,
    guardrails: [
      'Queue only proofable goals or PRs with visible truth fields.',
      'Use one active proof lane unless work is explicitly isolated.',
      'Visible blockers, progress, and next action are required before acting.',
      'Mission Operations, Mission Dashboard, and standalone landing-page Goal Dashboard must all show V8 status.',
    ],
    testsRequired: ['Each required surface shows V8 Multi-Goal Queue and planned_guarded status.'],
  }),
]);

export function plannedConciergeRoadmapVersions() {
  return BATTLE_BRIDGE_BUILD_CONCIERGE_ROADMAP.filter((phase) => /^V[4-8]$/.test(phase.version));
}
