// Source-test fixtures only. Ephemeral private keys live only in this process;
// none is written, published, enrolled or installed. These synthetic signed
// records test rejection/acceptance logic, never actual Windows qualification.
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { formatAuthenticatedReviewDiffV1 } from '../sovereignAuthenticatedReviewDiffV1.mjs';
import { assessSovereignReviewCoverageV1 } from '../sovereignReviewCoverageV1.mjs';
import { SOVEREIGN_CALIBRATION_SCHEMA, SOVEREIGN_CALIBRATION_CASE_COUNT, SOVEREIGN_CALIBRATION_MANIFEST_SHA256 } from '../sovereignCalibrationV1.mjs';
import { SOVEREIGN_WINDOWS_CALIBRATION_SCHEMA, SOVEREIGN_WINDOWS_CALIBRATION_CASE_COUNT, sovereignWindowsCalibrationManifestV1 } from '../sovereignWindowsCalibrationV1.mjs';
import { LOCAL_REVIEW_EXAM_SCHEMA, LOCAL_REVIEW_EXAM_CHALLENGES, LOCAL_REVIEW_EXAM_PRIVILEGED } from '../localReviewCapabilityExamV1.mjs';
import { SOVEREIGN_SPECIALIST_ARTIFACT_SCHEMA_V1, SOVEREIGN_SPECIALIST_COMMENT_MARKER_V1,
  SOVEREIGN_SPECIALIST_SIGNATURE_DOMAINS_V1 as domains, sovereignSpecialistCanonicalV1 as canonical,
  sovereignSpecialistDigestV1 as hashObject, sovereignSpecialistSignatureInputV1 as signatureInput,
  sovereignSpecialistReviewBindingV1, sovereignSpecialistArtifactPayloadSha256V1 } from '../sovereignQualifiedSpecialistReviewV1.mjs';
import { createProviderNeutralReviewReceipt } from '../providerNeutralReviewV1.mjs';

export const sha = value => createHash('sha256').update(value).digest('hex');
const blob = value => createHash('sha1').update('blob ' + Buffer.byteLength(value) + '\0').update(value).digest('hex');
const iso = ms => new Date(ms).toISOString();
const sourceFields = ['repository', 'prNumber', 'branch', 'sourceHead', 'baseSha', 'sourceTree', 'baseTree',
  'diffRepresentation', 'fullDiffSha256', 'diffBytes', 'reviewedObjectClosureSha256', 'sourceEvidence', 'reviewDomains'];
export const sourceBinding = artifact => Object.fromEntries(sourceFields.map(key => [key, artifact[key]]));
const pick = (value, fields) => Object.fromEntries(fields.map(key => [key, value[key]]));
const signature = (domain, payload, key) => sign(null, signatureInput(domain, payload), key).toString('base64');
export const signProof = (domain, payload, key) => ({ payload, signatureBase64: signature(domain, payload, key) });
export const sealOuter = artifact => { artifact.payloadSha256 = sovereignSpecialistArtifactPayloadSha256V1(artifact); return artifact; };

