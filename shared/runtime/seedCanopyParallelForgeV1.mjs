// Independent, source-proposal-only lane. Never grants merge, deployment or runtime authority.
export const PARALLEL_SEED_REQUEST_SCHEMA = 'stephanos.seed-parallel-build-request.v1';
export const PARALLEL_SEED_RECEIPT_SCHEMA = 'stephanos.seed-parallel-build-receipt.v1';

const text = (value) => typeof value === 'string' ? value.trim() : '';
const safeId = (value) => /^[a-z0-9][a-z0-9-]{2,79}$/.test(text(value));
const safePath = (value) => {
  const path = text(value);
  return Boolean(path && path.length <= 220 && !path.includes('\\') && !path.includes('//')
    && !path.startsWith('/') && !path.endsWith('/')
    && !path.split('/').some((part) => !part || part === '.' || part === '..')
    && !/[\x00-\x1f:*?"<>|]/.test(path));
};
const sourcePath = (path) => safePath(path) && (
  /^docs\/architecture\/[a-zA-Z0-9/_-]+\.md$/.test(path)
  || /^shared\/runtime\/[a-zA-Z0-9/_-]+\.mjs$/.test(path)
  || /^stephanos-server\/services\/[a-zA-Z0-9/_-]+\.js$/.test(path)
) && !/\/(?:auth|credential|secret|protected|operatorMerge|lease|security|approval)[^/]*[/.]/i.test(path);
const testPath = (path) => safePath(path)
  && /^(?:shared\/runtime|stephanos-server\/services|tests)\/[a-zA-Z0-9/_-]+\.test\.(?:mjs|js)$/.test(path);

export function listParallelSeedCandidatesV1(seeds = []) {
  return Object.freeze(seeds.filter((seed) => safeId(seed?.seedId) && /^#\d+$/.test(seed?.issue || '')).map((seed) => Object.freeze({
    seedId: seed.seedId,
    title: text(seed.title),
    ownerIssue: seed.issue,
    source: seed.source,
    firstRung: Array.isArray(seed.growthRungs) ? seed.growthRungs[0] || 'INVENTORY' : 'INVENTORY',
    routeTruth: 'SOURCE_BACKED_PROPOSAL_ONLY',
    requiresIndependentOwnerAndLiveEvidence: true,
  })));
}


// A goal *draft* from declared seed truth. This never claims observed gaps, worker pickup, or admission.
export function draftParallelSeedGoalV1(seed = {}) {
  if (!safeId(seed.seedId) || !/^#\d+$/.test(seed.issue || '')
    || !safePath(seed.source || '')) throw new Error('INVALID_CANONICAL_SEED');
  const nextRung = Array.isArray(seed.growthRungs) && seed.growthRungs.length
    ? text(seed.growthRungs[0]) : 'INVENTORY';
  if (!/^[A-Z0-9_]{3,90}$/.test(nextRung)) throw new Error('INVALID_SEED_RUNG');
  return Object.freeze({
    seedId: seed.seedId,
    ownerIssue: seed.issue,
    contractSource: seed.source,
    title: 'Goal draft: ' + text(seed.title) + ' / ' + nextRung,
    nextRung,
    taskIntent: 'Produce verifiable evidence for ' + nextRung + ' under the '
      + text(seed.title) + ' seed; identify exact bounded repair work only after measurement.',
    sourceTruth: 'DECLARED_CONTRACT_NOT_LIVE_PRESSURE',
    workAuthorized: false,
    implementationCompleted: false,
    existingOwnerMustBeChecked: true,
  });
}

export function validateParallelSeedBuildRequestV1(request, seeds = []) {
  const errors = [];
  if (request?.schemaVersion !== PARALLEL_SEED_REQUEST_SCHEMA) errors.push('INVALID_SCHEMA');
  const seed = seeds.find((s) => s.seedId === request?.seedId);
  if (!seed) errors.push('UNKNOWN_SEED');
  if (!safeId(request?.taskId)) errors.push('INVALID_TASK_ID');
  if (!seed || request?.ownerIssue !== seed.issue) errors.push('OWNER_MUST_MATCH_CANONICAL_SEED');
  if (request?.contractSource !== seed?.source) errors.push('CONTRACT_SOURCE_MISMATCH');
  if (!sourcePath(request?.targetPath)) errors.push('UNSAFE_TARGET_PATH');
  // V1 may execute local tests only after writing a non-executable documentation target.
  // Generated JS needs a separately qualified execution sandbox before this can widen.
  if (sourcePath(request?.targetPath) && !request.targetPath.endsWith('.md'))
    errors.push('CODE_PROPOSAL_NEEDS_QUALIFIED_SANDBOX');
  if (!text(request?.intent) || text(request.intent).length > 2400) errors.push('MISSING_OR_UNBOUNDED_INTENT');
  if (request?.generationMode !== undefined && request.generationMode !== 'CANONICAL_INVENTORY_V1')
    errors.push('UNQUALIFIED_GENERATION_MODE');
  // Initial meter-free construction is deliberately documentation-only and
  // creates a NEW file. It cannot overwrite a canonical source owner.
  if (request?.generationMode === 'CANONICAL_INVENTORY_V1'
    && (request.expectedTargetSha256 !== null
      || !/^docs\/architecture\/[a-zA-Z0-9/_-]+\.md$/.test(request.targetPath || '')))
    errors.push('DETERMINISTIC_INVENTORY_NEW_DOC_ONLY');

  if (!Array.isArray(request?.testPaths) || request.testPaths.length < 1
    || request.testPaths.length > 5 || !request.testPaths.every(testPath)
    || new Set(request.testPaths).size !== request.testPaths.length) errors.push('INVALID_TEST_PATHS');
  if (request?.expectedTargetSha256 !== null
    && !/^[a-f0-9]{64}$/.test(request?.expectedTargetSha256 || '')) errors.push('INVALID_EXACT_TARGET_HASH');
  if (!/^[a-f0-9]{40}$/.test(request?.baseSha || '')) errors.push('MISSING_EXACT_BASE');
  if (request?.reviewAuthority !== 'PROTECTED_REVIEW_REQUIRED') errors.push('REVIEW_CANNOT_BE_WAIVED');
  if (request?.sourceScopeApproval !== 'EXACT_TARGET_ONLY') errors.push('EXPLICIT_SOURCE_SCOPE_REQUIRED');
  if (request?.mergeAllowed === true || request?.deployAllowed === true
    || request?.runtimeMutationAllowed === true) errors.push('AUTHORITY_ESCALATION');
  if (request?.modelEndpoint || request?.workerCommand || request?.shellCommand
    || request?.commitToMain || request?.existingLeaseBypass) errors.push('UNTRUSTED_EXECUTION_OVERRIDE');
  return Object.freeze({ ok: errors.length === 0, errors: Object.freeze(errors), seed: seed || null });
}

