import { createHash } from 'node:crypto';
import {
  APPROVAL_BOUNDARY_BOOTSTRAP_FINDING_CODE,
  PROTECTED_WORKFLOW_SOURCE_MAX_BYTES,
  PROTECTED_WORKFLOW_SOURCE_SCHEMA_VERSION,
  analyzeIndependentSecurityReview,
} from './operatorMergeApprovalGate.mjs';

const PERSONAL_REPOSITORY_WORKFLOW_PATH = '.github/workflows/operator-merge-approval-gate.yml';
const PERSONAL_REPOSITORY_WORKFLOW_CONTENT_SHA256 = '99f1db1892ec1dc57fa5d7a578ed9b411a1fcc3e04eb0a823794da10246bebcb';
const PERSONAL_REPOSITORY_WORKFLOW_SOURCE_KEYS = Object.freeze([
  'schemaVersion',
  'repository',
  'path',
  'ref',
  'exists',
  'size',
  'blobSha',
  'content',
]);
const PERSONAL_REPOSITORY_WORKFLOW_EVENTS = Object.freeze(['merge_group', 'workflow_dispatch']);
const PERSONAL_REPOSITORY_WORKFLOW_INPUTS = Object.freeze([
  'mode',
  'pr_number',
  'expected_branch',
  'expected_head',
  'expected_head_tree',
  'expected_base',
  'independent_review_run_id',
  'independent_review_run_attempt',
  'independent_review_artifact_id',
  'independent_review_artifact_digest',
  'independent_review_payload_sha256',
]);
const PERSONAL_REPOSITORY_WORKFLOW_CHECKOUT_REFS = Object.freeze([
  Object.freeze({ expression: 'github\\.event\\.merge_group\\.base_sha', count: 2 }),
  Object.freeze({ expression: 'github\\.sha', count: 3 }),
]);
const PERSONAL_REPOSITORY_WORKFLOW_PERMISSIONS = Object.freeze([
  'actions:read,checks:read,contents:read,pull-requests:read',
  'actions:read,checks:read,contents:read,pull-requests:read',
  'actions:read,checks:read,contents:read,deployments:read,pull-requests:read',
  'actions:read,checks:read,contents:read,deployments:read,pull-requests:read',
  'actions:read,checks:read,contents:write,deployments:read,issues:write,pull-requests:write',
]);
const PERSONAL_REPOSITORY_WORKFLOW_JOB_STEPS = Object.freeze([
  Object.freeze({
    jobName: 'merge-group-evidence',
    steps: Object.freeze([
      Object.freeze({ executableKey: 'uses', executableValue: 'actions/checkout@v4' }),
      Object.freeze({ executableKey: 'uses', executableValue: 'actions/setup-node@v4' }),
      Object.freeze({ executableKey: 'run', executableValue: 'node scripts/operator-protected-merge-gate-v2.mjs evidence' }),
    ]),
  }),
  Object.freeze({
    jobName: 'operator-merge-queue-boundary',
    steps: Object.freeze([
      Object.freeze({ executableKey: 'uses', executableValue: 'actions/checkout@v4' }),
      Object.freeze({ executableKey: 'uses', executableValue: 'actions/setup-node@v4' }),
      Object.freeze({ executableKey: 'run', executableValue: 'node scripts/operator-protected-merge-gate-v2.mjs approve' }),
    ]),
  }),
  Object.freeze({
    jobName: 'personal-repository-evidence',
    steps: Object.freeze([
      Object.freeze({ executableKey: 'uses', executableValue: 'actions/checkout@v4' }),
      Object.freeze({ executableKey: 'uses', executableValue: 'actions/setup-node@v4' }),
      Object.freeze({ executableKey: 'uses', executableValue: 'actions/create-github-app-token@v2' }),
      Object.freeze({ executableKey: 'run', executableValue: 'node scripts/operator-protected-personal-repository-merge.mjs evidence' }),
    ]),
  }),
  Object.freeze({
    jobName: 'operator-personal-repository-approval',
    steps: Object.freeze([
      Object.freeze({ executableKey: 'uses', executableValue: 'actions/checkout@v4' }),
      Object.freeze({ executableKey: 'uses', executableValue: 'actions/setup-node@v4' }),
      Object.freeze({ executableKey: 'uses', executableValue: 'actions/create-github-app-token@v2' }),
      Object.freeze({ executableKey: 'run', executableValue: 'node scripts/operator-protected-personal-repository-merge.mjs approve' }),
    ]),
  }),
  Object.freeze({
    jobName: 'operator-personal-repository-squash-merge',
    steps: Object.freeze([
      Object.freeze({ executableKey: 'uses', executableValue: 'actions/checkout@v4' }),
      Object.freeze({ executableKey: 'uses', executableValue: 'actions/setup-node@v4' }),
      Object.freeze({ executableKey: 'uses', executableValue: 'actions/create-github-app-token@v2' }),
      Object.freeze({ executableKey: 'run', executableValue: 'node scripts/operator-protected-personal-repository-merge.mjs merge' }),
    ]),
  }),
]);
const WORKFLOW_STEP_KEYS = Object.freeze({
  uses: Object.freeze(['id', 'name', 'uses', 'with']),
  run: Object.freeze(['env', 'id', 'name', 'run']),
});
const PERSONAL_REPOSITORY_EVIDENCE_ENV = Object.freeze([
  Object.freeze(['GH_TOKEN', '${{ github.token }}']),
  Object.freeze(['STEPHANOS_RULESET_PROOF_TOKEN', '${{ steps.ruleset-proof-token.outputs.token }}']),
]);
const PERSONAL_REPOSITORY_APPROVAL_ENV = Object.freeze([
  Object.freeze(['GH_TOKEN', '${{ github.token }}']),
  Object.freeze(['STEPHANOS_RULESET_PROOF_TOKEN', '${{ steps.ruleset-proof-token.outputs.token }}']),
  Object.freeze(['STEPHANOS_EXPECTED_REPOSITORY', '${{ needs.personal-repository-evidence.outputs.repository }}']),
  Object.freeze(['STEPHANOS_EXPECTED_PR_NUMBER', '${{ needs.personal-repository-evidence.outputs.pr_number }}']),
  Object.freeze(['STEPHANOS_EXPECTED_BRANCH', '${{ needs.personal-repository-evidence.outputs.branch }}']),
  Object.freeze(['STEPHANOS_EXPECTED_SOURCE_HEAD', '${{ needs.personal-repository-evidence.outputs.source_head }}']),
  Object.freeze(['STEPHANOS_EXPECTED_SOURCE_TREE', '${{ needs.personal-repository-evidence.outputs.source_tree }}']),
  Object.freeze(['STEPHANOS_EXPECTED_BASE_SHA', '${{ needs.personal-repository-evidence.outputs.base_sha }}']),
  Object.freeze(['STEPHANOS_EXPECTED_WORKFLOW_RUN_ID', '${{ needs.personal-repository-evidence.outputs.workflow_run_id }}']),
  Object.freeze(['STEPHANOS_EXPECTED_WORKFLOW_RUN_ATTEMPT', '${{ needs.personal-repository-evidence.outputs.workflow_run_attempt }}']),
  Object.freeze(['STEPHANOS_EXPECTED_EVIDENCE_SHA256', '${{ needs.personal-repository-evidence.outputs.evidence_sha256 }}']),
]);
const SHA40 = /^[a-f0-9]{40}$/;

