// One-source, cross-domain intake for the EXISTING Sovereign Reviewer.
// Classification is a read-only review preparation aid, NEVER proof that
// any local model has become an authenticated or qualified specialist.
export const SOVEREIGN_REVIEW_COVERAGE_SCHEMA = 'stephanos.sovereign-review-coverage.v1';
export const SOVEREIGN_REVIEW_DOMAINS = Object.freeze([
  'standard-source', 'windows-os-and-services', 'openclaw-and-agents',
  'original-source-lease', 'secrets-and-identity',
  'github-policy-and-protected-merge', 'reviewer-trust-and-approval',
  'browser-and-runtime-proof', 'daemon-and-deployment', 'other-execution-or-policy',
]);

const SHA = /^[a-f0-9]{40}$/;
const REPO = /^[a-z0-9_.-]+\/[a-z0-9_.-]+$/i;
const BRANCH = /^[a-z0-9][a-z0-9._/-]{0,180}$/i;
const PATH = /^(?:[a-z0-9]|\.[a-z0-9])[a-z0-9._/-]{0,240}$/i;
const DOMAIN_PATTERNS = Object.freeze([
  ['windows-os-and-services', /^(?:scripts\/windows\/|src\/windows\/)|windows(?:authority|custody|witness|service|token|acl|dacl|scm)/i],
  ['openclaw-and-agents', /(?:openclaw|agent(?:-trust|-policy|-execution|-isolation)|\bskills\/)/i],
  ['original-source-lease', /(?:lease|source.?custody|source.?writer|orphan.?quarantine|goal.?builder|source.?builder|escrow|mission.?worker|goal.?conveyor)/i],
  ['secrets-and-identity', /(?:secret|credential|auth(?:entication|orization|ority)?|signer|private.?key|permission|token|trust.?root)/i],
  ['github-policy-and-protected-merge', /(?:^\.github\/|protected.?merge|github.?auth|github.?observation|branch.?protection|operator.?merge|independent.?merge)/i],
  ['reviewer-trust-and-approval', /(?:sovereign.?review|qualified.?specialist|provider.?neutral.?review|independent.?review|reviewer.?trust|review.?admission|operator.?approval)/i],
  ['browser-and-runtime-proof', /(?:browser.?proof|playwright|ui.?proof|runtime.?proof|screenshot|served.?asset)/i],
  ['daemon-and-deployment', /(?:daemon|watchdog|recovery.?mesh|ignition|deploy|publisher|scheduled.?task|runtime.?restart|sovereign.?commander)/i],
]);
const UNKNOWN_HIGH_RISK_PATH = /^(?:scripts\/|shared\/agents\/|shared\/runtime\/|stephanos-server\/services\/|plugins\/)/i;
const PHYSICAL = new Set(['windows-os-and-services', 'original-source-lease',
  'browser-and-runtime-proof', 'daemon-and-deployment']);
const SECURITY = new Set(['windows-os-and-services', 'openclaw-and-agents',
  'original-source-lease', 'secrets-and-identity',
  'github-policy-and-protected-merge', 'reviewer-trust-and-approval',
  'daemon-and-deployment', 'other-execution-or-policy']);
const noAuthority = Object.freeze({
  qualifiedIndependentReview: false,
  qualifiedWindowsSpecialist: false,
  specialistAuthority: false,
  reviewAcceptanceAuthority: false,
  reviewerEnrollmentAuthority: false,
  protectedMergeAuthority: false,
  operatorApprovalAuthority: false,
  sourceMutationAuthority: false,
  privilegedWindowsAuthority: false,
  originalLeaseReleaseAuthority: false,
  runtimeDeploymentAuthority: false,
  physicalPickupProven: false,
});
const fail = reason => Object.freeze({
  schemaVersion:SOVEREIGN_REVIEW_COVERAGE_SCHEMA,
  status:'REVIEW_COVERAGE_HELD', reason,
  domains:Object.freeze([]), reviewPackets:Object.freeze([]),
  blockers:Object.freeze([reason]), meteredReviewReplacementQualified:false,
  ...noAuthority,
});
const unique = values => Object.freeze([...new Set(values)]);
const hasDenseArray = value => Array.isArray(value)
  && Array.from({length:value.length},(_,i)=>Object.hasOwn(value,i)).every(Boolean);

