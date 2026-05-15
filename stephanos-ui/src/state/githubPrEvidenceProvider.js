function asText(value, fallback = '') { const text = String(value ?? '').trim(); return text || fallback; }
function asList(value) { return Array.isArray(value) ? value.filter(Boolean).map((v) => String(v).trim()).filter(Boolean) : []; }

export function parsePrReferenceFromPrompt(prompt = '') {
  const text = asText(prompt, '');
  const prUrl = text.match(/https?:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/pull\/(\d+)/i);
  const num = text.match(/\bpr\s*#?\s*(\d{1,8})\b|#(\d{1,8})\b/i);
  const number = prUrl ? Number(prUrl[3]) : Number(num?.[1] || num?.[2] || 0) || null;
  const repo = prUrl ? `${prUrl[1]}/${prUrl[2]}` : asText(text.match(/\brepo(?:sitory)?\s*[:=-]\s*([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)/i)?.[1], '');
  return {
    prNumber: number,
    repo,
    prUrl: asText(prUrl?.[0], ''),
    parseConfidence: number ? (repo ? 'high' : 'medium') : 'low',
    parseWarnings: number ? [] : ['pr_number_not_detected'],
  };
}

export function buildGithubPrEvidenceProvider(input = {}) {
  const connector = input.connectorEvidence || {};
  const pasted = input.pastedEvidence || {};
  const promptRef = parsePrReferenceFromPrompt(input.operatorPrompt || '');
  const source = asText(connector.source || pasted.source || (promptRef.prNumber ? 'operator-input' : ''), 'none');
  const prNumber = connector.prNumber ?? pasted.prNumber ?? promptRef.prNumber ?? null;
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
  const codexTaskPresent = codexTaskRefs.length > 0 ? 'yes' : 'no';
  const evidenceWarnings = [...asList(connector.evidenceWarnings), ...asList(pasted.evidenceWarnings), ...promptRef.parseWarnings];
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
  let recommendedNextAction = 'Connect/read GitHub PR evidence or paste PR summary.';
  if (source !== 'none' || prNumber) {
    status = 'parsed';
    recommendedNextAction = 'Collect checks/build/verify/browser proof before merge decision.';
  }
  if (merged) { mergeReadiness = 'already-merged'; recommendedNextAction = 'Run post-merge validation.'; }
  else if (!prNumber) { mergeReadiness = 'wait'; }
  else if (checksStatus === 'failed' || buildStatus === 'failed' || verifyStatus === 'failed') { mergeReadiness = 'needs-amendment'; }
  else if (missingProof.length > 0) { mergeReadiness = 'needs-proof'; }
  else if (status === 'parsed') { mergeReadiness = 'merge-candidate'; recommendedNextAction = 'Operator review before merge.'; }

  return { status, source, repo, prNumber, prTitle: asText(connector.prTitle || pasted.prTitle, ''), prState, merged, headSha: asText(connector.headSha || pasted.headSha, ''), baseBranch: asText(connector.baseBranch || pasted.baseBranch, ''), changedFiles, changedFileCount: changedFiles.length, checksStatus, failingChecks, buildStatus, verifyStatus, browserProofStatus, codexTaskPresent, codexTaskRefs, latestCommitSha: asText(connector.latestCommitSha || pasted.latestCommitSha, ''), evidenceWarnings, missingProof, mergeReadiness, recommendedNextAction, parseConfidence: promptRef.parseConfidence, parseWarningCount: promptRef.parseWarnings.length };
}
