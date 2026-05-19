import { normalizeLiveGithubPrEvidence } from './prEvidenceConnectorModel.js';
import { buildApiUrl } from '../ai/apiConfig.js';

function asText(value, fallback = '') { const text = String(value ?? '').trim(); return text || fallback; }
function asList(value) { return Array.isArray(value) ? value.filter(Boolean).map((v) => String(v).trim()).filter(Boolean) : []; }

export function parsePrReferenceFromPrompt(prompt = '') {
  const text = asText(prompt, '');
  const prUrl = text.match(/https?:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/pull\/(\d+)(?:\b|[/?#])/i);
  const num = text.match(/\bpr\s*#?\s*(\d{1,8})\b|\bpull\s+request\s*#?\s*(\d{1,8})\b|#(\d{1,8})\b/i);
  const number = prUrl ? Number(prUrl[3]) : Number(num?.[1] || num?.[2] || num?.[3] || 0) || null;
  const repo = prUrl ? `${prUrl[1]}/${prUrl[2]}` : asText(text.match(/\brepo(?:sitory)?\s*[:=-]\s*([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)/i)?.[1], '');
  return {
    prNumber: number,
    repo,
    prUrl: asText(prUrl?.[0], ''),
    parseConfidence: number ? 'high' : 'low',
    parseWarnings: number ? [] : ['pr_number_not_detected'],
  };
}

function pickBestPromptSource(input = {}) {
  const candidates = [
    input.operatorPrompt,
    input.retrievalQuery,
    input.retrieval_query,
    input.chatContextMatchInput,
    input.chat_context_match_input,
    input.matchInput,
    input.rawInput,
    input.raw_input,
    input.normalizedOperatorMessage,
    input.normalized_operator_message,
    input.operatorMessage,
  ];
  for (const candidate of candidates) {
    const text = asText(candidate, '');
    if (text) return text;
  }
  return '';
}

export function buildGithubPrEvidenceProvider(input = {}) {
  const normalizedLiveEvidence = normalizeLiveGithubPrEvidence(input.liveGithubPrEvidence || input.connectorEvidence?.liveGithubPrEvidence);
  const connector = normalizedLiveEvidence || input.connectorEvidence || {};
  const pasted = input.pastedEvidence || {};
  const parseInput = pickBestPromptSource(input);
  const promptRef = parsePrReferenceFromPrompt(parseInput);
  const hasConnectorPayload = connector && Object.keys(connector).length > 0;
  const hasPastedPayload = pasted && Object.keys(pasted).length > 0;
  const connectorStatus = asText(connector.status || '', '');
  const source = asText(connector.source || pasted.source || (hasConnectorPayload ? 'connector' : (hasPastedPayload ? 'pasted' : 'none')), 'none');
  const prNumber = connector.prNumber ?? pasted.prNumber ?? promptRef.prNumber ?? null;
  const parsedPrNumber = promptRef.prNumber ?? connector.parsedPrNumber ?? pasted.parsedPrNumber ?? prNumber ?? null;
  const prUrl = asText(connector.prUrl || pasted.prUrl || promptRef.prUrl, '');
  const repo = asText(connector.repo || pasted.repo || promptRef.repo, '');
  const changedFiles = asList(connector.changedFiles || pasted.changedFiles);
  const checksStatus = asText(connector.checksStatus || pasted.checksStatus, 'unknown');
  const buildStatus = asText(connector.buildStatus || pasted.buildStatus, 'unknown');
  const verifyStatus = asText(connector.verifyStatus || pasted.verifyStatus, 'unknown');
  const browserProofStatus = asText(connector.browserProofStatus || pasted.browserProofStatus, 'unknown');
  const merged = connector.merged === true || pasted.merged === true;
  const prState = asText(connector.prState || pasted.prState, merged ? 'closed' : 'unknown');
  const failingChecks = asList(connector.failingChecks || pasted.failingChecks);
  const codexTaskRefs = asList(connector.codexTaskRefs || pasted.codexTaskRefs);
  const codexTaskPresent = asText(connector.codexTaskPresent || pasted.codexTaskPresent, codexTaskRefs.length > 0 ? 'yes' : 'no');
  const evidenceWarnings = [...asList(connector.evidenceWarnings), ...asList(pasted.evidenceWarnings)];
  const missingProof = [];
  if (!['passed','success','ok'].includes(checksStatus.toLowerCase()) && checksStatus !== 'unknown') missingProof.push('checks');
  if (buildStatus !== 'passed') missingProof.push('build');
  if (verifyStatus !== 'passed') missingProof.push('verify');
  if (browserProofStatus !== 'passed') missingProof.push('browser');
  if (changedFiles.length > 0 && changedFiles.every((f) => f.startsWith('apps/stephanos/dist/')) && !changedFiles.some((f) => !f.startsWith('apps/stephanos/dist/'))) {
    evidenceWarnings.push('dist_only_change_source_truth_risk');
  }

  let status = 'unavailable';
  let mergeReadiness = 'wait';
  let recommendedNextAction = 'Connect read-only GitHub PR evidence or paste PR summary.';
  if (source !== 'none') {
    status = 'fetched';
    recommendedNextAction = 'Collect checks/build/verify/browser proof before merge decision.';
  } else if (prNumber || prUrl) {
    status = 'needs-connector';
    recommendedNextAction = 'Connector unavailable; connect read-only GitHub evidence or paste PR summary.';
  }
  if ((prNumber || parsedPrNumber) && !repo && source === 'none') {
    status = 'needs-connector';
    recommendedNextAction = 'Configure GitHub read connector with repository context or paste PR summary.';
  }
  if (connectorStatus === 'needs-repo' || source === 'connector-missing-repo') {
    status = 'needs-repo';
    recommendedNextAction = 'Repository is required to fetch read-only GitHub PR evidence.';
  }
  if (connectorStatus === 'needs-configuration' || source === 'connector-missing-configuration') {
    status = 'needs-configuration';
    recommendedNextAction = 'Configure read-only GitHub token/connector to fetch PR evidence.';
  }
  if (connectorStatus === 'needs-pr-number') {
    status = 'needs-pr-number';
    recommendedNextAction = 'Provide a PR number to collect read-only GitHub evidence.';
  }
  if (connectorStatus === 'needs-connector' || source === 'connector-missing') {
    status = 'needs-connector';
    recommendedNextAction = 'Connect read-only GitHub evidence route for PR metadata/checks.';
  }
  if (merged) { mergeReadiness = 'already-merged'; recommendedNextAction = 'Run post-merge validation.'; }
  else if (!prNumber) { mergeReadiness = 'wait'; }
  else if (checksStatus === 'failed' || buildStatus === 'failed' || verifyStatus === 'failed') { mergeReadiness = 'needs-amendment'; recommendedNextAction = 'Ask Codex to amend existing PR and rerun checks.'; }
  else if (missingProof.length > 0) { mergeReadiness = 'needs-proof'; recommendedNextAction = 'Collect missing proof fields before merge decision.'; }
  else if (status === 'fetched') { mergeReadiness = 'merge-candidate'; recommendedNextAction = 'Operator approval required before merge.'; }

  return {
    status, source, repo, prNumber, parsedPrNumber, prUrl,
    adapterVersion: 'github-pr-evidence-readonly.v1',
    readOnly: true,
    writeActionsAllowed: false,
    prTitle: asText(connector.prTitle || pasted.prTitle, ''), prState, merged,
    headSha: asText(connector.headSha || pasted.headSha, ''), baseBranch: asText(connector.baseBranch || pasted.baseBranch, ''),
    changedFiles, changedFileCount: changedFiles.length, checksStatus, failingChecks, buildStatus, verifyStatus, browserProofStatus,
    codexTaskPresent, codexTaskRefs, latestCommitSha: asText(connector.latestCommitSha || pasted.latestCommitSha, ''),
    evidenceWarnings, missingProof, mergeReadiness, recommendedNextAction,
    parseConfidence: promptRef.parseConfidence, parseWarningCount: promptRef.parseWarnings.length,
    parseInput: asText(parseInput, ''), parsedNumberSource: parsedPrNumber ? (promptRef.prNumber ? 'operator-input' : ((connector.parsedPrNumber ?? pasted.parsedPrNumber ?? prNumber) ? 'evidence' : 'none')) : 'none',
  };
}

export async function resolveGithubPrEvidenceReadOnly(input = {}) {
  const promptRef = parsePrReferenceFromPrompt(asText(input.prompt || input.operatorPrompt, ''));
  const prNumber = input.prNumber ?? promptRef.prNumber ?? null;
  const repo = asText(input.repo || promptRef.repo || input.repoConfig?.repo, '');
  const connectorReady = input.connectorAvailable !== false;
  const tokenReady = input.hasToken === true;
  const fetchFn = typeof input.fetchGithubPrEvidence === 'function' ? input.fetchGithubPrEvidence : null;

  if (!prNumber) return { source: 'none' };
  if (!repo) return { source: 'connector-missing-repo', prNumber, parsedPrNumber: promptRef.prNumber ?? prNumber };
  if (!connectorReady) return { source: 'connector-missing', repo, prNumber, parsedPrNumber: promptRef.prNumber ?? prNumber };
  if (fetchFn && !tokenReady) return { source: 'connector-missing-configuration', repo, prNumber, parsedPrNumber: promptRef.prNumber ?? prNumber };

  const [owner, repoName] = repo.split('/');
  const live = fetchFn
    ? await fetchFn({ repo, prNumber, owner, repoName, readOnly: true })
    : await fetchGithubPrEvidenceFromBackend({ owner, repo: repoName, prNumber });
  const backendStatus = asText(live?.status, '');
  const normalized = normalizeLiveGithubPrEvidence({
    ...(live || {}),
    repo,
    prNumber,
    source: live?.source || (backendStatus && backendStatus !== 'fetched' ? backendStatus : (fetchFn ? 'github-live-readonly' : 'github-api/fetched')),
  }) || {};
  return { ...normalized, parsedPrNumber: promptRef.prNumber ?? prNumber };
}

export async function fetchGithubPrEvidenceFromBackend({ owner = '', repo = '', prNumber } = {}) {
  const route = new URL(buildApiUrl('/api/github/pr-evidence'));
  if (owner) route.searchParams.set('owner', owner);
  if (repo) route.searchParams.set('repo', repo);
  route.searchParams.set('pr', String(prNumber || ''));
  const response = await fetch(route.href, { method: 'GET', headers: { Accept: 'application/json' } });
  if (!response.ok) return { status: 'error', source: 'none' };
  const payload = await response.json();
  return payload && typeof payload === 'object' ? payload : { status: 'error', source: 'none' };
}