export function makeFixture(paths = ['scripts/windows/fixture-native.ps1'], { outOfBand = false, contentBytes = 0 } = {}) {
  const now = Math.floor(Date.now() / 1000) * 1000;
  const roles = ['reviewer', 'auditor', 'witness', ...(outOfBand ? ['root'] : [])];
  const keyPairs = Object.fromEntries(roles.map(role => [role, generateKeyPairSync('ed25519')]));
  const artifacts = {}, pins = {};
  for (const role of roles) {
    const pem = keyPairs[role].publicKey.export({ type: 'spki', format: 'pem' });
    const keyId = 'fixture-' + role + '-key'; artifacts[keyId] = pem;
    pins[role] = { keyId, artifactSha256: sha(pem), spkiSha256: sha(keyPairs[role].publicKey.export({ type: 'spki', format: 'der' })) };
  }
  const identity = { repository: 'Cheekyfellastef/stephan-os', prNumber: 3424,
    branch: 'feature/starfield-native-monitor-splash-20261106', sourceHead: 'a'.repeat(40), baseSha: 'b'.repeat(40) };
  const before = new Map(), after = new Map(), blobs = new Map();
  for (const path of paths) {
    const old = Buffer.from('old ' + path + '\n'), fresh = Buffer.from('new ' + path + '\n' + (contentBytes ? 'x'.repeat(contentBytes) + '\n' : ''));
    before.set(path, { mode: '100644', sha: blob(old) }); after.set(path, { mode: '100644', sha: blob(fresh) });
    blobs.set(blob(old), old); blobs.set(blob(fresh), fresh);
  }
  const rendered = formatAuthenticatedReviewDiffV1({ base: identity.baseSha, head: identity.sourceHead, before, after, blobs,
    authenticatedObjectIds: ['commit:' + identity.baseSha, 'commit:' + identity.sourceHead,
      'tree:' + 'c'.repeat(40), 'tree:' + 'd'.repeat(40), ...[...blobs.keys()].map(id => 'blob:' + id)] });
  const coverage = assessSovereignReviewCoverageV1({ ...identity, changedFiles: [...paths].sort() });
  const record = { schemaVersion: 'stephanos.sovereign-specialist-enrollment.v1', enrollmentId: 'fixture-enrollment',
    repository: identity.repository, reviewerId: 'fixture-reviewer', provider: 'sovereign-local-ollama', modelClass: 'fixture-model',
    modelDigestSha256: sha('fixture-model'), reviewerPrincipal: 'fixture-reviewer-account', reviewerPrincipalSha256: sha('fixture-reviewer-sid'),
    auditorPrincipal: 'fixture-auditor-account', auditorPrincipalSha256: sha('fixture-auditor-sid'),
    witnessPrincipal: 'fixture-witness-account', witnessPrincipalSha256: sha('fixture-witness-sid'), deviceIdSha256: sha('fixture-device'),
    protectedRuntimeProfileSha256: sha('fixture-runtime-profile'), signerCustodyProfileSha256: sha('fixture-signer-profile'),
    reentryTaskDefinitionSha256: sha('fixture-task-definition'), negativeWriteTargets: Object.fromEntries(
      ['reviewer-executable', 'reviewer-key', 'auditor-key', 'witness-key', 'trust-registry'].map(role => [role, sha('target:' + role)])),
    keys: pick(pins, ['reviewer', 'auditor', 'witness']), allowedDomains: [...coverage.domains],
    domainQualificationSha256: Object.fromEntries(coverage.domains.map(domain => [domain, sha('qualification:' + domain)])),
    maxDiffBytes: 1024 * 1024, commissioningProofSha256: sha('fixture-commissioning'),
    nativeCommissioningProofSha256: sha('fixture-native-commissioning'), independentReviewArtifactSha256: sha('fixture-independent-review'),
    operatorApprovalRef: 'https://github.com/Cheekyfellastef/stephan-os/issues/1574#issuecomment-123',
    notBeforeUtc: iso(now - 86400000), expiresAtUtc: iso(now + 86400000), revokedAtUtc: null, minimumJournalGeneration: 7,
    outOfBandAuditor: outOfBand ? { principal: 'fixture-out-of-band-account', principalSha256: sha('fixture-root-sid'),
      key: pins.root, commissioningProofSha256: sha('fixture-root-commissioning') } : null,
    reviewExecutionProfile: { profileSha256: sha('fixture-execution-profile'), promptTemplateSha256: sha('fixture-template'),
      modelContextTokens: 1048576, maximumReviewDurationMs: 780000, maximumOutputTokens: 4096,
      tokenizerKind: 'UTF8_BYTE_UPPER_BOUND', tokenizerArtifactSha256: null },
  };
  const artifact = { schemaVersion: SOVEREIGN_SPECIALIST_ARTIFACT_SCHEMA_V1,
    kind: 'stephanos.sovereign-qualified-specialist-review.artifact', ...identity,
    sourceTree: 'c'.repeat(40), baseTree: 'd'.repeat(40), diffRepresentation: rendered.representation,
    fullDiffSha256: rendered.fullDiffSha256, diffBytes: Buffer.byteLength(rendered.fullDiff),
    reviewedObjectClosureSha256: rendered.reviewedObjectClosureSha256, sourceEvidence: rendered.sourceEvidence.map(row => ({ ...row })),
    reviewDomains: [...coverage.domains], enrollmentId: record.enrollmentId, reviewNonce: sha('fixture-review-nonce'),
    modelDigestSha256: record.modelDigestSha256, escalationPaths: [...paths].sort(),
    receipt: createProviderNeutralReviewReceipt({ receiptId: 'fixture-specialist-review', ...identity, issueNumber: 1574,
      reviewerId: record.reviewerId, reviewerClass: 'external-qualified', provider: record.provider, modelClass: record.modelClass,
      reviewerSessionId: 'fixture-review-session', implementerProvider: 'fixture-implementer-provider', implementerSessionId: 'fixture-build-session',
      riskTier: 'high', assuranceMode: 'specialist', reviewScope: ['complete-exact-head-diff', ...coverage.domains.map(domain => 'domain:' + domain)],
      findings: [], verdict: 'clean', timestampUtc: iso(now - 5000), proofRefs: ['proofs/fixture-native-review'], quorumChecks: [], blocker: '' }),
  };
  const measurements = {
    'native-windows-identity': { platform: 'win32', deviceIdSha256: record.deviceIdSha256,
      tokenUserSidSha256: record.reviewerPrincipalSha256, effectivePrincipalSha256: record.reviewerPrincipalSha256,
      processId: 101, processCreatedAtUtc: iso(now - 60000), tokenReadbackSha256: sha('fixture-token-readback') },
    'original-writer-negative-write': { actorPrincipalSha256: sha('fixture-implementer-sid'),
      probes: Object.entries(record.negativeWriteTargets).map(([role, objectSha256]) => ({ role, objectSha256, win32Error: 5, evidenceSha256: sha('probe:' + role) })) },
    'direct-and-task-reentry-denial': { actorPrincipalSha256: sha('fixture-implementer-sid'), taskDefinitionSha256: record.reentryTaskDefinitionSha256,
      directWin32Error: 5, taskWin32Error: 5, directEvidenceSha256: sha('direct-denial'), taskEvidenceSha256: sha('task-denial') },
    'separate-protected-signers': { store: 'ADMIN_PROTECTED_NATIVE_KEY_STORE', profileSha256: record.signerCustodyProfileSha256,
      reviewerSpkiSha256: pins.reviewer.spkiSha256, auditorSpkiSha256: pins.auditor.spkiSha256,
      witnessSpkiSha256: pins.witness.spkiSha256, readbackEvidenceSha256: sha('signer-custody-readback') },
    'independently-audited-commissioning': { commissioningProofSha256: record.commissioningProofSha256,
      nativeCommissioningProofSha256: record.nativeCommissioningProofSha256, installedHead: identity.baseSha,
      installedTree: artifact.baseTree, installedClosureSha256: sha('fixture-installed-closure'),
      protectedRuntimeProfileSha256: record.protectedRuntimeProfileSha256, fullBootWitnessSha256: sha('fixture-boot'),
      independentAuditProofSha256: sha('fixture-independent-native-audit') },
  };
  artifact.nativeEvidence = { payload: { schemaVersion: domains.native,
    sourceBindingSha256: hashObject(sourceBinding(artifact)), reviewNonce: artifact.reviewNonce, modelDigestSha256: record.modelDigestSha256,
    deviceIdSha256: record.deviceIdSha256, implementerPrincipal: 'fixture-implementer-account', implementerPrincipalSha256: sha('fixture-implementer-sid'),
    reviewerPrincipalSha256: record.reviewerPrincipalSha256, auditorPrincipalSha256: record.auditorPrincipalSha256,
    witnessPrincipalSha256: record.witnessPrincipalSha256, reviewerSessionId: artifact.receipt.reviewerSessionId,
    implementerSessionId: artifact.receipt.implementerSessionId, observedAtUtc: iso(now - 6000), expiresAtUtc: iso(now + 3000000), measurements }, signatureBase64: '' };
  const candidateResult = windows => ({ schemaVersion: windows ? SOVEREIGN_WINDOWS_CALIBRATION_SCHEMA : SOVEREIGN_CALIBRATION_SCHEMA,
    status: windows ? 'WINDOWS_CALIBRATION_CANDIDATE_PASSED_UNATTESTED' : 'CALIBRATION_CANDIDATE_PASSED_UNATTESTED', reason: '',
    repository: identity.repository, sourceHead: identity.sourceHead, baseSha: identity.baseSha, reviewerPrincipal: record.reviewerPrincipal,
    reviewerProvider: record.provider, reviewerSessionId: artifact.receipt.reviewerSessionId,
    manifestSha256: windows ? sovereignWindowsCalibrationManifestV1().manifestSha256 : SOVEREIGN_CALIBRATION_MANIFEST_SHA256,
    observationsSha256: sha('fixture-observations-' + windows), completedCases: windows ? SOVEREIGN_WINDOWS_CALIBRATION_CASE_COUNT : SOVEREIGN_CALIBRATION_CASE_COUNT,
    passedCases: windows ? SOVEREIGN_WINDOWS_CALIBRATION_CASE_COUNT : SOVEREIGN_CALIBRATION_CASE_COUNT, missed: [],
    ...(windows ? { qualification: 'PENDING_INDEPENDENT_WINDOWS_SPECIALIST_ATTESTATION', qualifiedWindowsSpecialist: false,
      independentSecurityReviewSatisfied: false, independentHostAttestation: false, signatureVerified: false, protectedMergeAuthority: false,
      serviceInstallationAuthority: false, sourceMutationAuthority: false, leaseReleaseAuthority: false, signedWindowsCustodyProven: false,
      physicalPickupProven: false } : { independentHostAttestation: false, signatureVerified: false, specialistAuthority: false,
      independentReviewSatisfied: false, protectedMergeAuthority: false, sourceMutationAuthority: false, leaseReleaseAuthority: false,
      windowsCommissioningAuthority: false, physicalPickupProven: false }),
  });
  artifact.baselineCalibration = { modelDigestSha256: record.modelDigestSha256, observedAtUtc: iso(now - 120000), result: candidateResult(false) };
  artifact.windowsCalibration = { modelDigestSha256: record.modelDigestSha256, observedAtUtc: iso(now - 60000), result: candidateResult(true) };
  artifact.capabilityExam = { repository: identity.repository, sourceHead: identity.sourceHead, baseSha: identity.baseSha,
    implementerPrincipal: artifact.nativeEvidence.payload.implementerPrincipal, reviewerPrincipal: record.reviewerPrincipal,
    auditorPrincipal: record.auditorPrincipal, implementerProvider: artifact.receipt.implementerProvider, reviewerProvider: record.provider,
    hardcodedCodexSpecialistGateStillRequired: true,
    receipts: [...LOCAL_REVIEW_EXAM_CHALLENGES, ...LOCAL_REVIEW_EXAM_PRIVILEGED].map(challengeId => ({ schemaVersion: LOCAL_REVIEW_EXAM_SCHEMA,
      challengeId, repository: identity.repository, sourceHead: identity.sourceHead, baseSha: identity.baseSha,
      reviewerPrincipal: record.reviewerPrincipal, auditorPrincipal: record.auditorPrincipal,
      observedAtUtc: iso(now - (LOCAL_REVIEW_EXAM_PRIVILEGED.includes(challengeId) ? 6000 : 60000)), outcome: 'passed',
      evidenceSha256: LOCAL_REVIEW_EXAM_PRIVILEGED.includes(challengeId) ? hashObject(measurements[challengeId]) : sha('fixture-exam:' + challengeId), signatureBase64: '' })),
  };
  const governor = at => ({ schemaVersion: 'stephanos.vr-resource-governor.v1', governorVersion: 3,
    updatedAtUtc: iso(at), active: false, flatGameActive: false, airLinkActive: false, realAirLinkActive: false,
    virtualAirLinkTestActive: false, prepareLeaseActive: false, localModelAllowed: true, heavyModelAllowed: true,
    ollamaLoadMode: 'balanced', observationSha256: sha('fixture-governor:' + at) });
  const promptBytes = artifact.diffBytes + 1024, promptSha = sha('fixture-prompt:' + rendered.fullDiff);
  artifact.reviewExecution = { payload: { schemaVersion: domains.execution, sourceBindingSha256: hashObject(sourceBinding(artifact)),
    reviewNonce: artifact.reviewNonce, modelDigestSha256: record.modelDigestSha256, profileSha256: record.reviewExecutionProfile.profileSha256,
    stage: 'COMPLETE_CROSS_FILE_REVIEW', fullDiffSha256: artifact.fullDiffSha256, reviewedObjectClosureSha256: artifact.reviewedObjectClosureSha256,
    reviewedPathsSha256: hashObject(artifact.sourceEvidence.map(row => row.path)), startedAtUtc: iso(now - 17000), finishedAtUtc: iso(now - 7000),
    prompt: { sha256: promptSha, bytes: promptBytes, inputTokens: promptBytes, templateSha256: record.reviewExecutionProfile.promptTemplateSha256,
      includedDiffSha256: artifact.fullDiffSha256, includedDiffBytes: artifact.diffBytes, tokenizerKind: 'UTF8_BYTE_UPPER_BOUND', tokenizerArtifactSha256: null,
      tokenCountEvidenceSha256: hashObject({ schemaVersion: 'stephanos.utf8-token-upper-bound.v1', promptSha256: promptSha, bytes: promptBytes }) },
    runtime: { contextTokens: record.reviewExecutionProfile.modelContextTokens, outputTokenReserve: 4096, actualPromptTokens: promptBytes,
      actualOutputTokens: 100, doneReason: 'stop', responseSha256: sha('fixture-model-response'), modelSelector: 'sha256:' + record.modelDigestSha256 + ':local' },
    governorChecks: { intervalMs: 500, count: 22, interruptedCount: 0, observationChainSha256: sha('fixture-governor-chain'),
      before: governor(now - 17000), after: governor(now - 7000) } }, signatureBase64: '' };
  const fixture = { now, identity, record, records: [record], artifacts, keyPairs, artifact, rendered,
    expected: { ...identity, paths: [...paths].sort(), sovereignSourceBinding: sourceBinding(artifact) } };
  resealFixture(fixture);
  return fixture;
}