export const APPROVAL_BOUNDARY_PATHS_V2 = Object.freeze([
  '.github/workflows/operator-merge-approval-gate.yml',
  '.github/workflows/independent-merge-security-review.yml',
  '.github/workflows/build-stephanos-ui.yml',
  '.github/workflows/pr-clean.yml',
  '.github/workflows/exact-head-review-dispatch.yml',
  '.github/workflows/battle-bridge-publisher-proof.yml',
  '.github/workflows/codex-dispatch-queue-proof.yml',
  '.github/workflows/openclaw-github-operator.yml',
  '.github/workflows/operator-merge-approval-gate-test.yml',
  '.github/workflows/stephanos-deploy.yml',
  'scripts/operator-protected-merge-gate-v2.mjs',
  'scripts/operator-protected-personal-repository-merge.mjs',
  'scripts/independent-merge-security-review-v2.mjs',
  'shared/agents/operatorMergeApprovalGate.mjs',
  'shared/agents/operatorMergeApprovalGateV2.mjs',
  'shared/agents/operatorMergeApprovalBoundaryV2.mjs',
  'shared/agents/operatorMergeBaseBindingV1.mjs',
  'shared/agents/operatorMergeReviewArtifactV1.mjs',
  'shared/agents/operatorPersonalRepositoryMergeV1.mjs',
  'shared/agents/protectedOpenClawMergeMailboxAdapter.mjs',
  'shared/agents/providerNeutralReviewV1.mjs',
  'shared/agents/qualifiedSpecialistReviewV1.mjs',
]);

export const WINDOWS_AUTHORITY_SPECIALIST_BOUNDARY_PATHS_V1 = Object.freeze([
  'scripts/independent-merge-security-review-with-windows-specialist-v1.mjs',
  'shared/agents/windowsAuthorityIgnitionConvergenceReviewV1.mjs',
  'shared/agents/windowsAuthorityMissionWorkerCleanupReviewV1.mjs',
  'shared/agents/windowsAuthorityWorkerWatchdogReviewV1.mjs',
  'shared/agents/windowsAuthoritySpecialistReviewV1.mjs',
]);

const ALL_APPROVAL_BOUNDARY_PATHS_V2 = Object.freeze([
  ...APPROVAL_BOUNDARY_PATHS_V2,
  ...WINDOWS_AUTHORITY_SPECIALIST_BOUNDARY_PATHS_V1,
]);

const OPERATOR_EXECUTOR_PATHS = Object.freeze([
  'scripts/operator-protected-merge-gate-v2.mjs',
  'scripts/operator-protected-personal-repository-merge.mjs',
]);

const INDEPENDENT_REVIEWER_PATHS = Object.freeze([
  'scripts/independent-merge-security-review-v2.mjs',
  'scripts/independent-merge-security-review-with-windows-specialist-v1.mjs',
]);

const BASE_BINDING_PATHS = Object.freeze([
  'shared/agents/operatorMergeBaseBindingV1.mjs',
  'shared/agents/operatorPersonalRepositoryMergeV1.mjs',
]);

function text(value) {
  return String(value ?? '').trim();
}

function unique(values) {
  return [...new Set(values)];
}

function sameKeys(candidate, expectedKeys) {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return false;
  const keys = Object.keys(candidate).sort();
  const expected = [...expectedKeys].sort();
  return keys.length === expected.length && keys.every((key, index) => key === expected[index]);
}

function gitBlobSha(content) {
  const bytes = Buffer.from(content, 'utf8');
  return createHash('sha1')
    .update(`blob ${bytes.length}\0`, 'utf8')
    .update(bytes)
    .digest('hex');
}

function indentation(line) {
  return line.match(/^ */)?.[0].length ?? 0;
}

function yamlEventKeys(source) {
  const lines = String(source).split(/\r?\n/);
  const onIndexes = lines
    .map((line, index) => (/^on:\s*$/.test(line) ? index : -1))
    .filter((index) => index >= 0);
  if (onIndexes.length !== 1) return [];
  const keys = [];
  for (let index = onIndexes[0] + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    if (indentation(line) === 0) break;
    const directKey = line.match(/^ {2}([a-zA-Z0-9_-]+):(?:\s.*)?$/);
    if (directKey) keys.push(directKey[1]);
  }
  return keys;
}

