import { buildPrEvidenceIntake } from './prEvidenceIntakeModel.js';

function asText(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  const text = String(value).trim();
  return text || fallback;
}

function normalizeChecksStatus(raw = '') {
  const lower = asText(raw, '').toLowerCase();
  if (/fail|error|cancel/.test(lower)) return 'failed';
  if (/pass|success|green/.test(lower)) return 'passed';
  if (/pending|running|queued|in_progress/.test(lower)) return 'pending';
  return 'unknown';
}

function deriveMergeStatus({ merged = false, state = '' } = {}) {
  const s = asText(state, '').toLowerCase();
  if (merged) return 'merged';
  if (s === 'closed') return 'closed_unmerged';
  if (s === 'open') return 'open';
  return 'unknown';
}

export function parsePrEvidenceInput(rawInput = '') {
  const rawPrInput = asText(rawInput, '');
  if (!rawPrInput) {
    return {
      rawPrInput,
      parseConfidence: 'none',
      parseWarnings: ['no_input_supplied'],
      evidenceSource: 'none',
      normalizedPrMetadata: null,
    };
  }

  const prUrl = rawPrInput.match(/https?:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/pull\/(\d+)/i);
  const codexTaskUrlMatch = rawPrInput.match(/https?:\/\/[^\s]*codex[^\s]*/i);
  const codexTaskUrl = asText(codexTaskUrlMatch?.[0], '');
  const codexTaskUrlIdMatch = codexTaskUrl.match(/\/tasks\/([A-Za-z0-9_-]+)/i);
  const codexTaskIdMatch = rawPrInput.match(/codex(?:\s*task)?\s*[:#-]\s*([A-Za-z0-9_-]+)/i) || (codexTaskUrlIdMatch ? [null, codexTaskUrlIdMatch[1]] : null);
  let codexTaskId = asText(codexTaskIdMatch?.[1], '');
  if (/^https?$/i.test(codexTaskId) || /^https?:/i.test(codexTaskId)) codexTaskId = '';
  if (!codexTaskId && codexTaskUrlIdMatch) codexTaskId = asText(codexTaskUrlIdMatch[1], '');
  const numberMatch = rawPrInput.match(/(?:^|\n|\s)(?:pr\s*(?:number)?\s*[:#-]?\s*|#)(\d{1,8})(?:\b|\s)/i);
  const stateMatch = rawPrInput.match(/(?:state|status)\s*[:=-]\s*(open|closed|merged)/i);
  const branchMatch = rawPrInput.match(/(?:branch|head|head\s*branch|source)\s*[:=-]\s*([\w./-]+)/i);
  const baseBranchMatch = rawPrInput.match(/(?:base|target)\s*[:=-]\s*([\w./-]+)/i);
  const mergedByMatch = rawPrInput.match(/merged\s*by\s*[:=-]?\s*([\w.-]+)/i);
  const mergedAtMatch = rawPrInput.match(/merged\s*at\s*[:=-]?\s*([0-9]{4}-[0-9]{2}-[0-9]{2}[^\n]*)/i);
  const directMainCommitMatch = rawPrInput.match(/(?:direct\s+)?main(?:line)?\s+commit(?:\s+detected)?\s*[:=-]?\s*(yes|true|detected|present)?/i);
  const commitShaMatch = rawPrInput.match(/(?:main(?:line)?\s+)?commit\s*(?:sha|hash)?\s*[:=-]\s*([a-f0-9]{7,40})/i);
  const commitAtMatch = rawPrInput.match(/(?:main(?:line)?\s+)?commit\s*(?:at|date|time)\s*[:=-]?\s*([0-9]{4}-[0-9]{2}-[0-9]{2}[^\n]*)/i);
  const commitByMatch = rawPrInput.match(/(?:main(?:line)?\s+)?commit\s*(?:by|author)\s*[:=-]?\s*([\w.-]+)/i);
  const fetchEvidenceMatch = rawPrInput.match(/(?:ignition|git)\s*(?:pull|fetch)\s*(?:evidence|status|truth)?\s*[:=-]?\s*([^\n]+)/i);
  const autoMergeMatch = rawPrInput.match(/auto-?merge\s*[:=-]\s*(enabled|disabled|armed|off|on|unknown)/i);
  const checksMatch = rawPrInput.match(/checks?\s*[:=-]\s*([^\n]+)/i);

  const changedFiles = rawPrInput
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^[-*•]\s+/.test(line) || /^changed\s+files?/i.test(line) || /\.(js|mjs|jsx|ts|tsx|css|html|md)$/i.test(line))
    .map((line) => line.replace(/^[-*•]\s+/, ''))
    .filter((line) => /\//.test(line) && !/^changed\s+files?/i.test(line));

  const detectedChecksStatus = normalizeChecksStatus(checksMatch?.[1] || rawPrInput);
  const merged = /\bmerged\b/i.test(rawPrInput) && !/not\s+merged/i.test(rawPrInput);
  const directMainCommitDetected = Boolean(directMainCommitMatch || /\bdirect\s+to\s+main\b/i.test(rawPrInput) || /\bcommit(?:ted)?\s+to\s+main\b/i.test(rawPrInput));
  const prState = asText(stateMatch?.[1], merged ? 'merged' : (detectedChecksStatus === 'unknown' ? 'unknown' : 'open'));
  const detectedMergeStatus = deriveMergeStatus({ merged, state: prState });

  const detectedRepo = prUrl ? `${prUrl[1]}/${prUrl[2]}` : asText(rawPrInput.match(/repo(?:sitory)?\s*[:=-]\s*([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)/i)?.[1], '');
  const detectedPrNumber = prUrl ? Number(prUrl[3]) : (numberMatch ? Number(numberMatch[1]) : null);

  const warnings = [];
  if (!detectedPrNumber) warnings.push('pr_number_not_detected');
  if (!detectedRepo) warnings.push('repository_not_detected');
  if (!autoMergeMatch) warnings.push('auto_merge_state_unknown');

  const metadata = {
    prNumber: detectedPrNumber,
    prUrl: asText(prUrl?.[0], ''),
    prState: prState === 'merged' ? 'closed' : prState,
    merged,
    prBranch: asText(branchMatch?.[1], ''),
    baseBranch: asText(baseBranchMatch?.[1], ''),
    changedFiles,
    changedFileCount: changedFiles.length,
    checksStatus: detectedChecksStatus,
    mergedBy: asText(mergedByMatch?.[1], ''),
    mergedAt: asText(mergedAtMatch?.[1], ''),
    directMainCommitDetected,
    directMainCommitSha: asText(commitShaMatch?.[1], ''),
    directMainCommitAt: asText(commitAtMatch?.[1], ''),
    directMainCommitBy: asText(commitByMatch?.[1], ''),
    fetchEvidenceStatus: asText(fetchEvidenceMatch?.[1], ''),
    autoMergeState: asText(autoMergeMatch?.[1], 'unknown'),
    codexTaskUrl,
    codexTaskId: codexTaskId,
    evidenceSource: 'operator_pasted_text',
    detectedRepo,
  };

  const confidenceScore = [metadata.prUrl, metadata.prNumber, metadata.detectedRepo, metadata.checksStatus !== 'unknown' ? 'checks' : ''].filter(Boolean).length;
  const parseConfidence = confidenceScore >= 3 ? 'high' : confidenceScore === 2 ? 'medium' : 'low';
  return {
    rawPrInput,
    detectedPrUrl: metadata.prUrl,
    detectedRepo,
    detectedPrNumber,
    detectedBranch: metadata.prBranch,
    detectedCodexTaskUrl: metadata.codexTaskUrl,
    detectedCodexTaskId: metadata.codexTaskId,
    detectedChangedFiles: changedFiles,
    detectedChecksStatus,
    detectedMergeStatus,
    detectedMergedBy: metadata.mergedBy,
    detectedMergedAt: metadata.mergedAt,
    detectedAutoMergeState: metadata.autoMergeState,
    parseConfidence,
    parseWarnings: warnings,
    normalizedPrMetadata: metadata,
    evidenceSource: 'manual_text_intake',
  };
}

export function buildPrEvidenceFromInput({ rawPrInput = '', missionSpec = {} } = {}) {
  const parseResult = parsePrEvidenceInput(rawPrInput);
  const prEvidenceIntake = buildPrEvidenceIntake({ prMetadata: parseResult.normalizedPrMetadata, missionSpec });
  return { parseResult, prEvidenceIntake };
}

export function normalizeLiveGithubPrEvidence(liveEvidence = null) {
  if (!liveEvidence || typeof liveEvidence !== 'object') return null;
  const keys = Object.keys(liveEvidence);
  if (keys.length === 0) return null;

  const changedFiles = Array.isArray(liveEvidence.changedFiles)
    ? liveEvidence.changedFiles.filter(Boolean).map((file) => String(file).trim()).filter(Boolean)
    : [];
  const failingChecks = Array.isArray(liveEvidence.failingChecks)
    ? liveEvidence.failingChecks.filter(Boolean).map((check) => String(check).trim()).filter(Boolean)
    : [];
  const warnings = Array.isArray(liveEvidence.warnings)
    ? liveEvidence.warnings.filter(Boolean).map((warning) => String(warning).trim()).filter(Boolean)
    : [];
  const missingProof = Array.isArray(liveEvidence.missingProof)
    ? liveEvidence.missingProof.filter(Boolean).map((proof) => String(proof).trim()).filter(Boolean)
    : [];

  return {
    status: asText(liveEvidence.status, ''),
    source: asText(liveEvidence.source, 'github-live-readonly'),
    repo: asText(liveEvidence.repo || liveEvidence.repository, ''),
    prNumber: Number(liveEvidence.prNumber || liveEvidence.number || 0) || null,
    owner: asText(liveEvidence.owner, ''),
    repoName: asText(liveEvidence.repoName || liveEvidence.name, ''),
    prUrl: asText(liveEvidence.url || liveEvidence.prUrl, ''),
    prTitle: asText(liveEvidence.title || liveEvidence.prTitle, ''),
    prState: asText(liveEvidence.state || liveEvidence.prState, ''),
    merged: liveEvidence.merged === true,
    headSha: asText(liveEvidence.headSha || liveEvidence.headSHA, ''),
    baseBranch: asText(liveEvidence.baseBranch, ''),
    changedFiles,
    changedFileCount: Number(liveEvidence.changedFileCount ?? changedFiles.length) || 0,
    checksStatus: asText(liveEvidence.checksStatus, 'unknown'),
    failingChecks,
    buildStatus: asText(liveEvidence.buildStatus, 'unknown'),
    verifyStatus: asText(liveEvidence.verifyStatus, 'unknown'),
    browserProofStatus: asText(liveEvidence.browserProofStatus, 'unknown'),
    codexTaskPresent: asText(liveEvidence.codexTaskPresent, ''),
    codexTaskRefs: Array.isArray(liveEvidence.codexTaskRefs) ? liveEvidence.codexTaskRefs.filter(Boolean).map((v)=>String(v).trim()).filter(Boolean) : [],
    missingProof,
    mergeReadiness: asText(liveEvidence.mergeReadiness, ''),
    retrievedAt: asText(liveEvidence.retrievedAt, ''),
    tokenStatus: liveEvidence.tokenStatus && typeof liveEvidence.tokenStatus === 'object' ? {
      configured: liveEvidence.tokenStatus.configured === true,
      masked: asText(liveEvidence.tokenStatus.masked, ''),
      authority: asText(liveEvidence.tokenStatus.authority, ''),
      updatedAt: asText(liveEvidence.tokenStatus.updatedAt, ''),
    } : null,
    evidenceWarnings: warnings,
    recommendedNextAction: asText(liveEvidence.recommendedNextAction, ''),
  };
}
