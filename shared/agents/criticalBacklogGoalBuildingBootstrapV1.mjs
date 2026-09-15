import { DEFAULT_CRITICAL_BACKLOG } from './criticalBacklogConveyor.mjs';

export const GOAL_BUILDING_SELF_HOSTING_MISSION_ID = 'critical-2002-goal-building-self-hosting';
export const GOAL_BUILDING_SELF_HOSTING_ITEM_ID = 'goal-building-self-hosting';

const SELF_HOSTING_ITEM = Object.freeze({
  itemId: GOAL_BUILDING_SELF_HOSTING_ITEM_ID,
  priority: 60,
  issueNumbers: Object.freeze([2002, 1556, 1557, 1637]),
  sourcePrNumber: 2003,
  headlineApprovalRef: 'operator-authorized-builder-continuity-2026-09-05',
  mission: Object.freeze({
    missionKind: 'implementation',
    repository: 'Cheekyfellastef/stephan-os',
    baseBranch: 'main',
    browserProofRequired: false,
    missionId: GOAL_BUILDING_SELF_HOSTING_MISSION_ID,
    title: 'Connect durable goal estate to autonomous Goal Building Agent',
    branch: 'openclaw/critical-2002-goal-building-self-hosting',
    operatorIntent: 'Complete the unfinished M2-M4 path of #2002 by connecting the canonical durable GitHub goal estate to the existing #1556 scheduler and #1557 continuity machinery, then keep eligible provider-neutral build capacity productively filled without creating a second scheduler, controller, queue, worker, mailbox, workspace or authority plane.',
    intendedOutcome: 'Open durable goals become canonical scheduler-visible work, the Goal Building Agent can prove which goals are eligible, the Mission Worker receives real bounded implementation actions instead of idling after the finite legacy backlog, and independent eligible work can be refilled through the existing elastic/provider-neutral machinery until only genuine dependency, approval, safety or external boundaries remain.',
    allowedFiles: Object.freeze([
      'shared/agents/goalBuildingAgentV1.mjs',
      'shared/agents/goalBuildingAgentV1.observation.mjs',
      'shared/agents/goalBuildingAgentV1.observation.test.mjs',
      'shared/agents/goalBuildingAgentV1.records.mjs',
      'shared/agents/goalBuildingAgentV1.runtime-records.test.mjs',
      'shared/agents/goalBuildingAgentV1.shared-workspace.mjs',
      'shared/agents/goalBuildingAgentV1.shared-workspace.test.mjs',
      'shared/agents/programmeAuthorityV1.mjs',
      'shared/agents/programmeAuthorityV1.test.mjs',
      'shared/agents/sharedAgentWorkspaceStore.mjs',
      'shared/agents/sharedAgentWorkspaceStore.test.mjs',
      'stephanos-server/services/githubPrEvidenceService.js',
      'stephanos-server/services/programmeAuthorityService.js',
      'stephanos-server/services/programmeAuthorityService.test.js',
      'scripts/mission-orchestrator-worker-supervised.mjs',
      'scripts/mission-orchestrator-worker-supervised.test.mjs'
    ]),
    requiredTests: Object.freeze([
      'node --test shared/agents/goalBuildingAgentV1.test.mjs shared/agents/goalBuildingAgentV1.observation.test.mjs shared/agents/goalBuildingAgentV1.runtime-records.test.mjs shared/agents/goalBuildingAgentV1.shared-workspace.test.mjs',
      'node --test shared/agents/programmeAuthorityV1.test.mjs shared/agents/sharedAgentWorkspaceStore.test.mjs',
      'node --test stephanos-server/services/programmeAuthorityService.test.js scripts/mission-orchestrator-worker-supervised.test.mjs'
    ]),
    requiredEvidence: Object.freeze([
      'canonical GitHub durable-goal intake proof',
      'scheduler visibility and eligibility proof',
      'Goal Building Agent Shared Workspace projection proof',
      'Mission Worker active task/receipt/execution-phase proof',
      'work-conserving provider-neutral refill proof'
    ]),
  }),
});

export const SELF_HOSTING_CRITICAL_BACKLOG = Object.freeze([
  ...DEFAULT_CRITICAL_BACKLOG,
  SELF_HOSTING_ITEM,
]);