// Deterministic low-resource source proposal. This deliberately claims NO
// machine observation, live seed growth or independent approval. It is useful
// for seed inventory drafts when the ungoverned llama.cpp router must stay OFF.
export function renderParallelSeedCanonicalInventoryV1(request, seed) {
  if (request?.generationMode !== 'CANONICAL_INVENTORY_V1')
    throw new Error('DETERMINISTIC_SEED_GENERATION_NOT_SELECTED');
  const validation = validateParallelSeedBuildRequestV1(request, [seed]);
  if (!validation.ok) throw new Error('DETERMINISTIC_SEED_REQUEST_REJECTED:' + validation.errors.join(','));
  const scalar = (value) => text(value).replace(/[\r\n\t<>]/g, ' ').slice(0, 2400);
  const rung = Array.isArray(seed.growthRungs) && /^[A-Z0-9_]{3,90}$/.test(seed.growthRungs[0])
    ? seed.growthRungs[0] : 'INVENTORY';
  return Object.freeze({
    path: request.targetPath,
    content: [
      '# ' + scalar(seed.title) + ': ' + rung + ' source inventory',
      '',
      '> SOURCE PROPOSAL ONLY. No Battle Bridge observation, live builder pickup,',
      '> source merge, runtime deployment or seed completion is claimed.',
      '',
      '## Canonical ownership',
      '',
      '- Seed: \`' + seed.seedId + '\`',
      '- Owner: ' + scalar(seed.issue),
      '- Contract source: \`' + scalar(seed.source) + '\`',
      '- Exact request base: \`' + request.baseSha + '\`',
      '- Approved target (proposal): \`' + request.targetPath + '\`',
      '',
      '## Requested outcome',
      '',
      scalar(request.intent),
      '',
      '## Evidence to collect before implementation',
      '',
      '- [ ] Confirm the current source and running host match this base.',
      '- [ ] Verify the owner and check competing canonical, Island and Seed claims.',
      '- [ ] Record independent, current physical evidence for any claimed gap.',
      '- [ ] Identify the smallest disjoint implementation scope and test.',
      '- [ ] Obtain exact-head independent review and protected merge approval.',
      '- [ ] Prove post-merge runtime outcome before marking this seed grown.',
      '',
      '## Unverified observations',
      '',
      'No physical observations were supplied by this deterministic renderer.',
      'Treat every proposed acceptance check as pending real evidence.',
      '',
    ].join('\n'),
  });
}

export function parallelSeedBranchNameV1(request) {
  if (!safeId(request?.seedId) || !safeId(request?.taskId)) throw new Error('Unsafe parallel seed identity');
  return 'seed-parallel/' + request.seedId + '/' + request.taskId;
}

export function parseParallelSeedModelResponseV1(output, targetPath) {
  let proposal;
  try {
    proposal = JSON.parse(output);
  } catch {
    throw new Error('MODEL_OUTPUT_NOT_JSON');
  }
  if (!proposal || typeof proposal !== 'object' || Array.isArray(proposal)
    || Object.keys(proposal).sort().join(',') !== 'content,path'
    || proposal.path !== targetPath || !sourcePath(proposal.path)
    || typeof proposal.content !== 'string' || !proposal.content.trim()
    || Buffer.byteLength(proposal.content, 'utf8') > 65536
    || proposal.content.includes('\u0000')) throw new Error('MODEL_PROPOSAL_NOT_SCOPED');
  return Object.freeze({ path: proposal.path, content: proposal.content });
}

export function makeParallelSeedReceiptV1(request, stage, extras = {}) {
  if (!['SELECTED','CLAIMED','PHYSICAL_PICKUP','EDITED','TESTED','COMMITTED','TEST_FAILED','BLOCKED'].includes(stage))
    throw new Error('INVALID_RECEIPT_STAGE');
  return Object.freeze({
    schemaVersion: PARALLEL_SEED_RECEIPT_SCHEMA,
    seedId: request.seedId,
    ownerIssue: request.ownerIssue,
    taskId: request.taskId,
    branch: parallelSeedBranchNameV1(request),
    exactBaseSha: request.baseSha,
    targetPath: request.targetPath,
    ...extras,
    stage,
    schemaVersion: PARALLEL_SEED_RECEIPT_SCHEMA,
    seedId: request.seedId,
    ownerIssue: request.ownerIssue,
    taskId: request.taskId,
    branch: parallelSeedBranchNameV1(request),
    exactBaseSha: request.baseSha,
    targetPath: request.targetPath,
    sourceBuildProposalOnly: true,
    merged: false,
    deployed: false,
    goalCompleted: false,
  });
}
