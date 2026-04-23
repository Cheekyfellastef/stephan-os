export const OPENCLAW_MODE = 'Shadow Mode';
export const OPENCLAW_AUTHORITY = 'Operator Approval Required';
export const OPENCLAW_COST_POSTURE = 'Zero-Cost Guardrails Active';
export const OPENCLAW_EXECUTION_POSTURE = 'Proposal-Only / No direct destructive actions';

export const OPENCLAW_AUTHORITY_MODEL = Object.freeze([
  { capability: 'Inspect', status: 'allowed' },
  { capability: 'Analyse', status: 'allowed' },
  { capability: 'Propose', status: 'allowed' },
  { capability: 'Prepare prompt text', status: 'allowed' },
  { capability: 'Direct repo mutation', status: 'blocked' },
  { capability: 'Direct destructive shell action', status: 'blocked' },
  { capability: 'Direct GitHub destructive action', status: 'blocked' },
  { capability: 'Memory truth write', status: 'blocked' },
  { capability: 'Canonical runtime truth override', status: 'blocked' },
  { capability: 'Hidden background tasking', status: 'blocked' },
  { capability: 'Autonomous escalation of privileges', status: 'blocked' },
]);

export const OPENCLAW_SCAN_MODES = Object.freeze([
  {
    id: 'architecture-scan',
    label: 'Architecture Scan',
    description: 'Inspect architecture boundaries and launch/runtime separation.',
    focusAreas: ['stephanos-ui/src', 'modules/command-deck', 'shared/runtime/stephanosLaws.mjs'],
  },
  {
    id: 'runtime-truth-routing-scan',
    label: 'Runtime Truth / Routing Scan',
    description: 'Inspect runtimeStatusModel, adjudication, and finalRouteTruthView projections.',
    focusAreas: ['stephanos-ui/src/state/finalRouteTruthView', 'shared/runtime/runtimeStatusModel.mjs', 'modules/command-deck'],
  },
  {
    id: 'tile-integration-scan',
    label: 'Tile Integration Scan',
    description: 'Inspect panel wiring, pane ordering, and governed tile integration boundaries.',
    focusAreas: ['stephanos-ui/src/App.jsx', 'stephanos-ui/src/state/aiStore.js', 'stephanos-ui/src/components'],
  },
  {
    id: 'dist-source-drift-scan',
    label: 'Dist / Source Drift Scan',
    description: 'Inspect source/dist separation markers and cautionary truth posture.',
    focusAreas: ['stephanos-ui/src/runtimeInfo.js', 'apps/stephanos/dist', 'scripts/verify-stephanos-dist.mjs'],
  },
  {
    id: 'candidate-codex-prompt-generation',
    label: 'Candidate Codex Prompt Generation',
    description: 'Generate doctrine-safe candidate prompts based on bounded evidence.',
    focusAreas: ['scan evidence artifacts', 'Stephanos doctrine constraints', 'verification checkpoints'],
  },
]);

export const OPENCLAW_CATASTROPHIC_ACTIONS = Object.freeze([
  'delete-github-repository',
  'force-push-history-rewrite',
  'mass-file-delete',
  'delete-dist-and-source',
  'delete-package-manifest-or-lockfile',
  'delete-secrets-or-env',
  'bulk-destructive-filesystem-operations',
  'unbounded-shell-execution',
  'credential-exfiltration',
  'automatic-plugin-installation',
  'automatic-remote-code-execution',
  'automatic-git-hard-reset-or-prune',
  'automatic-ci-deploy-auth-secrets-mutation',
]);
