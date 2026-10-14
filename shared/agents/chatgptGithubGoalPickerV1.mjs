// #1574 ChatGPT GitHub-first candidate planning only. No auth, locks or mutation.
export const CHATGPT_GITHUB_PICKER_SCHEMA = 'stephanos.chatgpt-github-goal-picker.v1';
const SHA = /^[a-f0-9]{40}$/;
const TASK = /^[a-z0-9][a-z0-9-]{2,63}$/;
const SOURCES = Object.freeze(['canonical', 'seed', 'island', 'chatgpt']);
const MAX_AGE_MS = 10 * 60 * 1000;
const pathSafe = value => typeof value === 'string' && /^[a-zA-Z0-9_./-]{1,240}$/.test(value)
  && !value.startsWith('/') && !value.includes('\\')
  && !value.split('/').some(part => !part || part === '.' || part === '..' || part === 'node_modules' || part === '.git')
  && !value.split('/').includes('dist');
const overlapping = (a, b) => {
  const x = a.toLowerCase(); const y = b.toLowerCase();
  return x === y || x.startsWith(y + '/') || y.startsWith(x + '/');
};
const fresh = (when, now) => typeof when === 'string' && Number.isFinite(Date.parse(when))
  && Date.parse(when) <= now && now - Date.parse(when) <= MAX_AGE_MS;
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * Stateless, work-conserving *planning* step. Inventory and issue data MUST
 * be authenticated independently by a trusted host. This function never
 * interprets caller flags as authorisation or claims physical execution.
 */
export function planChatgptGithubGoalCandidatesV1(input = {}) {
  input = plain(input) ? input : {};
  const now = Date.parse(input.nowUtc);
  const main = input.mainHead;
  const common = [];
  if (!Number.isFinite(now)) common.push('CLOCK_UNPROVEN');
  if (typeof main !== 'string' || !SHA.test(main)) common.push('MAIN_HEAD_UNPROVEN');
  if (!Array.isArray(input.candidates) || input.candidates.length > 50)
    common.push('CANDIDATE_SET_INVALID');
  const candidates = Array.isArray(input.candidates) ? input.candidates.slice(0, 50) : [];
  const idCount = new Map();
  for (const candidate of candidates) {
    const key = typeof candidate?.taskId === 'string' ? candidate.taskId : '';
    if (key) idCount.set(key, (idCount.get(key) || 0) + 1);
  }
  const decisions = candidates.map(candidate => {
    const blockers = [...common];
    const c = plain(candidate) ? candidate : {};
    if (!Number.isSafeInteger(c.issueNumber) || c.issueNumber < 1 ||
        typeof c.issueTitle !== 'string' || !c.issueTitle.trim() || c.issueTitle.length > 200 ||
        c.issueState !== 'open') blockers.push('CANONICAL_GOAL_IDENTITY_UNPROVEN');
    if (typeof c.taskId !== 'string' || !TASK.test(c.taskId) || idCount.get(c.taskId) !== 1)
      blockers.push('TASK_ID_DUPLICATE_OR_INVALID');
    if (c.sourceHead !== main) blockers.push('TASK_HEAD_MISMATCH');
    if (c.riskTier !== 'low' || !['docs-only', 'tests-only'].includes(c.taskClass))
      blockers.push('PILOT_TASK_CLASS_UNQUALIFIED');
    if (!Array.isArray(c.paths) || !c.paths.length || c.paths.length > 6 ||
        c.paths.some(path => !pathSafe(path)) ||
        (c.taskClass === 'docs-only' && c.paths.some(path => !/^docs\/.+\.md$/i.test(path))) ||
        (c.taskClass === 'tests-only' && c.paths.some(path => !/^(shared|tests)\/.+\.test\.mjs$/i.test(path))) ||
        c.paths.some((path, i) => c.paths.slice(i + 1).some(other => overlapping(path, other))))
      blockers.push('SCOPE_INVALID_OR_OVERLAPPING');
    // Per-candidate proof, not a global lease/wait. Unknown only holds THIS task.
    const ownership = c.ownershipEvidence;
    if (!plain(ownership) || SOURCES.some(source => {
      const v = ownership[source];
      return !plain(v) || v.disposition !== 'VERIFIED_UNCLAIMED' ||
        v.mainHead !== main || !fresh(v.observedAtUtc, now) ||
        typeof v.evidenceRef !== 'string' || !v.evidenceRef.trim();
    })) blockers.push('CROSS_SYSTEM_OWNERSHIP_UNPROVEN');
    const prs = c.openPrEvidence;
    if (!plain(prs) || prs.mainHead !== main || !fresh(prs.observedAtUtc, now) ||
        !Array.isArray(prs.claims) || prs.claims.length > 500 ||
        typeof prs.evidenceRef !== 'string' || !prs.evidenceRef.trim() ||
        prs.claims.some(p => !plain(p) || !Array.isArray(p.paths) || !p.paths.length || p.paths.some(path => !pathSafe(path))))
      blockers.push('GITHUB_PR_INVENTORY_UNPROVEN');
    else if (Array.isArray(c.paths) && c.paths.every(pathSafe) &&
      prs.claims.some(p => p.taskId === c.taskId ||
        p.paths.some(path => c.paths.some(candidatePath => overlapping(path, candidatePath)))))
      blockers.push('ACTIVE_GITHUB_WORK_COLLISION');
    const branch = Number.isSafeInteger(c.issueNumber) && typeof c.taskId === 'string' && TASK.test(c.taskId)
      ? `chatgpt/goal-${c.issueNumber}-${c.taskId}` : null;
    return Object.freeze({
      issueNumber: Number.isSafeInteger(c.issueNumber) ? c.issueNumber : null,
      issueTitle: typeof c.issueTitle === 'string' ? c.issueTitle : '',
      taskId: typeof c.taskId === 'string' && TASK.test(c.taskId) ? c.taskId : null,
      branch,
      disposition: blockers.length ? 'HELD' : 'STRUCTURALLY_ELIGIBLE_UNAUTHENTICATED',
      blockers: Object.freeze([...new Set(blockers)]),
    });
  });
  const candidatesForVerification = decisions.filter(d => d.disposition === 'STRUCTURALLY_ELIGIBLE_UNAUTHENTICATED')
    .sort((a, b) => a.issueNumber - b.issueNumber || a.taskId.localeCompare(b.taskId));
  return Object.freeze({
    schemaVersion: CHATGPT_GITHUB_PICKER_SCHEMA,
    disposition: 'PLANNING_ONLY_NOT_EXECUTION_AUTHORITY',
    suggestedForIndependentVerification: candidatesForVerification[0]?.taskId || null,
    decisions: Object.freeze(decisions),
    workerStarted: false,
    physicalPickupProven: false,
    sourceMutationAllowed: false,
    mergeAllowed: false,
    leaseReleaseAllowed: false,
    unattendedRefillAllowed: false,
  });
}
