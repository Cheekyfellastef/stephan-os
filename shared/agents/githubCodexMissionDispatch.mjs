import { createHash } from 'node:crypto';

export const GITHUB_CODEX_MISSION_DISPATCH_SCHEMA_VERSION = 'github-codex-mission-dispatch.v1';
const PASSIVE = /\b(improve|enhance|look into|work on|make better|fix stuff|do something)\b/i;

function text(value, fallback = '') { const out = value === null || value === undefined ? '' : String(value).trim(); return out || fallback; }
function hasActivePacket(issue = {}) { return text(issue.activeBuildPacket || issue.latestActiveBuildPacketComment || issue.comment).length > 80 && /acceptance|scope|required proof|required proofs|tests/i.test(text(issue.activeBuildPacket || issue.latestActiveBuildPacketComment || issue.comment)); }

export function intakeActiveBuildPacket(issue = {}) {
  const packet = text(issue.activeBuildPacket || issue.latestActiveBuildPacketComment || issue.comment);
  const accepted = hasActivePacket(issue);
  const passive = !accepted && PASSIVE.test(text(issue.title || issue.body || packet));
  return Object.freeze({
    schemaVersion: GITHUB_CODEX_MISSION_DISPATCH_SCHEMA_VERSION,
    issueNumber: Number.parseInt(issue.issueNumber, 10) || 0,
    packetText: accepted ? packet : '',
    ISSUE_WITH_ACTIVE_BUILD_PACKET: accepted ? 'ACCEPTED' : 'REJECTED',
    PASSIVE_GOAL_WITHOUT_PACKET: passive ? 'REJECTED' : 'NOT_APPLICABLE',
    finalVerdict: accepted ? 'ACTIVE_BUILD_PACKET_ACCEPTED' : 'ACTIVE_BUILD_PACKET_REQUIRED',
  });
}

export function generateCanonicalCodexMissionPacket(input = {}) {
  const intake = input.intake?.schemaVersion ? input.intake : intakeActiveBuildPacket(input.issue || input);
  if (intake.ISSUE_WITH_ACTIVE_BUILD_PACKET !== 'ACCEPTED') return Object.freeze({ ...intake, CODEX_MISSION_PACKET_GENERATED: false, finalVerdict: 'CODEX_MISSION_PACKET_BLOCKED' });
  const prompt = [`Codex Mission Packet V1`, `Issue: #${intake.issueNumber}`, '', intake.packetText, '', 'Safety: do not claim Codex was started unless a real dispatch receipt exists. Exact-head operator merge approval remains mandatory.'].join('\n');
  return Object.freeze({
    schemaVersion: GITHUB_CODEX_MISSION_DISPATCH_SCHEMA_VERSION,
    packetId: `codex-mission-${createHash('sha256').update(prompt).digest('hex').slice(0, 16)}`,
    issueNumber: intake.issueNumber,
    prompt,
    CODEX_MISSION_PACKET_GENERATED: true,
    MANUAL_DISPATCH_REQUIRED_EXPLICIT: input.codexDispatchToolAvailable === true ? false : true,
    NO_FAKE_CODEX_RUN_CLAIM: input.codexDispatchReceipt ? false : true,
    MERGE_APPROVAL_HELD: true,
    finalVerdict: input.codexDispatchToolAvailable === true ? 'READY_FOR_CODEX_DISPATCH_TOOL' : 'MANUAL_DISPATCH_REQUIRED',
  });
}

export function trackMissionPrStatus(input = {}) {
  const prs = Array.isArray(input.pullRequests) ? input.pullRequests : [];
  const pr = prs.find((item) => Number.parseInt(item.issueNumber, 10) === Number.parseInt(input.issueNumber, 10) || text(item.body).includes(`#${input.issueNumber}`)) || null;
  return Object.freeze({
    schemaVersion: GITHUB_CODEX_MISSION_DISPATCH_SCHEMA_VERSION,
    issueNumber: Number.parseInt(input.issueNumber, 10) || 0,
    prDiscovered: Boolean(pr),
    prNumber: pr ? Number.parseInt(pr.prNumber || pr.number, 10) || 0 : 0,
    prStatus: pr ? text(pr.status || pr.state, 'open').toLowerCase() : 'not-found',
    exactHeadOperatorMergeApprovalRequired: true,
    mergeApprovalHeld: true,
    finalVerdict: pr ? 'MISSION_PR_STATUS_TRACKED' : 'MISSION_PR_NOT_DISCOVERED',
  });
}
