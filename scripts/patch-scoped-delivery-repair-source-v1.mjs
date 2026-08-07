import { read, write, replaceOnce, replaceAllExact } from './patch-scoped-delivery-repair-lib-v1.mjs';

const scopedSourcePath = 'shared/agents/sharedWorkspaceScopedDeliveryStatusV1.mjs';
let scopedSource = read(scopedSourcePath);

scopedSource = replaceOnce(
  scopedSource,
`const IDENTITY_KEYS = Object.freeze({
  repository: new Set(['repository', 'repositoryfullname', 'repofullname']),
  pr: new Set(['relatedpr', 'prnumber', 'pullrequestnumber']),
  merge: new Set([
    'mergecommit', 'expectedhead', 'localheadafter', 'sourcehead', 'checkouthead', 'servedsourcehead',
    'builtdisthead', 'buildhead', 'distcommit', 'distgitcommit',
    'servedbrowserhead', 'servedhead', 'servedcommit', 'runtimecommit', 'servedgitcommit',
  ]),
  deployment: new Set(['deploymentrequestid', 'correlationid', 'requestid']),
  feature: new Set(['featureid']),
});
const ALL_STAGE_HEAD_KEYS = new Set([
  ...HEAD_KEYS.synced,
  ...HEAD_KEYS.built,
  ...HEAD_KEYS.served,
]);
const EXPLICIT_MERGE_IDENTITY_KEYS = new Set(['mergecommit']);`,
`const IDENTITY_KEYS = Object.freeze({
  repository: new Set(['repository', 'repositoryfullname', 'repofullname']),
  pr: new Set(['relatedpr', 'prnumber', 'pullrequestnumber']),
  merge: new Set(['mergecommit']),
  deploymentHead: new Set(['deploymenthead', 'expectedhead']),
  deployment: new Set(['deploymentrequestid']),
  deploymentFallback: new Set(['correlationid', 'requestid']),
  feature: new Set(['featureid']),
});
const ALL_STAGE_HEAD_KEYS = new Set([
  ...HEAD_KEYS.synced,
  ...HEAD_KEYS.built,
  ...HEAD_KEYS.served,
]);
const EXPLICIT_DEPLOYMENT_IDENTITY_KEYS = new Set(['deploymenthead', 'expectedhead']);`,
  'scoped-identity-keys',
);

scopedSource = replaceOnce(
  scopedSource,
`function exactHeadForKeys(record, keys, expectedHead) {
  return valueForKeys(record, keys).some((value) => text(value).toLowerCase() === expectedHead);
}

function booleanForKeys(record, keys) {
  return valueForKeys(record, keys).some((value) => value === true || text(value).toLowerCase() === 'true');
}`,
`function exactHeadForKeys(record, keys, expectedHead) {
  const values = valueForKeys(record, keys);
  return values.length > 0
    && values.every((value) => text(value).toLowerCase() === expectedHead);
}

function booleanForKeys(record, keys) {
  const values = valueForKeys(record, keys);
  return values.length > 0
    && values.every((value) => value === true || text(value).toLowerCase() === 'true');
}`,
  'scoped-strict-stage-values',
);

scopedSource = replaceOnce(
  scopedSource,
`function exactTextForKeys(record, keys, expected) {
  const normalizedExpected = text(expected).toLowerCase();
  return Boolean(normalizedExpected) && valueForKeys(record, keys)
    .some((value) => text(value).toLowerCase() === normalizedExpected);
}

function exactPrForKeys(record, expectedPr) {
  return valueForKeys(record, IDENTITY_KEYS.pr)
    .some((value) => normalizePrNumber(value) === expectedPr);
}`,
`function exactTextForKeys(record, keys, expected) {
  const normalizedExpected = text(expected).toLowerCase();
  const values = valueForKeys(record, keys);
  return Boolean(normalizedExpected)
    && values.length > 0
    && values.every((value) => text(value).toLowerCase() === normalizedExpected);
}

function exactPrForKeys(record, expectedPr) {
  const values = valueForKeys(record, IDENTITY_KEYS.pr)
    .map((value) => normalizePrNumber(value))
    .filter((value) => value > 0);
  return values.length > 0
    && values.every((value) => value === expectedPr);
}

function exactDeploymentIdentity(record, expectedDeploymentRequestId) {
  const explicit = valueForKeys(record, IDENTITY_KEYS.deployment)
    .map((value) => text(value))
    .filter(Boolean);
  if (explicit.length > 0) {
    return explicit.every((value) => value === expectedDeploymentRequestId);
  }
  const fallback = valueForKeys(record, IDENTITY_KEYS.deploymentFallback)
    .map((value) => text(value))
    .filter(Boolean);
  return fallback.length > 0
    && fallback.every((value) => value === expectedDeploymentRequestId);
}`,
  'scoped-strict-identity-values',
);

