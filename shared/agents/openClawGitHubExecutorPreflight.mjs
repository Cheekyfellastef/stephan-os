export function evaluateGitExecutorPreflight({
  operation,
  expectedBranch,
  actualBranch,
  stagedFiles = [],
} = {}) {
  const blockers = [];
  const normalizedOperation = String(operation || '').trim().toLowerCase();
  if (['commit', 'push'].includes(normalizedOperation) && actualBranch !== expectedBranch) {
    blockers.push('Git working directory is not on the authorized branch.');
  }
  if (normalizedOperation === 'commit' && stagedFiles.length) {
    blockers.push('Commit requires an empty Git index before approved files are staged.');
  }
  return {
    blockers,
    finalVerdict: blockers.length ? 'BLOCKED' : 'PREFLIGHT_PASS',
  };
}
