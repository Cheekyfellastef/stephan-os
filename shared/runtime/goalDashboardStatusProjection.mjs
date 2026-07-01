const ACTIVE_STATES = new Set(['QUEUED', 'RUNNING', 'VERIFYING', 'AWAITING_APPROVAL', 'BLOCKED']);

function text(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  const normalized = String(value).trim();
  return normalized || fallback;
}

function list(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function issueFromMission(mission = {}) {
  const id = text(mission.mission?.missionId || mission.missionId);
  const title = text(mission.mission?.title || mission.title);
  const match = `${id} ${title}`.match(/#\d+/);
  return match ? match[0] : id;
}

function proofSummary(mission = {}) {
  const receipts = list(mission.receipts);
  if (!receipts.length) return 'proof unknown';
  const passing = receipts.filter((receipt) => /pass|success|complete|reserved/i.test(text(receipt.status))).length;
  return `${passing}/${receipts.length} receipts reported`;
}

export function buildGoalDashboardStatusProjection(input = {}, options = {}) {
  const missions = list(input.missions);
  const capabilities = input.capabilities || {};
  const relevantStates = new Set(list(options.relevantStates).map((state) => text(state).toUpperCase()));
  if (!relevantStates.size) for (const state of ACTIVE_STATES) relevantStates.add(state);

  const goals = missions
    .filter((mission) => relevantStates.has(text(mission.mission?.state || mission.state).toUpperCase()))
    .map((mission) => {
      const pullRequest = mission.pullRequest || {};
      const git = mission.git || {};
      const prNumber = Number.isInteger(pullRequest.number) ? pullRequest.number : null;
      const prState = text(pullRequest.state, 'not reported');
      const mergeCommitSha = text(pullRequest.mergeCommitSha || git.mergeCommitSha);
      const merged = pullRequest.merged === true || prState.toLowerCase() === 'merged' || Boolean(mergeCommitSha);
      return {
        issue: issueFromMission(mission),
        title: text(mission.mission?.title || mission.title, 'Untitled goal'),
        state: text(mission.mission?.state || mission.state, 'UNKNOWN'),
        latestPr: prNumber ? `#${prNumber}` : 'not opened',
        latestPrUrl: text(pullRequest.url),
        head: text(pullRequest.headSha || git.headSha, 'not reported'),
        merge: merged ? `MERGED${mergeCommitSha ? ` ${mergeCommitSha}` : ''}` : `NOT_MERGED (${prState})`,
        proof: proofSummary(mission),
        nextAction: text(mission.mission?.nextAction || mission.nextAction, 'Await the next deterministic receipt.'),
        mergedPrUpdateTruth: merged ? 'MERGED_PR_UPDATE_REPORTED_BY_RECEIPT' : 'NO_MERGED_PR_UPDATE_RECEIPT',
      };
    });

  const liveAdapterStatus = capabilities.githubAutoUpdate === true || capabilities.localAutoUpdate === true
    ? 'LIVE_UPDATE_ADAPTER_AVAILABLE'
    : 'MANUAL_REFRESH_REQUIRED';

  return {
    schemaVersion: 'stephanos.goal-dashboard-status-projection.v1',
    generatedAt: text(input.generatedAt, new Date().toISOString()),
    source: text(input.source, 'unknown'),
    liveAdapterStatus,
    githubAutoUpdateTruth: capabilities.githubAutoUpdate === true ? 'GITHUB_AUTO_UPDATE_AVAILABLE' : 'MANUAL_REFRESH_REQUIRED',
    localAutoUpdateTruth: capabilities.localAutoUpdate === true ? 'LOCAL_AUTO_UPDATE_AVAILABLE' : 'MANUAL_REFRESH_REQUIRED',
    activeGoalCount: goals.length,
    goals,
    finalVerdict: goals.length ? 'GOAL_DASHBOARD_STATUS_READY' : 'NO_ACTIVE_GOALS_REPORTED',
  };
}