export function assessSovereignReviewCoverageV1(input = {}) {
  const {repository,prNumber,branch,sourceHead,baseSha,changedFiles} = input;
  if (!REPO.test(repository ?? '') || !Number.isSafeInteger(prNumber) || prNumber < 1
    || !BRANCH.test(branch ?? '') || branch.includes('..')
    || !SHA.test(sourceHead ?? '') || !SHA.test(baseSha ?? '') || sourceHead===baseSha) {
    return fail('EXACT_PR_BASE_AND_HEAD_REQUIRED');
  }
  if (!hasDenseArray(changedFiles) || changedFiles.length < 1 || changedFiles.length > 160
    || changedFiles.some(path => typeof path !== 'string' || !PATH.test(path)
      || path.includes('..') || path.startsWith('/'))
    || new Set(changedFiles).size !== changedFiles.length) return fail('COMPLETE_CHANGED_PATHS_REQUIRED');
  const domains = new Map();
  for (const path of changedFiles) {
    let matched = false;
    for (const [domain, regex] of DOMAIN_PATTERNS) {
      if (regex.test(path)) {
        matched=true;
        domains.set(domain,(domains.get(domain) || 0)+1);
      }
    }
    if (!matched) {
      const category=UNKNOWN_HIGH_RISK_PATH.test(path)
        ? 'other-execution-or-policy' : 'standard-source';
      domains.set(category,(domains.get(category)||0)+1);
    }
  }
  const highRisk = [...domains.keys()].some(domain => SECURITY.has(domain));
  const ordered = SOVEREIGN_REVIEW_DOMAINS.filter(domain=>domains.has(domain));
  // Select an EXISTING local read-only candidate engine for each review class.
  // Distinguish candidate source availability from live execution/approval.
  const packets = ordered.map(domain => {
    const riskTier = SECURITY.has(domain) ? 'high' : 'standard';
    const physical = PHYSICAL.has(domain);
    const needs = unique([
      'EXACT_HEAD_BASE_TREE_AND_COMPLETE_DIFF',
      'SEPARATE_IMPLEMENTER_AND_REVIEWER_PRINCIPALS',
      'INDEPENDENTLY_AUTHENTICATED_REVIEWER_OR_QUORUM',
      ...(riskTier === 'high' ? ['QUALIFIED_SPECIALIST_SECURITY_REVIEW'] : []),
      ...(physical ? ['PHYSICAL_BATTLE_BRIDGE_OR_BROWSER_RECEIPT'] : []),
      ...(domain === 'windows-os-and-services'
        ? ['NATIVE_WINDOWS_TOKEN_ACL_REENTRY_AND_HANDLE_EVIDENCE'] : []),
      ...(domain === 'original-source-lease'
        ? ['HISTORIC_R7_CUSTODY_SIGNED_WITNESS_AND_SEPARATE_OPERATOR_CAS'] : []),
      ...(domain === 'reviewer-trust-and-approval'
        ? ['OUT_OF_BAND_TRUST_ROOT_AND_PROTECTED_SELF_CHANGE_REVIEW'] : []),
    ]);
    return Object.freeze({
      domain, changedPathCount:domains.get(domain), riskTier,
      localCandidateRunner:riskTier === 'high'
        ? 'scripts/sovereign-high-risk-advisory-launcher-v1.mjs'
        : 'scripts/sovereign-reviewer-v1.mjs',
      supplementalWindowsExam:domain === 'windows-os-and-services'
        ? 'scripts/sovereign-windows-review-calibration-v1.mjs' : '',
      requiredEvidence:needs, candidateOnly:true,
      independentQualificationVerified:false, physicalRuntimeProven:false,
      acceptedProtectedReview:false,
    });
  });
  return Object.freeze({
    schemaVersion:SOVEREIGN_REVIEW_COVERAGE_SCHEMA,
    status:highRisk?'HIGH_RISK_LOCAL_CANDIDATE_SCOPE_ONLY':'STANDARD_LOCAL_CANDIDATE_SCOPE_ONLY',
    repository,prNumber,branch,sourceHead,baseSha,
    reviewedPathCount:changedFiles.length, domains:unique(ordered),
    reviewPackets:Object.freeze(packets),
    blockers:unique([
      'ACTUAL_LOCAL_MODEL_REVIEW_NOT_ATTESTED',
      'TRUSTED_REVIEWER_ADMISSION_NOT_PROVEN',
      ...(highRisk?['QUALIFIED_HIGH_RISK_SPECIALIST_NOT_PROVEN']:[]),
      ...(ordered.some(d=>PHYSICAL.has(d))?['LIVE_PHYSICAL_PROOF_NOT_PROVEN']:[]),
    ]),
    // An inventory is never an authority-bearing attestation or replacement.
    meteredReviewReplacementQualified:false,
    ...noAuthority,
  });
}