function yamlWorkflowDispatchInputKeys(source) {
  const lines = String(source).split(/\r?\n/);
  const dispatchIndex = lines.findIndex((line) => /^ {2}workflow_dispatch:\s*$/.test(line));
  if (dispatchIndex < 0) return [];
  const inputsIndex = lines.findIndex((line, index) => index > dispatchIndex && /^ {4}inputs:\s*$/.test(line));
  if (inputsIndex < 0) return [];
  const keys = [];
  for (let index = inputsIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    if (indentation(line) <= 4) break;
    const directKey = line.match(/^ {6}([a-zA-Z0-9_-]+):\s*$/);
    if (directKey) keys.push(directKey[1]);
  }
  return keys;
}

function yamlWorkflowDispatchInputBlocks(source) {
  const lines = String(source).split(/\r?\n/);
  const keys = yamlWorkflowDispatchInputKeys(source);
  return keys.map((key) => {
    const start = lines.findIndex((line) => line === `      ${key}:`);
    let end = start + 1;
    while (end < lines.length && (!lines[end].trim() || indentation(lines[end]) > 6)) end += 1;
    return Object.freeze({ key, lines: Object.freeze(lines.slice(start + 1, end)) });
  });
}

function checkoutBlocks(source) {
  const lines = String(source).split(/\r?\n/);
  const blocks = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (!/^\s*uses:\s*actions\/checkout@/.test(lines[index])) continue;
    const usesIndent = indentation(lines[index]);
    let end = index + 1;
    while (end < lines.length) {
      const candidate = lines[end];
      if (candidate.trim() && !candidate.trimStart().startsWith('#')
        && indentation(candidate) < usesIndent) break;
      end += 1;
    }
    blocks.push(Object.freeze({
      uses: lines[index].trim(),
      lines: Object.freeze(lines.slice(index, end)),
      usesIndent,
    }));
  }
  return Object.freeze(blocks);
}

function yamlJobBlock(source, jobName) {
  const lines = String(source).split(/\r?\n/);
  const starts = lines
    .map((line, index) => (line === `  ${jobName}:` ? index : -1))
    .filter((index) => index >= 0);
  if (starts.length !== 1) return '';
  let end = starts[0] + 1;
  while (end < lines.length && !/^ {2}[a-zA-Z0-9_-]+:\s*$/.test(lines[end])) end += 1;
  return lines.slice(starts[0], end).join('\n');
}

function yamlJobNames(source) {
  const lines = String(source).split(/\r?\n/);
  const jobsIndexes = lines
    .map((line, index) => (line === 'jobs:' ? index : -1))
    .filter((index) => index >= 0);
  if (jobsIndexes.length !== 1) return Object.freeze([]);
  const names = [];
  let observedJob = false;
  for (let index = jobsIndexes[0] + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    const indent = indentation(line);
    if (indent === 0) break;
    if (indent < 2 || indent % 2 !== 0 || (indent > 2 && !observedJob)) {
      return Object.freeze(['__invalid-job-mapping__']);
    }
    const job = line.match(/^ {2}(?:"([^"]+)"|'([^']+)'|([a-zA-Z0-9_-]+)):\s*$/);
    if (indent === 2 && !job) return Object.freeze(['__invalid-job-mapping__']);
    if (job) {
      names.push(job[1] ?? job[2] ?? job[3]);
      observedJob = true;
    }
  }
  return Object.freeze(names);
}

function yamlHasInheritedEnvironment(source) {
  return String(source).split(/\r?\n/).some((line) => (
    /^(?:env|"env"|'env')\s*:/.test(line)
    || /^ {4}(?:env|"env"|'env')\s*:/.test(line)
  ));
}

function yamlHasForbiddenExecutionContext(source) {
  const forbiddenJobKeys = new Set([
    'container', 'continue-on-error', 'defaults', 'env', 'services', 'strategy',
    'uses', 'with', 'secrets', 'concurrency',
  ]);
  return String(source).split(/\r?\n/).some((line) => {
    const workflowKey = line.match(/^(?:"([^"]+)"|'([^']+)'|([a-zA-Z0-9_-]+))\s*:/);
    const jobKey = line.match(/^ {4}(?:"([^"]+)"|'([^']+)'|([a-zA-Z0-9_-]+))\s*:/);
    const workflowName = workflowKey && (workflowKey[1] ?? workflowKey[2] ?? workflowKey[3]);
    const jobName = jobKey && (jobKey[1] ?? jobKey[2] ?? jobKey[3]);
    return workflowName === 'defaults' || workflowName === 'env'
      || (jobName && forbiddenJobKeys.has(jobName));
  });
}

function jobHasExactNeeds(source, jobName, expectedValue) {
  const job = yamlJobBlock(source, jobName);
  const needs = job.split(/\r?\n/).filter((line) => /^ {4}needs\s*:/.test(line));
  return needs.length === 1 && needs[0] === `    needs: ${expectedValue}`;
}

function jobHasExactScalar(source, jobName, key, expectedValue) {
  const job = yamlJobBlock(source, jobName);
  const entries = job.split(/\r?\n/).filter((line) => line.startsWith(`    ${key}:`));
  return entries.length === 1 && entries[0] === `    ${key}: ${expectedValue}`;
}

function jobHasExactEnvironment(source, jobName, expectedName = '') {
  const lines = yamlJobBlock(source, jobName).split(/\r?\n/);
  const starts = lines
    .map((line, index) => (line === '    environment:' ? index : -1))
    .filter((index) => index >= 0);
  if (!expectedName) return starts.length === 0;
  if (starts.length !== 1) return false;
  const entries = [];
  for (let index = starts[0] + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    if (indentation(line) <= 4) break;
    entries.push(line);
  }
  return entries.length === 1 && entries[0] === `      name: ${expectedName}`;
}

