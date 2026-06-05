import { OPENCLAW_WORKSPACE_EXTERNAL_DIRECTORY, OPENCLAW_WORKSPACE_SAFE_START_COMMAND_PREFIX } from './openClawWorkspaceHygiene.mjs';

const VALID_GATEWAY_STATUSES = new Set(['unknown', 'running', 'stopped', 'unreachable']);
const VALID_DASHBOARD_STATUSES = new Set(['unknown', 'openable', 'unavailable']);
const VALID_PROOF_STATUSES = new Set(['unknown', 'pending', 'pass', 'fail']);

export const OPENCLAW_CONTROL_BRIDGE_DEFAULTS = Object.freeze({
  gatewayTarget: 'ws://127.0.0.1:18789',
  dashboardUrl: 'http://127.0.0.1:18789/',
  expectedLocalModels: Object.freeze(['ollama/llama3.2:3b', 'qwen:14b']),
  expectedAgents: Object.freeze(['stephanos-scout', 'stephanos-scout-qwen14']),
  gatewayStatus: 'unknown',
  dashboardStatus: 'unknown',
  localScoutProofStatus: 'unknown',
  mutationAuthority: 'locked',
  autoStart: 'forbidden',
  operatorApprovalRequired: 'yes',
  dashboardTemporaryCockpit: 'yes',
  openClawWorkspacePath: OPENCLAW_WORKSPACE_EXTERNAL_DIRECTORY,
  startGatewayCommand: `${OPENCLAW_WORKSPACE_SAFE_START_COMMAND_PREFIX} openclaw gateway --host 127.0.0.1 --port 18789`,
  stopOpenClawCommand: 'Stop the local OpenClaw Gateway from the terminal where it is running with Ctrl+C; do not install Windows auto-start or scheduled service behavior.',
  lastProofExpectedText: 'OpenClaw one-shot local route works.',
  lastProofObservedText: '',
});

export function buildOpenClawLocalScoutProofCommand({ sessionKeyPlaceholder = 'agent:stephanos-scout:proof-<fresh>' } = {}) {
  return `${OPENCLAW_WORKSPACE_SAFE_START_COMMAND_PREFIX} openclaw agent --local --agent stephanos-scout --model ollama/llama3.2:3b --session-key ${sessionKeyPlaceholder} -m "Reply with exactly this sentence and nothing else: ${OPENCLAW_CONTROL_BRIDGE_DEFAULTS.lastProofExpectedText}"`;
}

function pickEnum(value, allowed, fallback) {
  const normalized = String(value || '').trim().toLowerCase();
  return allowed.has(normalized) ? normalized : fallback;
}

function asArray(value, fallback = []) {
  return Array.isArray(value) && value.length ? value.map((entry) => String(entry || '').trim()).filter(Boolean) : [...fallback];
}

export function buildOpenClawControlBridgeProjection(input = {}) {
  const lastProofCommand = String(input.lastProofCommand || '').trim()
    || buildOpenClawLocalScoutProofCommand({ sessionKeyPlaceholder: input.sessionKeyPlaceholder || 'agent:stephanos-scout:proof-<fresh>' });
  const localScoutProofStatus = pickEnum(input.localScoutProofStatus, VALID_PROOF_STATUSES, OPENCLAW_CONTROL_BRIDGE_DEFAULTS.localScoutProofStatus);
  const warnings = [];
  if (!['pass'].includes(localScoutProofStatus)) {
    warnings.push('Local scout proof is missing or stale; run the copyable proof command with a fresh session key before claiming OpenClaw is online.');
  }
  if (String(input.mutationAuthority || OPENCLAW_CONTROL_BRIDGE_DEFAULTS.mutationAuthority).trim().toLowerCase() !== 'locked') {
    warnings.push('Mutation authority must remain locked until explicit operator approval gates are implemented and proved.');
  }
  if (String(input.autoStart || OPENCLAW_CONTROL_BRIDGE_DEFAULTS.autoStart).trim().toLowerCase() !== 'forbidden') {
    warnings.push('Windows auto-start is forbidden by operator intent.');
  }

  return {
    bridgeStatus: localScoutProofStatus === 'pass' ? 'proof-passed-readonly' : 'manual-control-readonly',
    gatewayTarget: String(input.gatewayTarget || OPENCLAW_CONTROL_BRIDGE_DEFAULTS.gatewayTarget).trim(),
    dashboardUrl: String(input.dashboardUrl || OPENCLAW_CONTROL_BRIDGE_DEFAULTS.dashboardUrl).trim(),
    expectedLocalModels: asArray(input.expectedLocalModels, OPENCLAW_CONTROL_BRIDGE_DEFAULTS.expectedLocalModels),
    expectedAgents: asArray(input.expectedAgents, OPENCLAW_CONTROL_BRIDGE_DEFAULTS.expectedAgents),
    openClawWorkspacePath: OPENCLAW_CONTROL_BRIDGE_DEFAULTS.openClawWorkspacePath,
    gatewayStatus: pickEnum(input.gatewayStatus, VALID_GATEWAY_STATUSES, OPENCLAW_CONTROL_BRIDGE_DEFAULTS.gatewayStatus),
    dashboardStatus: pickEnum(input.dashboardStatus, VALID_DASHBOARD_STATUSES, OPENCLAW_CONTROL_BRIDGE_DEFAULTS.dashboardStatus),
    localScoutProofStatus,
    mutationAuthority: 'locked',
    autoStart: 'forbidden',
    operatorApprovalRequired: 'yes',
    dashboardTemporaryCockpit: 'yes',
    lastProofCommand,
    lastProofExpectedText: String(input.lastProofExpectedText || OPENCLAW_CONTROL_BRIDGE_DEFAULTS.lastProofExpectedText).trim(),
    lastProofObservedText: String(input.lastProofObservedText || OPENCLAW_CONTROL_BRIDGE_DEFAULTS.lastProofObservedText).trim(),
    startGatewayCommand: String(input.startGatewayCommand || OPENCLAW_CONTROL_BRIDGE_DEFAULTS.startGatewayCommand).trim(),
    stopOpenClawCommand: String(input.stopOpenClawCommand || OPENCLAW_CONTROL_BRIDGE_DEFAULTS.stopOpenClawCommand).trim(),
    warnings,
    isBuilder: false,
    builderWarning: 'OpenClaw is not a builder yet; it remains a read-only scout until proof and approval gates exist.',
    workspaceLocationGuarantee: `OpenClaw commands create and enter ${OPENCLAW_WORKSPACE_EXTERNAL_DIRECTORY} before launch so runtime files never use the repo root.`,
    noAutoStartGuarantee: 'No Windows auto-start: operator starts and stops OpenClaw manually.',
  };
}