// These source-review hints help the existing local high-risk model inspect
// every class. They are NOT host observations, reviewer admission or policy.
const REVIEW_FOCUS = Object.freeze({
  'standard-source':Object.freeze(['Check changed code semantics, tests, callers and error paths.']),
  'windows-os-and-services':Object.freeze([
    'Inspect SCM service/token SID verification and restricted account boundaries.',
    'Inspect effective Windows write denial, inherited ACEs, handles and task re-entry.',
    'Check privileged witness and signer isolation; never infer custody from RUNNING status.',
  ]),
  'openclaw-and-agents':Object.freeze([
    'Check tool scope, agent role separation, plugin permissions and untrusted command surfaces.',
    'Reject confused-deputy execution, arbitrary shell and cross-workspace privilege expansion.',
  ]),
  'original-source-lease':Object.freeze([
    'Check exclusive source lease ownership, compare-and-swap digests and re-entry fencing.',
    'Do not equate dispatch with physical SELECT CLAIM PICKUP or historical custody.',
  ]),
  'secrets-and-identity':Object.freeze([
    'Check secret logging, signer key storage, identity bootstrap and token permissions.',
    'Treat caller-provided identities, signatures and key pins as untrusted until independently verified.',
  ]),
  'github-policy-and-protected-merge':Object.freeze([
    'Check protected merge rules, GitHub actor provenance and exact HEAD BASE and tree binding.',
    'Reject workflow bypasses, unsafe pull-request input and stale approval replay.',
  ]),
  'reviewer-trust-and-approval':Object.freeze([
    'Check reviewer independence and protected self-review or self-enrollment bypasses.',
    'Never treat a local model verdict or signed claim as externally trusted specialist admission.',
  ]),
  'browser-and-runtime-proof':Object.freeze([
    'Check served-head identity, browser screenshot and DOM provenance and negative cases.',
    'Do not infer live UI success from source tests or an unverified local screenshot.',
  ]),
  'daemon-and-deployment':Object.freeze([
    'Check process and service ownership, exact running version and restart fencing.',
    'Check stale binary/config generations and termination limited to verified-owned processes.',
  ]),
  'other-execution-or-policy':Object.freeze([
    'Escalate unknown executable, worker, review and authority-bearing paths conservatively.',
    'Check caller-to-executor command/permission boundaries and unintended side effects.',
  ]),
});
export function sovereignReviewSourceFocusV1(domains = []) {
  if (!Array.isArray(domains) || domains.some(x => !Object.hasOwn(REVIEW_FOCUS, x))) {
    return Object.freeze([]);
  }
  return unique(domains.flatMap(domain => REVIEW_FOCUS[domain])).slice(0, 24);
}