export function resealFixture(fixture) {
  const { artifact: a, keyPairs: k, record: r, now } = fixture;
  a.nativeEvidence.signatureBase64 = signature(domains.native, a.nativeEvidence.payload, k.witness.privateKey);
  a.reviewExecution.signatureBase64 = signature(domains.execution, a.reviewExecution.payload, k.witness.privateKey);
  for (const receipt of a.capabilityExam.receipts) {
    const { signatureBase64, ...unsigned } = receipt;
    receipt.signatureBase64 = sign(null, Buffer.from(LOCAL_REVIEW_EXAM_SCHEMA + '\0' + JSON.stringify(unsigned)), k.auditor.privateKey).toString('base64');
  }
  const coreFields = ['schemaVersion', 'kind', ...sourceFields, 'enrollmentId', 'reviewNonce', 'modelDigestSha256',
    'escalationPaths', 'receipt', 'nativeEvidence', 'baselineCalibration', 'windowsCalibration', 'capabilityExam', 'reviewExecution'];
  a.reviewerSignatureBase64 = signature(domains.review, pick(a, coreFields), k.reviewer.privateKey);
  const binding = sovereignSpecialistReviewBindingV1(a);
  const auditor = { schemaVersion: domains.auditor, reviewBindingSha256: binding,
    reviewerSignatureSha256: sha(Buffer.from(a.reviewerSignatureBase64, 'base64')), enrollmentId: a.enrollmentId,
    modelDigestSha256: a.modelDigestSha256, qualifiedDomains: [...a.reviewDomains],
    ...Object.fromEntries(['nativeEvidence', 'capabilityExam', 'baselineCalibration', 'windowsCalibration', 'reviewExecution'].map(field => [field + 'Sha256', hashObject(a[field])])),
    verdict: 'INDEPENDENT_SPECIALIST_EVIDENCE_ACCEPTED', observedAtUtc: iso(now - 4000), expiresAtUtc: iso(now + 3000000) };
  a.auditorAttestation = signProof(domains.auditor, auditor, k.auditor.privateKey);
  a.replayWitness = signProof(domains.replay, { schemaVersion: domains.replay, enrollmentId: a.enrollmentId,
    reviewBindingSha256: binding, reviewNonce: a.reviewNonce, journalGeneration: r.minimumJournalGeneration,
    journalEntrySha256: sha('fixture-journal-entry'), state: 'BOUND_TO_EXACT_REVIEW',
    observedAtUtc: iso(now - 3000), expiresAtUtc: iso(now + 3000000) }, k.witness.privateKey);
  a.selfChangeAttestation = r.outOfBandAuditor ? signProof(domains.selfChange, { schemaVersion: domains.selfChange,
    reviewBindingSha256: binding, commissioningProofSha256: r.outOfBandAuditor.commissioningProofSha256,
    independentPolicyReviewSha256: sha('fixture-independent-policy-review'), observedAtUtc: iso(now - 2000), expiresAtUtc: iso(now + 3000000) }, k.root.privateKey) : null;
  sealOuter(a);
}

