function asText(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  const text = String(value).trim();
  return text || fallback;
}

function asList(value) {
  return Array.isArray(value) ? value.filter(Boolean).map((entry) => String(entry).trim()).filter(Boolean) : [];
}

function normalizeChecksStatus(status = 'unknown') {
  const lower = asText(status, 'unknown').toLowerCase();
  if (/fail|error|cancel/.test(lower)) return 'failed';
  if (/pass|success|green/.test(lower)) return 'passed';
  if (/pending|running|queued|in_progress/.test(lower)) return 'pending';
  return 'unknown';
}

function deriveCodexTaskFields({ prMetadata = {}, prBody = '' } = {}) {
  const directUrl = asText(prMetadata.codexTaskUrl || prMetadata.codex_task_url, '');
  const directId = asText(prMetadata.codexTaskId || prMetadata.codex_task_id, '');
  const body = asText(prBody || prMetadata.body || prMetadata.description, '');
  const urlMatch = body.match(/https?:\/\/\S*codex\S*/i);
  const idMatch = body.match(/codex(?:\s*task)?\s*[:#-]\s*([A-Za-z0-9_-]+)/i);
  return {
    codexTaskUrl: directUrl || asText(urlMatch?.[0], ''),
    codexTaskId: directId || asText(idMatch?.[1], ''),
  };
}

export function buildPrEvidenceIntake({ prMetadata = null, missionSpec = {} } = {}) {
  if (!prMetadata || typeof prMetadata !== 'object' || Object.keys(prMetadata).length === 0) {
    return { normalizedStatus: 'no_pr_evidence', evidenceWarnings: ['No PR evidence supplied yet.'] };
  }
  const finishAuthority = missionSpec?.finishAuthority || {};
  const changedFiles = asList(prMetadata.changedFiles || prMetadata.files);
  const generatedDistFiles = changedFiles.filter((file) => file.startsWith('apps/stephanos/dist/'));
  const sourceLikely = asList(missionSpec?.repoArchitectureContext?.sourceFilesLikelyTouched);
  const unexpectedFiles = sourceLikely.length
    ? changedFiles.filter((file) => !sourceLikely.some((expected) => file.includes(expected) || expected.includes(file)) && !file.startsWith('apps/stephanos/dist/'))
    : [];

  const checksStatus = normalizeChecksStatus(prMetadata.checksStatus || prMetadata.checks_status);
  const requiredChecksStatus = normalizeChecksStatus(prMetadata.requiredChecksStatus || prMetadata.required_checks_status || prMetadata.requiredChecks);
  const closedState = asText(prMetadata.prState || prMetadata.state, '').toLowerCase() === 'closed';
  const merged = prMetadata.merged === true;
  const mergedAt = asText(prMetadata.mergedAt || prMetadata.merged_at, '');
  let normalizedStatus = 'stale_or_unknown';
  if (merged && mergedAt) normalizedStatus = 'merged';
  else if (closedState && !merged) normalizedStatus = 'closed_unmerged';
  else if (checksStatus === 'failed' || requiredChecksStatus === 'failed') normalizedStatus = 'checks_failed';
  else if (checksStatus === 'pending' || requiredChecksStatus === 'pending') normalizedStatus = 'checks_pending';
  else if (checksStatus === 'passed' || requiredChecksStatus === 'passed') normalizedStatus = 'merge_ready_candidate';
  else if (asText(prMetadata.prState || prMetadata.state, '').toLowerCase() === 'open') normalizedStatus = 'open';

  const warnings = [];
  const autoMergeState = asText(prMetadata.autoMergeState || prMetadata.auto_merge_state, 'unknown');
  if (autoMergeState.toLowerCase() === 'unknown') warnings.push('auto_merge_state_unknown');
  if (merged && !(finishAuthority.mergeAuthorityIncluded === true && finishAuthority.operatorApprovalRecorded === true)) {
    warnings.push('merged_without_recorded_mission_authority');
  }
  if (unexpectedFiles.length > 0) warnings.push(`changed_files_outside_likely_scope:${unexpectedFiles.slice(0, 3).join(',')}`);
  if (generatedDistFiles.length > 0) warnings.push(`generated_dist_files_detected:${generatedDistFiles.length}`);

  const codexTask = deriveCodexTaskFields({ prMetadata, prBody: prMetadata.body });

  return {
    prNumber: prMetadata.prNumber ?? prMetadata.number ?? null,
    prUrl: asText(prMetadata.prUrl || prMetadata.url, ''),
    prTitle: asText(prMetadata.prTitle || prMetadata.title, ''),
    prState: asText(prMetadata.prState || prMetadata.state, 'unknown'),
    prBranch: asText(prMetadata.prBranch || prMetadata.headRefName || prMetadata.branch, ''),
    baseBranch: asText(prMetadata.baseBranch || prMetadata.baseRefName || '', ''),
    headSha: asText(prMetadata.headSha || '', ''),
    mergeCommitSha: asText(prMetadata.mergeCommitSha || '', ''),
    createdAt: asText(prMetadata.createdAt || '', ''),
    updatedAt: asText(prMetadata.updatedAt || '', ''),
    closedAt: asText(prMetadata.closedAt || '', ''),
    mergedAt,
    merged,
    mergedBy: asText(prMetadata.mergedBy || '', ''),
    mergeSource: asText(prMetadata.mergeSource || 'unknown', 'unknown'),
    autoMergeState,
    checksStatus,
    requiredChecksStatus,
    changedFiles,
    changedFileCount: Number(prMetadata.changedFileCount || changedFiles.length || 0),
    commitsCount: Number(prMetadata.commitsCount || 0),
    additions: Number(prMetadata.additions || 0),
    deletions: Number(prMetadata.deletions || 0),
    codexTaskUrl: codexTask.codexTaskUrl,
    codexTaskId: codexTask.codexTaskId,
    author: asText(prMetadata.author || '', ''),
    actor: asText(prMetadata.actor || '', ''),
    evidenceSource: asText(prMetadata.evidenceSource || 'operator_supplied_metadata', 'operator_supplied_metadata'),
    evidenceFreshness: asText(prMetadata.evidenceFreshness || 'unknown', 'unknown'),
    evidenceWarnings: warnings,
    normalizedStatus,
  };
}
