import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { buildConciergePlan, buildConciergeProofPacket, buildConciergeProveBlocked, buildConciergeRoadmap, validateConciergeCommand, validateExactHeadMergeApproval } from '../shared/agents/battleBridgeBuildConciergeV2.mjs';

function readJson(filePath) { return JSON.parse(readFileSync(filePath, 'utf8')); }
function flagValue(name) { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : ''; }
function git(args, options = {}) { return execFileSync('git', args, { encoding: 'utf8', ...options }).trim(); }
function workingTreeClean(cwd = process.cwd()) { try { return git(['status', '--porcelain'], { cwd }) === ''; } catch { return null; } }
function normalizeCommand(command) { return String(command || '').trim().replace(/\s+/g, ' '); }

function prFromLocalGit(prNumber) {
  const input = { repositoryRoot: process.cwd(), workingTreeClean: workingTreeClean(), pullRequests: [] };
  if (!prNumber) return input;
  try {
    const headSha = git(['rev-parse', 'HEAD']);
    const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']);
    input.pullRequests.push({ number: prNumber, title: `PR #${prNumber} candidate from local HEAD`, headSha, branch, state: 'UNKNOWN', mergeable: null, changedFiles: [], proofCommands: ['npm run stephanos:build'] });
  } catch {
    input.pullRequests.push({ number: prNumber, title: `PR #${prNumber} candidate`, proofCommands: ['npm run stephanos:build'] });
  }
  return input;
}

function commandToShell(command) {
  const normalized = normalizeCommand(command);
  if (!validateConciergeCommand(normalized).allowed) return null;
  return normalized.split(' ');
}

function createProofWorktree(repoRoot, headSha) {
  const parent = mkdtempSync(path.join(tmpdir(), 'stephanos-battle-bridge-proof-'));
  const worktreePath = path.join(parent, 'worktree');
  git(['worktree', 'add', '--detach', worktreePath, headSha], { cwd: repoRoot });
  return { parent, worktreePath };
}

function cleanupGeneratedArtifacts(cwd) {
  // Remove generated dist output from the isolated worktree only. Source truth remains untouched.
  spawnSync('npm', ['run', 'stephanos:clean'], { cwd, encoding: 'utf8' });
  const status = workingTreeClean(cwd);
  return status === true;
}

function runProve(input) {
  const plan = buildConciergePlan(input);
  const initialBlockers = [...(plan.blockers || [])];
  if (input.workingTreeClean !== true) initialBlockers.push('Dirty-tree blocks prove; clean or stash intentionally before local proof.');
  if (plan.finalVerdict !== 'READY_TO_START_LOCAL_PROOF') initialBlockers.push('PR context is blocked or unknown; prove cannot run unsafe or unknown candidates.');
  const candidate = plan.selectedCandidate;
  for (const command of candidate?.proofCommands || []) {
    const validation = validateConciergeCommand(command);
    if (!validation.allowed) initialBlockers.push(validation.blocker);
  }
  if (initialBlockers.length) return buildConciergeProveBlocked({ plan, blockers: initialBlockers });

  const repoRoot = input.repositoryRoot || process.cwd();
  let worktree;
  const commandResults = [];
  try {
    worktree = createProofWorktree(repoRoot, candidate.headSha);
    for (const command of candidate.proofCommands) {
      const argv = commandToShell(command);
      if (!argv) return buildConciergeProveBlocked({ plan, blockers: [`Command is outside the Battle Bridge allowlist: ${command}`], worktreePath: worktree.worktreePath, commandResults });
      const result = spawnSync(argv[0], argv.slice(1), { cwd: worktree.worktreePath, encoding: 'utf8' });
      const evidencePath = path.join(worktree.worktreePath, `.battle-bridge-proof-${commandResults.length + 1}.log`);
      writeFileSync(evidencePath, `$ ${command}\nexitCode=${result.status ?? 1}\n\nSTDOUT\n${result.stdout || ''}\n\nSTDERR\n${result.stderr || ''}`);
      commandResults.push({ command, exitCode: result.status ?? 1, evidencePath });
      if ((result.status ?? 1) !== 0) break;
    }
    const generatedArtifactsClean = cleanupGeneratedArtifacts(worktree.worktreePath);
    return buildConciergeProofPacket({ candidate, worktreePath: worktree.worktreePath, commandResults, generatedArtifactsClean });
  } catch (error) {
    return buildConciergeProveBlocked({ plan, blockers: [`Unsafe proof context blocked truthfully: ${error.message}`], worktreePath: worktree?.worktreePath || '', commandResults });
  } finally {
    if (worktree?.worktreePath) spawnSync('git', ['worktree', 'remove', '--force', worktree.worktreePath], { cwd: repoRoot, encoding: 'utf8' });
    if (worktree?.parent) rmSync(worktree.parent, { recursive: true, force: true });
  }
}

const mode = process.argv[2] || 'plan';
const inputPath = process.argv.find((arg, index) => index > 2 && !arg.startsWith('--') && !['--pr', '--head', '--approval'].includes(process.argv[index - 1]));
const prNumber = flagValue('--pr');
const input = inputPath ? readJson(inputPath) : prFromLocalGit(prNumber);

let packet;
if (mode === 'roadmap') packet = buildConciergeRoadmap(input);
else if (mode === 'plan') packet = buildConciergePlan(input);
else if (mode === 'proof-packet') { const plan = buildConciergePlan(input); packet = buildConciergeProofPacket({ candidate: plan.selectedCandidate, generatedArtifactsClean: false, commandResults: [] }); }
else if (mode === 'validate-merge') { const headSha = flagValue('--head') || input.headSha; packet = validateExactHeadMergeApproval({ prNumber: prNumber || input.prNumber, headSha, currentHeadSha: headSha, approvalToken: flagValue('--approval') || input.approvalToken }); }
else if (mode === 'prove') packet = runProve(input);
else packet = { finalVerdict: 'BLOCKED_OR_UNKNOWN', blockers: [`Unknown Battle Bridge Concierge mode: ${mode}`] };

process.stdout.write(`${JSON.stringify(packet, null, 2)}\n`);
process.exit(packet.finalVerdict && /BLOCKED|UNKNOWN/.test(packet.finalVerdict) ? 1 : 0);