export function commentFor(fixture, id = 1201) {
  return { id, issue_url: `https://api.github.com/repos/${fixture.identity.repository}/issues/${fixture.identity.prNumber}`,
    created_at: iso(fixture.now - 1000), updated_at: iso(fixture.now - 1000),
    body: SOVEREIGN_SPECIALIST_COMMENT_MARKER_V1 + '\n```json\n' + canonical(fixture.artifact) + '\n```' };
}
export function findingsFor(fixture) {
  const findings = fixture.artifact.escalationPaths.map(path => ({ severity: 'P0', code: 'unsupported-high-risk-surface',
    path, summary: 'Fixture requires independently qualified specialist coverage.' }));
  return { schemaVersion: 'stephanos.independent-security-analysis.v1', verdict: 'findings', findings,
    counts: { P0: findings.length, P1: 0, P2: 0 }, proofRefs: ['proofs/fixture-original-findings'], finalVerdict: 'INDEPENDENT_SECURITY_REVIEW_FINDINGS' };
}

let fixtureModule = 0;
export async function isolatedModules(fixture) {
  const root = new URL('../', import.meta.url);
  const dataUrl = text => 'data:text/javascript;base64,' + Buffer.from(text).toString('base64');
  const registry = dataUrl('export const SOVEREIGN_SPECIALIST_ENROLLMENTS_V1=' + JSON.stringify(fixture.records)
    + ';export const SOVEREIGN_SPECIALIST_PUBLIC_ARTIFACTS_V1=' + JSON.stringify(fixture.artifacts) + ';');
  const replacements = new Map([['./sovereignQualifiedSpecialistEnrollmentV1.mjs', registry]]);
  const rewrite = path => readFileSync(new URL(path, root), 'utf8').replace(/(from\s+|import\s*\()(['"])(\.\.?\/[^'"]+)\2/g,
    (whole, before, quote, specifier) => before + JSON.stringify(replacements.get(specifier) || new URL(specifier, new URL(path, root)).href));
  const verifierUrl = dataUrl(rewrite('sovereignQualifiedSpecialistReviewV1.mjs')) + '#fixture-' + (++fixtureModule);
  replacements.set('./sovereignQualifiedSpecialistReviewV1.mjs', verifierUrl);
  const qualifiedUrl = dataUrl(rewrite('qualifiedSpecialistReviewV1.mjs')) + '#fixture-' + fixtureModule;
  replacements.set('./qualifiedSpecialistReviewV1.mjs', qualifiedUrl);
  const artifactUrl = dataUrl(rewrite('operatorMergeReviewArtifactV1.mjs')) + '#fixture-' + fixtureModule;
  return { verifier: await import(verifierUrl), qualified: await import(qualifiedUrl), artifact: await import(artifactUrl) };
}
