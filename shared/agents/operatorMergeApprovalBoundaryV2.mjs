import {
  APPROVAL_BOUNDARY_BOOTSTRAP_FINDING_CODE,
  analyzeIndependentSecurityReview,
} from './operatorMergeApprovalGate.mjs';

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
  'scripts/independent-merge-security-review-v2.mjs',
  'shared/agents/operatorMergeApprovalGate.mjs',
  'shared/agents/operatorMergeApprovalGateV2.mjs',
  'shared/agents/operatorMergeApprovalBoundaryV2.mjs',
  'shared/agents/operatorMergeBaseBindingV1.mjs',
  'shared/agents/operatorMergeReviewArtifactV1.mjs',
  'shared/agents/providerNeutralReviewV1.mjs',
]);

const OPERATOR_EXECUTOR_PATHS = Object.freeze([
  'scripts/operator-protected-merge-gate-v2.mjs',
]);

const INDEPENDENT_REVIEWER_PATHS = Object.freeze([
  'scripts/independent-merge-security-review-v2.mjs',
]);

const BASE_BINDING_PATHS = Object.freeze([
  'shared/agents/operatorMergeBaseBindingV1.mjs',
]);

function text(value) {
  return String(value ?? '').trim();
}

function unique(values) {
  return [...new Set(values)];
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
  const findings = [...(Array.isArray(legacy.findings) ? legacy.findings : [])];
  const proofRefs = [...(Array.isArray(legacy.proofRefs) ? legacy.proofRefs : [])];

  for (const path of APPROVAL_BOUNDARY_PATHS_V2.filter((item) => changedFiles.includes(item))) {
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
      || /['"]pr['"]\s*,\s*['"]merge['"]/.test(additions);
    if (addsMergeAuthority && !/--match-head-commit/.test(patch)) {
      findings.push(finding(
        'operator-v2-exact-head-guard-missing',
        'Any newly introduced live v2 merge command must include --match-head-commit.',
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