function yamlJobSteps(source, jobName) {
  const job = yamlJobBlock(source, jobName);
  if (!job) return Object.freeze({ valid: false, steps: Object.freeze([]) });
  const lines = job.split(/\r?\n/);
  const stepsIndexes = lines
    .map((line, index) => (line === '    steps:' ? index : -1))
    .filter((index) => index >= 0);
  if (stepsIndexes.length !== 1) return Object.freeze({ valid: false, steps: Object.freeze([]) });

  const stepLines = [];
  for (let index = stepsIndexes[0] + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.trim() && !line.trimStart().startsWith('#') && indentation(line) <= 4) break;
    stepLines.push(line);
  }

  const blocks = [];
  let current = null;
  let valid = true;
  for (const line of stepLines) {
    if (!line.trim() || line.trimStart().startsWith('#')) {
      if (current) current.push(line);
      continue;
    }
    if (/^ {6}-\s+/.test(line)) {
      current = [line];
      blocks.push(current);
      continue;
    }
    if (!current || indentation(line) <= 6) {
      valid = false;
      continue;
    }
    current.push(line);
  }

  const steps = blocks.map((block) => {
    const entries = [];
    const first = block[0].match(/^ {6}- ([a-zA-Z0-9_-]+):(?:\s*(.*))?$/);
    if (!first) {
      valid = false;
      return Object.freeze({ entries: Object.freeze([]) });
    }
    entries.push(Object.freeze({ key: first[1], value: first[2] ?? '' }));
    for (const line of block.slice(1)) {
      if (!line.trim() || line.trimStart().startsWith('#') || indentation(line) > 8) continue;
      const entry = line.match(/^ {8}([a-zA-Z0-9_-]+):(?:\s*(.*))?$/);
      if (!entry) {
        valid = false;
        continue;
      }
      entries.push(Object.freeze({ key: entry[1], value: entry[2] ?? '' }));
    }
    return Object.freeze({
      entries: Object.freeze(entries),
      lines: Object.freeze([...block]),
    });
  });

  return Object.freeze({ valid, steps: Object.freeze(steps) });
}

function yamlStepNestedMapping(step, mappingKey) {
  if (!step?.lines) return Object.freeze({ valid: false, entries: Object.freeze([]) });
  const starts = step.lines
    .map((line, index) => (line === `        ${mappingKey}:` ? index : -1))
    .filter((index) => index >= 0);
  if (starts.length !== 1) return Object.freeze({ valid: false, entries: Object.freeze([]) });

  const entries = [];
  let valid = true;
  for (let index = starts[0] + 1; index < step.lines.length; index += 1) {
    const line = step.lines[index];
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    if (indentation(line) <= 8) break;
    const entry = line.match(/^ {10}(?:"([^"]+)"|'([^']+)'|([a-zA-Z0-9_-]+)):(?:\s*(.*))?$/);
    if (!entry) {
      valid = false;
      continue;
    }
    entries.push(Object.freeze({ key: entry[1] ?? entry[2] ?? entry[3], value: entry[4] ?? '' }));
  }
  if (new Set(entries.map((entry) => entry.key)).size !== entries.length) valid = false;
  return Object.freeze({ valid, entries: Object.freeze(entries) });
}

function stepHasExactEntries(step, expectedEntries) {
  if (!step || step.entries.length !== expectedEntries.length) return false;
  const observed = new Map(step.entries.map((entry) => [entry.key, entry.value]));
  return observed.size === expectedEntries.length
    && expectedEntries.every(([key, value]) => observed.get(key) === value);
}

function personalRepositoryRulesetProofTokenForJobIsExact(source, jobName) {
  const parsed = yamlJobSteps(source, jobName);
  if (!parsed.valid) return false;
  const mintSteps = parsed.steps.filter((step) => (
    step.entries.some((entry) => entry.key === 'uses'
      && entry.value === 'actions/create-github-app-token@v2')
  ));
  if (mintSteps.length !== 1 || !stepHasExactEntries(mintSteps[0], [
    ['name', 'Mint exact GET-only configuration proof token'],
    ['id', 'ruleset-proof-token'],
    ['uses', 'actions/create-github-app-token@v2'],
    ['with', ''],
  ])) return false;

  const withMapping = yamlStepNestedMapping(mintSteps[0], 'with');
  const expectedWith = [
    ['app-id', '${{ secrets.STEPHANOS_RULESET_PROOF_APP_ID }}'],
    ['private-key', '${{ secrets.STEPHANOS_RULESET_PROOF_APP_PRIVATE_KEY }}'],
    ['owner', '${{ github.repository_owner }}'],
    ['repositories', 'stephan-os'],
    ['permission-administration', 'write'],
  ];
  return withMapping.valid
    && withMapping.entries.length === expectedWith.length
    && stepHasExactEntries({ entries: withMapping.entries }, expectedWith);
}

function personalRepositoryRulesetProofTokenIsExact(source) {
  return [
    'personal-repository-evidence',
    'operator-personal-repository-approval',
    'operator-personal-repository-squash-merge',
  ].every((jobName) => personalRepositoryRulesetProofTokenForJobIsExact(source, jobName));
}

function personalRepositoryProtectedStageSequenceIsExact(source) {
  return jobHasExactNeeds(source, 'operator-personal-repository-approval', '[personal-repository-evidence]')
    && jobHasExactNeeds(source, 'operator-personal-repository-squash-merge', '[personal-repository-evidence, operator-personal-repository-approval]')
    && jobHasExactEnvironment(source, 'personal-repository-evidence', 'operator-merge-approval')
    && jobHasExactEnvironment(source, 'operator-personal-repository-approval', 'operator-merge-approval')
    && jobHasExactEnvironment(source, 'operator-personal-repository-squash-merge', 'operator-merge-approval')
    && source.includes('      - name: Collect exact personal-repository evidence after protected admission')
    && source.includes('      - name: Re-prove immutable evidence after protected approval')
    && source.includes('      - name: Re-prove, squash exact head and publish the bounded receipt')
    && !/personal-repository evidence before protected approval|PERSONAL_REPOSITORY_EVIDENCE_READY_BEFORE_PROTECTED_ENVIRONMENT|Pre-environment personal-repository evidence/u.test(source);
}