scopedSource = replaceOnce(
  scopedSource,
`function identityMatches(record, subject) {
  return exactTextForKeys(record, IDENTITY_KEYS.repository, subject.repository)
    && exactPrForKeys(record, subject.prNumber)
    && exactTextForKeys(record, IDENTITY_KEYS.merge, subject.mergeCommit)
    && exactTextForKeys(record, IDENTITY_KEYS.deployment, subject.deploymentRequestId)
    && exactTextForKeys(record, IDENTITY_KEYS.feature, subject.featureId);
}`,
`function identityMatches(record, subject) {
  return exactTextForKeys(record, IDENTITY_KEYS.repository, subject.repository)
    && exactPrForKeys(record, subject.prNumber)
    && exactTextForKeys(record, IDENTITY_KEYS.merge, subject.mergeCommit)
    && exactTextForKeys(record, IDENTITY_KEYS.deploymentHead, subject.deploymentHead)
    && exactDeploymentIdentity(record, subject.deploymentRequestId)
    && exactTextForKeys(record, IDENTITY_KEYS.feature, subject.featureId);
}`,
  'scoped-identity-match',
);

scopedSource = replaceOnce(
  scopedSource,
`  return exactTextForKeys(record, EXPLICIT_MERGE_IDENTITY_KEYS, expectedHead)
    && trustedStatusPattern.test(statusText(record));`,
`  return exactTextForKeys(record, EXPLICIT_DEPLOYMENT_IDENTITY_KEYS, expectedHead)
    && trustedStatusPattern.test(statusText(record));`,
  'scoped-status-fallback',
);

scopedSource = replaceOnce(
  scopedSource,
`  const allowedKeys = new Set(['repository', 'prNumber', 'mergeCommit', 'deploymentRequestId', 'featureId']);`,
`  const allowedKeys = new Set(['repository', 'prNumber', 'mergeCommit', 'deploymentHead', 'deploymentRequestId', 'featureId']);`,
  'scoped-subject-allowed-keys',
);

scopedSource = replaceOnce(
  scopedSource,
`  const mergeCommit = text(input.mergeCommit).toLowerCase();
  const deploymentRequestId = safeId(input.deploymentRequestId);`,
`  const mergeCommit = text(input.mergeCommit).toLowerCase();
  const deploymentHead = text(input.deploymentHead).toLowerCase();
  const deploymentRequestId = safeId(input.deploymentRequestId);`,
  'scoped-subject-normalize-head',
);

scopedSource = replaceOnce(
  scopedSource,
`  if (!FULL_SHA.test(mergeCommit)) errors.push('invalid-merge-commit');
  if (!deploymentRequestId || deploymentRequestId !== text(input.deploymentRequestId)) errors.push('invalid-deployment-request-id');`,
`  if (!FULL_SHA.test(mergeCommit)) errors.push('invalid-merge-commit');
  if (!FULL_SHA.test(deploymentHead)) errors.push('invalid-deployment-head');
  if (!deploymentRequestId || deploymentRequestId !== text(input.deploymentRequestId)) errors.push('invalid-deployment-request-id');`,
  'scoped-subject-validate-head',
);

scopedSource = replaceOnce(
  scopedSource,
`      mergeCommit,
      deploymentRequestId,`,
`      mergeCommit,
      deploymentHead,
      deploymentRequestId,`,
  'scoped-subject-output-head',
);

scopedSource = replaceOnce(
  scopedSource,
`    subject.mergeCommit,
    /SYNC_FAST_FORWARD_APPLIED|SYNC_NO_CHANGE|SOURCE_SYNC_PASS|SOURCE_AND_RUNTIME_EXACT_HEAD/,`,
`    subject.deploymentHead,
    /SYNC_FAST_FORWARD_APPLIED|SYNC_NO_CHANGE|SOURCE_SYNC_PASS|SOURCE_AND_RUNTIME_EXACT_HEAD/,`,
  'scoped-sync-head',
);

scopedSource = replaceOnce(
  scopedSource,
`  const buildEvidence = matching.filter((record) => exactHeadForKeys(record, HEAD_KEYS.built, subject.mergeCommit));`,
`  const buildEvidence = matching.filter((record) => exactHeadForKeys(record, HEAD_KEYS.built, subject.deploymentHead));`,
  'scoped-build-head',
);

scopedSource = replaceOnce(
  scopedSource,
`    subject.mergeCommit,
    /SOURCE_AND_RUNTIME_EXACT_HEAD|SERVED_EXACT_HEAD|RUNTIME_EXACT_HEAD/,`,
`    subject.deploymentHead,
    /SOURCE_AND_RUNTIME_EXACT_HEAD|SERVED_EXACT_HEAD|RUNTIME_EXACT_HEAD/,`,
  'scoped-served-head',
);

scopedSource = replaceOnce(
  scopedSource,
`      githubMerge: Object.freeze({ status: 'EXTERNAL_GITHUB_AUTHORITY', mergeCommit: subject.mergeCommit }),`,
`      githubMerge: Object.freeze({
        status: 'EXTERNAL_GITHUB_AUTHORITY',
        mergeCommit: subject.mergeCommit,
        deploymentHead: subject.deploymentHead,
      }),`,
  'scoped-stage-identity',
);

write(scopedSourcePath, scopedSource);
