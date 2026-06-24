export function evaluateGitExecutorPreflight({
  operation,
  expectedBranch,
  actualBranch,
  stagedFiles = [],
  expectedChangedFiles = [],
  actualChangedFiles = [],
} = {}) {
  const blockers = [];
  const normalizedOperation = String(operation || '').trim().toLowerCase();
  if (['commit', 'push', 'open-pr'].includes(normalizedOperation) && actualBranch !== expectedBranch) {
    blockers.push('Git working directory is not on the authorized branch.');
  }
  if (normalizedOperation === 'commit' && stagedFiles.length) {
    blockers.push('Commit requires an empty Git index before approved files are staged.');
  }
  if (['commit', 'push', 'open-pr'].includes(normalizedOperation)) {
    const expected = [...new Set(expectedChangedFiles)].sort();
    const actual = [...new Set(actualChangedFiles)].sort();
    if (JSON.stringify(expected) !== JSON.stringify(actual)) {
      blockers.push('Actual changed files do not match the signed changed file set.');
    }
  }
  return {
    blockers,
    finalVerdict: blockers.length ? 'BLOCKED' : 'PREFLIGHT_PASS',
  };
}
