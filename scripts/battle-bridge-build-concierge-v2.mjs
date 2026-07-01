import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { buildConciergePlan, buildConciergeProofPacket, buildConciergeRoadmap, validateExactHeadMergeApproval } from '../shared/agents/battleBridgeBuildConciergeV2.mjs';

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function flagValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : '';
}

function workingTreeClean() {
  try {
    return execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim() === '';
  } catch {
    return null;
  }
}

function prFromLocalGit(prNumber) {
  const input = {
    repositoryRoot: process.cwd(),
    workingTreeClean: workingTreeClean(),
    pullRequests: [],
  };
  if (!prNumber) return input;
  try {
    const headSha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    const branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { encoding: 'utf8' }).trim();
    input.pullRequests.push({
      number: prNumber,
      title: `PR #${prNumber} candidate from local HEAD`,
      headSha,
      branch,
      state: 'UNKNOWN',
      mergeable: null,
      changedFiles: [],
      proofCommands: ['npm test'],
    });
  } catch {
    input.pullRequests.push({ number: prNumber, title: `PR #${prNumber} candidate`, proofCommands: ['npm test'] });
  }
  return input;
}

const mode = process.argv[2] || 'plan';
const inputPath = process.argv.find((arg, index) => index > 2 && !arg.startsWith('--') && process.argv[index - 1] !== '--pr' && process.argv[index - 1] !== '--head' && process.argv[index - 1] !== '--approval');
const prNumber = flagValue('--pr');
const input = inputPath ? readJson(inputPath) : prFromLocalGit(prNumber);

let packet;
if (mode === 'roadmap') packet = buildConciergeRoadmap(input);
else if (mode === 'plan') packet = buildConciergePlan(input);
else if (mode === 'proof-packet') {
  const plan = buildConciergePlan(input);
  packet = buildConciergeProofPacket({ candidate: plan.selectedCandidate, generatedArtifactsClean: false, commandResults: [] });
} else if (mode === 'validate-merge') {
  const headSha = flagValue('--head') || input.headSha;
  packet = validateExactHeadMergeApproval({ prNumber: prNumber || input.prNumber, headSha, currentHeadSha: headSha, approvalToken: flagValue('--approval') || input.approvalToken });
} else if (mode === 'prove') {
  const plan = buildConciergePlan(input);
  packet = {
    schemaVersion: `${plan.schemaVersion}.prove`,
    selectedCandidate: plan.selectedCandidate,
    finalVerdict: 'PROOF_BLOCKED_SAFE_EXECUTION_NOT_IMPLEMENTED',
    blockers: ['prove is intentionally non-mutating in V2 until isolated worktree execution and evidence capture are explicitly wired.'],
    nextOperatorAction: plan.nextOperatorAction,
  };
} else packet = { finalVerdict: 'BLOCKED_OR_UNKNOWN', blockers: [`Unknown Battle Bridge Concierge mode: ${mode}`] };

process.stdout.write(`${JSON.stringify(packet, null, 2)}\n`);
process.exit(packet.finalVerdict && /BLOCKED|UNKNOWN/.test(packet.finalVerdict) ? 1 : 0);