function personalRepositoryRulesetProofTokenIsBound(source) {
  const expectedJobNames = PERSONAL_REPOSITORY_WORKFLOW_JOB_STEPS.map((policy) => policy.jobName);
  const jobNames = yamlJobNames(source);
  if (jobNames.length !== expectedJobNames.length
    || [...jobNames].sort().some((jobName, index) => jobName !== [...expectedJobNames].sort()[index])) return false;
  if (yamlHasInheritedEnvironment(source)
    || yamlHasForbiddenExecutionContext(source)
    || !jobHasExactNeeds(source, 'operator-merge-queue-boundary', '[merge-group-evidence]')
    || !jobHasExactNeeds(source, 'operator-personal-repository-approval', '[personal-repository-evidence]')
    || !jobHasExactNeeds(source, 'operator-personal-repository-squash-merge', '[personal-repository-evidence, operator-personal-repository-approval]')
    || !jobHasExactEnvironment(source, 'merge-group-evidence')
    || !jobHasExactEnvironment(source, 'operator-merge-queue-boundary', 'operator-merge-approval')
    || !jobHasExactEnvironment(source, 'personal-repository-evidence', 'operator-merge-approval')
    || !jobHasExactEnvironment(source, 'operator-personal-repository-approval', 'operator-merge-approval')
    || !jobHasExactEnvironment(source, 'operator-personal-repository-squash-merge', 'operator-merge-approval')
    || expectedJobNames.some((jobName) => (
      !jobHasExactScalar(source, jobName, 'runs-on', 'ubuntu-latest')
      || !jobHasExactScalar(source, jobName, 'timeout-minutes', '20')
    ))) return false;
  const parsed = yamlJobSteps(source, 'operator-personal-repository-approval');
  if (!parsed.valid) return false;
  const evidenceParsed = yamlJobSteps(source, 'personal-repository-evidence');
  if (!evidenceParsed.valid) return false;
  const evidenceSteps = evidenceParsed.steps.filter((step) => (
    step.entries.some((entry) => entry.key === 'run'
      && entry.value === 'node scripts/operator-protected-personal-repository-merge.mjs evidence')
  ));
  if (evidenceSteps.length !== 1 || !stepHasExactEntries(evidenceSteps[0], [
    ['name', 'Collect exact personal-repository evidence after protected admission'],
    ['id', 'evidence'],
    ['env', ''],
    ['run', 'node scripts/operator-protected-personal-repository-merge.mjs evidence'],
  ])) return false;
  const evidenceEnvMapping = yamlStepNestedMapping(evidenceSteps[0], 'env');
  if (!evidenceEnvMapping.valid
    || evidenceEnvMapping.entries.length !== PERSONAL_REPOSITORY_EVIDENCE_ENV.length
    || !stepHasExactEntries({ entries: evidenceEnvMapping.entries }, PERSONAL_REPOSITORY_EVIDENCE_ENV)) return false;
  const approvalSteps = parsed.steps.filter((step) => (
    step.entries.some((entry) => entry.key === 'run'
      && entry.value === 'node scripts/operator-protected-personal-repository-merge.mjs approve')
  ));
  if (approvalSteps.length !== 1 || !stepHasExactEntries(approvalSteps[0], [
    ['name', 'Re-prove immutable evidence after protected approval'],
    ['id', 'approval'],
    ['env', ''],
    ['run', 'node scripts/operator-protected-personal-repository-merge.mjs approve'],
  ])) return false;
  const envMapping = yamlStepNestedMapping(approvalSteps[0], 'env');
  if (!envMapping.valid
    || envMapping.entries.length !== PERSONAL_REPOSITORY_APPROVAL_ENV.length
    || !stepHasExactEntries({ entries: envMapping.entries }, PERSONAL_REPOSITORY_APPROVAL_ENV)) return false;

  const tokenBindings = [];
  for (const jobName of jobNames) {
    const job = yamlJobSteps(source, jobName);
    if (!job.valid) return false;
    for (const step of job.steps) {
      const envEntries = step.entries.filter((entry) => entry.key === 'env');
      if (envEntries.length === 0) continue;
      if (envEntries.length !== 1) return false;
      const mapping = yamlStepNestedMapping(step, 'env');
      if (!mapping.valid) return false;
      tokenBindings.push(...mapping.entries.filter((entry) => entry.key === 'STEPHANOS_RULESET_PROOF_TOKEN'));
    }
  }
  return tokenBindings.length === 3
    && tokenBindings.every((binding) => (
      binding.value === '${{ steps.ruleset-proof-token.outputs.token }}'
    ));
}

function jobHasExactExecutionSteps(source, policy) {
  const parsed = yamlJobSteps(source, policy.jobName);
  if (!parsed.valid || parsed.steps.length !== policy.steps.length) return false;
  return parsed.steps.every((step, index) => {
    const expected = policy.steps[index];
    const executableEntries = step.entries.filter((entry) => entry.key === 'uses' || entry.key === 'run');
    const allowedKeys = WORKFLOW_STEP_KEYS[expected.executableKey];
    return executableEntries.length === 1
      && executableEntries[0].key === expected.executableKey
      && executableEntries[0].value === expected.executableValue
      && step.entries.every((entry) => allowedKeys.includes(entry.key))
      && new Set(step.entries.map((entry) => entry.key)).size === step.entries.length;
  });
}

function permissionSignatures(source, { requireTopLevelEmpty = true } = {}) {
  const lines = String(source).split(/\r?\n/);
  const signatures = [];
  let topLevelEmptyCount = 0;
  let invalid = false;
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/^( *)permissions:\s*(.*?)\s*$/);
    if (!match) continue;
    const permissionIndent = match[1].length;
    const inline = match[2];
    if (permissionIndent === 0 && inline === '{}') {
      topLevelEmptyCount += 1;
      continue;
    }
    if (permissionIndent === 0 || inline) {
      invalid = true;
      continue;
    }
    const entries = [];
    for (let child = index + 1; child < lines.length; child += 1) {
      const line = lines[child];
      if (!line.trim() || line.trimStart().startsWith('#')) continue;
      const childIndent = indentation(line);
      if (childIndent <= permissionIndent) break;
      const entry = line.match(new RegExp(`^ {${permissionIndent + 2}}([a-z][a-z-]*):\\s*(read|write|none)\\s*$`));
      if (!entry) {
        invalid = true;
        continue;
      }
      entries.push(`${entry[1]}:${entry[2]}`);
    }
    if (!entries.length || new Set(entries).size !== entries.length) invalid = true;
    signatures.push(entries.sort().join(','));
  }
  return Object.freeze({
    valid: !invalid && (!requireTopLevelEmpty || topLevelEmptyCount === 1),
    signatures: Object.freeze(signatures.sort()),
  });
}

