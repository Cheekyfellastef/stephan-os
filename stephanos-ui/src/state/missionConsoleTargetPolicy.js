import { buildBoundedOpenClawIntent } from '../components/openclaw/openclawIntegrationAdapter.js';
import { isOpenClawActionBlocked } from '../components/openclaw/openclawGuardrails.js';

export const MISSION_CONSOLE_TARGETS = Object.freeze([
  { id: 'stephanos', label: 'Stephanos → Assistant Router', sessionMode: 'conversational' },
  { id: 'agents', label: 'Agents → Mission Bridge', sessionMode: 'agent-directed' },
  { id: 'openclaw', label: 'OpenClaw → Bounded Analysis', sessionMode: 'openclaw-bounded-analysis' },
]);

export const OPENCLAW_ALLOWED_INTERACTIONS = Object.freeze([
  'run bounded scan',
  'explain finding',
  'refine candidate prompt',
  'generate alternatives',
  'describe likely affected files',
  'explain doctrine risk',
  'summarize inspection scope',
]);

export const OPENCLAW_BLOCKED_INTERACTIONS = Object.freeze([
  'direct repo mutation',
  'direct shell execution',
  'plugin installation',
  'secret access / export',
  'destructive git operations',
  'autonomous “fix everything” mode',
  'hidden or background actions',
]);

const OPENCLAW_BLOCK_PATTERNS = Object.freeze([
  { actionId: 'mass-file-delete', pattern: /\b(delete|remove|rm)\b[\s\S]*\b(all|entire|bulk|mass)\b/i, policy: 'Catastrophic-Safety Block' },
  { actionId: 'delete-dist-and-source', pattern: /\bdelete\b[\s\S]*\b(source|src)\b[\s\S]*\b(dist|build)\b/i, policy: 'Catastrophic-Safety Block' },
  { actionId: 'force-push-history-rewrite', pattern: /\b(force\s*push|history\s*rewrite|git\s+push\s+--force)\b/i, policy: 'Git Destructive Operations Block' },
  { actionId: 'credential-exfiltration', pattern: /\b(secret|token|credential|password|\.env)\b[\s\S]*\b(export|leak|exfiltrat|print)\b/i, policy: 'Secrets Protection Block' },
  { actionId: 'automatic-plugin-installation', pattern: /\b(plugin|extension)\b[\s\S]*\binstall\b/i, policy: 'Plugin Installation Block' },
  { actionId: 'unbounded-shell-execution', pattern: /\b(run|execute)\b[\s\S]*\b(shell|bash|terminal|command)\b/i, policy: 'No Direct Execution Block' },
  { actionId: 'delete-github-repository', pattern: /\bdelete\b[\s\S]*\b(github|repository|repo)\b/i, policy: 'GitHub Destructive Operations Block' },
]);

function sanitizeText(value = '') {
  return String(value || '').trim();
}

export function resolveMissionConsoleTarget(targetId = 'stephanos') {
  return MISSION_CONSOLE_TARGETS.find((entry) => entry.id === targetId) || MISSION_CONSOLE_TARGETS[0];
}

export function evaluateMissionConsoleRequest({ targetId = 'stephanos', content = '', openClawIntentType = 'run-scan' } = {}) {
  const target = resolveMissionConsoleTarget(targetId);
  const normalizedContent = sanitizeText(content);

  if (target.id !== 'openclaw') {
    return {
      accepted: true,
      target,
      blocked: false,
      reason: '',
      policy: '',
      actionId: '',
      boundedIntent: null,
    };
  }

  const matchingBlock = OPENCLAW_BLOCK_PATTERNS.find((rule) => rule.pattern.test(normalizedContent));
  if (matchingBlock && isOpenClawActionBlocked(matchingBlock.actionId)) {
    return {
      accepted: false,
      target,
      blocked: true,
      reason: `Blocked request category: ${matchingBlock.actionId}.`,
      policy: matchingBlock.policy,
      actionId: matchingBlock.actionId,
      boundedIntent: null,
    };
  }

  const boundedIntent = buildBoundedOpenClawIntent({
    intentType: openClawIntentType,
    payload: { text: normalizedContent },
  });

  if (!boundedIntent.accepted) {
    return {
      accepted: false,
      target,
      blocked: true,
      reason: boundedIntent.rejectionReason,
      policy: 'Bounded Intent Routing Policy',
      actionId: 'unsupported-openclaw-intent',
      boundedIntent,
    };
  }

  return {
    accepted: true,
    target,
    blocked: false,
    reason: '',
    policy: '',
    actionId: '',
    boundedIntent,
  };
}