function jobUsesExactCheckout(source, jobName, refExpression) {
  const job = yamlJobBlock(source, jobName);
  const checkouts = checkoutBlocks(job);
  if (!job || checkouts.length !== 1) return false;
  const checkout = checkouts[0];
  const refPattern = new RegExp(`^ {${checkout.usesIndent + 2}}ref:\\s*\\$\\{\\{\\s*${refExpression}\\s*\\}\\}\\s*$`);
  const persistPattern = new RegExp(`^ {${checkout.usesIndent + 2}}persist-credentials:\\s*false\\s*$`);
  return checkout.uses === 'uses: actions/checkout@v4'
    && checkout.lines.filter((line) => refPattern.test(line)).length === 1
    && checkout.lines.filter((line) => persistPattern.test(line)).length === 1;
}

export function validatePersonalRepositoryProtectedWorkflowSource(input = {}) {
  const changedFiles = (Array.isArray(input.changedFiles) ? input.changedFiles : [])
    .flatMap(changedFilePaths)
    .filter(Boolean);
  if (!changedFiles.includes(PERSONAL_REPOSITORY_WORKFLOW_PATH)) {
    return Object.freeze({ valid: false, blockers: Object.freeze(['personal-repository-workflow-not-changed']) });
  }
  const sources = (Array.isArray(input.protectedWorkflowSources) ? input.protectedWorkflowSources : [])
    .filter((source) => source?.path === PERSONAL_REPOSITORY_WORKFLOW_PATH);
  if (sources.length !== 1) {
    return Object.freeze({ valid: false, blockers: Object.freeze(['personal-repository-workflow-source-count-mismatch']) });
  }
  const source = sources[0];
  const content = typeof source?.content === 'string' ? source.content : '';
  const size = Buffer.byteLength(content, 'utf8');
  const blockers = [];
  const canonicalContent = content.replace(/\n+$/u, '\n');
  if (createHash('sha256').update(canonicalContent, 'utf8').digest('hex') !== PERSONAL_REPOSITORY_WORKFLOW_CONTENT_SHA256) {
    blockers.push('personal-repository-workflow-content-digest-not-exact');
  }
  if (!sameKeys(source, PERSONAL_REPOSITORY_WORKFLOW_SOURCE_KEYS)
    || source.schemaVersion !== PROTECTED_WORKFLOW_SOURCE_SCHEMA_VERSION
    || source.repository !== input.repository
    || source.path !== PERSONAL_REPOSITORY_WORKFLOW_PATH
    || !SHA40.test(text(input.sourceHead).toLowerCase())
    || source.ref !== text(input.sourceHead).toLowerCase()
    || source.exists !== true
    || !Number.isSafeInteger(source.size)
    || source.size !== size
    || size <= 0
    || size > PROTECTED_WORKFLOW_SOURCE_MAX_BYTES
    || !/^[a-f0-9]{40}$/.test(text(source.blobSha).toLowerCase())
    || source.blobSha !== gitBlobSha(content)) {
    blockers.push('personal-repository-workflow-source-identity-invalid');
  }
  const events = yamlEventKeys(content);
  if (events.length !== PERSONAL_REPOSITORY_WORKFLOW_EVENTS.length
    || events.some((event, index) => event !== PERSONAL_REPOSITORY_WORKFLOW_EVENTS[index])) {
    blockers.push('personal-repository-workflow-trigger-not-exact');
  }
  if (!/^ {4}types:\s*\[checks_requested\]\s*$/m.test(content)) {
    blockers.push('personal-repository-workflow-merge-group-action-not-exact');
  }
  const inputs = yamlWorkflowDispatchInputKeys(content);
  const inputBlocks = yamlWorkflowDispatchInputBlocks(content);
  if (inputs.length !== PERSONAL_REPOSITORY_WORKFLOW_INPUTS.length
    || inputs.some((input, index) => input !== PERSONAL_REPOSITORY_WORKFLOW_INPUTS[index])
    || inputBlocks.length !== PERSONAL_REPOSITORY_WORKFLOW_INPUTS.length
    || inputBlocks.some((block) => (
      block.lines.filter((line) => /^ {8}required:\s*true\s*$/.test(line)).length !== 1
      || block.lines.filter((line) => /^ {8}type:\s*string\s*$/.test(line)).length !== 1
    ))
    || !/^run-name: Protected operator merge \$\{\{ github\.event\.merge_group\.head_sha \|\| inputs\.expected_head \|\| github\.run_id \}\}\s*$/m.test(content)) {
    blockers.push('personal-repository-workflow-dispatch-inputs-not-exact');
  }
  const checkouts = checkoutBlocks(content);
  if (checkouts.length !== 5) blockers.push('personal-repository-workflow-checkout-count-mismatch');
  const observedRefCounts = new Map(PERSONAL_REPOSITORY_WORKFLOW_CHECKOUT_REFS.map((entry) => [entry.expression, 0]));
  for (const checkout of checkouts) {
    const matchingRefs = PERSONAL_REPOSITORY_WORKFLOW_CHECKOUT_REFS.filter((entry) => {
      const pattern = new RegExp(`^ {${checkout.usesIndent + 2}}ref:\\s*\\$\\{\\{\\s*${entry.expression}\\s*\\}\\}\\s*$`);
      return checkout.lines.filter((line) => pattern.test(line)).length === 1;
    });
    const persistPattern = new RegExp(`^ {${checkout.usesIndent + 2}}persist-credentials:\\s*false\\s*$`);
    if (checkout.uses !== 'uses: actions/checkout@v4'
      || matchingRefs.length !== 1
      || checkout.lines.filter((line) => persistPattern.test(line)).length !== 1) {
      blockers.push('personal-repository-workflow-checkout-not-exact-base');
    } else {
      const expression = matchingRefs[0].expression;
      observedRefCounts.set(expression, observedRefCounts.get(expression) + 1);
    }
  }
  for (const expected of PERSONAL_REPOSITORY_WORKFLOW_CHECKOUT_REFS) {
    if (observedRefCounts.get(expected.expression) !== expected.count) {
      blockers.push('personal-repository-workflow-checkout-ref-count-mismatch');
    }
  }
  const permissions = permissionSignatures(content);
  const expectedPermissions = [...PERSONAL_REPOSITORY_WORKFLOW_PERMISSIONS].sort();
  if (!permissions.valid
    || permissions.signatures.length !== expectedPermissions.length
    || permissions.signatures.some((signature, index) => signature !== expectedPermissions[index])) {
    blockers.push('personal-repository-workflow-permissions-not-exact');
  }
  const jobPolicies = [
    ['merge-group-evidence', PERSONAL_REPOSITORY_WORKFLOW_PERMISSIONS[0], 'github\\.event\\.merge_group\\.base_sha'],
    ['operator-merge-queue-boundary', PERSONAL_REPOSITORY_WORKFLOW_PERMISSIONS[1], 'github\\.event\\.merge_group\\.base_sha'],
    ['personal-repository-evidence', PERSONAL_REPOSITORY_WORKFLOW_PERMISSIONS[2], 'github\\.sha'],
    ['operator-personal-repository-approval', PERSONAL_REPOSITORY_WORKFLOW_PERMISSIONS[3], 'github\\.sha'],
    ['operator-personal-repository-squash-merge', PERSONAL_REPOSITORY_WORKFLOW_PERMISSIONS[4], 'github\\.sha'],
  ];
  for (const [jobName, expectedPermission, expectedRef] of jobPolicies) {
    const job = yamlJobBlock(content, jobName);
    const jobPermissions = permissionSignatures(job, { requireTopLevelEmpty: false });
    if (!job
      || !jobPermissions.valid
      || jobPermissions.signatures.length !== 1
      || jobPermissions.signatures[0] !== expectedPermission
      || !jobUsesExactCheckout(content, jobName, expectedRef)) {
      blockers.push('personal-repository-workflow-job-authority-not-exact');
    }
  }
  for (const policy of PERSONAL_REPOSITORY_WORKFLOW_JOB_STEPS) {
    if (!jobHasExactExecutionSteps(content, policy)) {
      blockers.push('personal-repository-workflow-job-steps-not-exact');
    }
  }
  if (!personalRepositoryRulesetProofTokenIsExact(content)) {
    blockers.push('personal-repository-workflow-ruleset-proof-token-not-exact');
  }
  if (!personalRepositoryProtectedStageSequenceIsExact(content)) {
    blockers.push('personal-repository-workflow-stage-sequence-not-exact');
  }
  if (!personalRepositoryRulesetProofTokenIsBound(content)) {
    blockers.push('personal-repository-workflow-ruleset-proof-token-not-bound');
  }
  for (const pattern of [
    /^\s+pull_request(?:_target)?:\s*$/m,
    /^\s+repository_dispatch:\s*$/m,
    /^\s+workflow_call:\s*$/m,
    /^\s+schedule:\s*$/m,
    /continue-on-error:/,
    /github\.event\.pull_request\.head\.sha/,
    /github\.event\.repository\.default_branch/,
  ]) {
    if (pattern.test(content)) blockers.push('personal-repository-workflow-forbidden-authority');
  }
  for (const pattern of [
    /^concurrency:\s*\n  group: protected-operator-merge-\$\{\{ github\.event\.merge_group\.head_sha \|\| inputs\.expected_head \|\| github\.run_id \}\}\s*\n  cancel-in-progress: false\s*$/m,
    /^  merge-group-evidence:\s*\n    name: merge-group-evidence\s*\n    if: \$\{\{ github\.event_name == 'merge_group' \}\}\s*$/m,
    /^  operator-merge-queue-boundary:\s*\n    name: operator-merge-queue-boundary\s*\n    if: \$\{\{ github\.event_name == 'merge_group' \}\}\s*$/m,
    /^  personal-repository-evidence:\s*$/m,
    /^  personal-repository-evidence:\s*\n    name: personal-repository-evidence\s*\n    if: \$\{\{ github\.event_name == 'workflow_dispatch' \}\}\s*$/m,
    /^  operator-personal-repository-approval:\s*$/m,
    /^  operator-personal-repository-approval:\s*\n    name: operator-personal-repository-approval\s*\n    if: \$\{\{ github\.event_name == 'workflow_dispatch' \}\}\s*$/m,
    /^  operator-personal-repository-squash-merge:\s*$/m,
    /^  operator-personal-repository-squash-merge:\s*\n    name: operator-personal-repository-squash-merge\s*\n    if: \$\{\{ github\.event_name == 'workflow_dispatch' \}\}\s*$/m,
    /^    environment:\s*\n      name: operator-merge-approval\s*$/m,
    /^    needs: \[personal-repository-evidence, operator-personal-repository-approval\]\s*$/m,
  ]) {
    if (!pattern.test(content)) blockers.push('personal-repository-workflow-required-boundary-missing');
  }
  return Object.freeze({
    valid: blockers.length === 0,
    blockers: Object.freeze(unique(blockers)),
    proofRef: blockers.length === 0
      ? `proofs/personal-repository-workflow-source/${source.path}@${source.ref}#${source.blobSha}:${source.size}`
      : '',
  });
}

function changedFilePaths(item) {
  if (typeof item === 'string') return [text(item)].filter(Boolean);
  return unique([
    text(item?.filename ?? item?.path),
    text(item?.previous_filename),
  ]).filter(Boolean);
}

function diffForPath(diff, path) {
  const escaped = path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = String(diff || '').match(new RegExp(`(?:^|\\n)diff --git a/${escaped} b/${escaped}([\\s\\S]*?)(?=\\ndiff --git a/|$)`));
  return match?.[1] || '';
}

function addedLines(patch) {
  return String(patch || '')
    .split('\n')
    .filter((line) => line.startsWith('+') && !line.startsWith('+++'))
    .join('\n');
}

function finding(code, summary, path) {
  return Object.freeze({ severity: 'P0', code, summary, path });
}

export function analyzeIndependentSecurityReviewV2(input = {}) {
  const legacy = analyzeIndependentSecurityReview(input);
  const changedFiles = (Array.isArray(input.changedFiles) ? input.changedFiles : [])
    .flatMap(changedFilePaths)
    .filter(Boolean);
  const diff = String(input.diff || '');
  const personalRepositoryWorkflow = validatePersonalRepositoryProtectedWorkflowSource(input);
  const findings = (Array.isArray(legacy.findings) ? legacy.findings : []).filter((item) => !(
    personalRepositoryWorkflow.valid
    && item?.code === 'write-workflow-does-not-use-trusted-source'
    && item?.path === PERSONAL_REPOSITORY_WORKFLOW_PATH
  ));
  const proofRefs = [...(Array.isArray(legacy.proofRefs) ? legacy.proofRefs : [])];
  if (personalRepositoryWorkflow.valid) proofRefs.push(personalRepositoryWorkflow.proofRef);

  for (const path of ALL_APPROVAL_BOUNDARY_PATHS_V2.filter((item) => changedFiles.includes(item))) {
    proofRefs.push(`proofs/approval-boundary-v2/${path}`);
    findings.push(finding(
      APPROVAL_BOUNDARY_BOOTSTRAP_FINDING_CODE,
      'A live v2 approval-boundary self-change requires a separate qualified bootstrap review and cannot self-attest clean.',
      path,
    ));
  }

  for (const path of OPERATOR_EXECUTOR_PATHS.filter((item) => changedFiles.includes(item))) {
    const patch = diffForPath(diff, path);
    const additions = addedLines(patch);
    if (/buildProtectedSecurityReviewReceipt\s*\(/.test(additions)) {
      findings.push(finding(
        'operator-v2-synthesizes-review',
        'The live v2 operator approval executor may not mint its own specialist-review conclusion.',
        path,
      ));
    }
    const addsMergeAuthority = /\bgh\s+pr\s+merge\b/.test(additions)
      || /['"]pr['"]\s*,\s*['"]merge['"]/.test(additions)
      || /pulls\/\$\{[^}]+\}\/merge/.test(additions);
    const exactCliMerge = /--match-head-commit/.test(patch);
    const exactRestSquash = /method:\s*['"]PUT['"]/.test(patch)
      && /merge_method:\s*['"]squash['"]/.test(patch)
      && /sha:\s*receipt\.sourceHead/.test(patch);
    if (addsMergeAuthority && !exactCliMerge && !exactRestSquash) {
      findings.push(finding(
        'operator-v2-exact-head-guard-missing',
        'Any newly introduced live v2 merge must use --match-head-commit or the exact REST head SHA with squash only.',
        path,
      ));
    }
    if (/delete_branch|method:\s*['"]DELETE['"]|git\/refs\/heads\/.+[\s\S]*DELETE/.test(additions)) {
      findings.push(finding(
        'operator-v2-branch-deletion-authority',
        'The protected merge executor may not delete the source branch.',
        path,
      ));
    }
    if (/\b(?:eval|execSync)\s*\(|shell\s*:\s*true/.test(additions)) {
      findings.push(finding(
        'operator-v2-arbitrary-command-authority',
        'The live v2 protected merge executor may not gain arbitrary command execution authority.',
        path,
      ));
    }
  }

  for (const path of INDEPENDENT_REVIEWER_PATHS.filter((item) => changedFiles.includes(item))) {
    const patch = diffForPath(diff, path);
    const additions = addedLines(patch);
    const contentApiMutation = /repos\/[^\s]+\/contents/.test(additions)
      && /method\s*:\s*['"](?:POST|PUT|PATCH|DELETE)['"]/i.test(additions);
    if (/\bgh\s+pr\s+(?:ready|merge)\b/.test(additions)
      || /['"]pr['"]\s*,\s*['"](?:ready|merge)['"]/.test(additions)
      || contentApiMutation
      || /git\s+(?:push|reset|clean|rebase)/.test(additions)
      || /\b(?:eval|execSync)\s*\(|shell\s*:\s*true/.test(additions)) {
      findings.push(finding(
        'independent-reviewer-v2-gained-mutation-authority',
        'The live v2 independent reviewer must remain read-only except for its bounded immutable result artifact and non-authoritative display comment.',
        path,
      ));
    }
  }

  for (const path of BASE_BINDING_PATHS.filter((item) => changedFiles.includes(item))) {
    const patch = diffForPath(diff, path);
    const additions = addedLines(patch);
    if (/node:child_process|\bspawnSync\b|\bexecSync\b|\beval\s*\(|\bgh\s+pr\s+(?:ready|merge)\b|git\s+(?:push|reset|clean|rebase)/.test(additions)) {
      findings.push(finding(
        'base-binding-module-gained-command-authority',
        'The exact-base binding module must remain a pure validation and receipt-binding surface.',
        path,
      ));
    }
  }

  const counts = {
    P0: findings.filter((item) => item.severity === 'P0').length,
    P1: findings.filter((item) => item.severity === 'P1').length,
    P2: findings.filter((item) => item.severity === 'P2').length,
  };
  const verdict = counts.P0 || counts.P1 || counts.P2 ? 'findings' : 'clean';

  return Object.freeze({
    schemaVersion: 'stephanos.independent-security-analysis.v1',
    findings: Object.freeze(findings),
    counts: Object.freeze(counts),
    verdict,
    proofRefs: Object.freeze(unique(proofRefs)),
    finalVerdict: verdict === 'clean'
      ? 'INDEPENDENT_SECURITY_REVIEW_CLEAN'
      : 'INDEPENDENT_SECURITY_REVIEW_FINDINGS',
  });
}
