function asText(value = '') {
  return String(value || '').trim();
}

export const STEPHANOS_CANONICAL_REPO = Object.freeze({
  owner: 'Cheekyfellastef',
  name: 'stephan-os',
  repo: 'Cheekyfellastef/stephan-os',
});

export function resolveCanonicalRepoConfig(input = {}) {
  const owner = asText(input.owner || input.githubOwner || '');
  const name = asText(input.name || input.repoName || '');
  const repo = asText(input.repo || input.githubRepo || '');
  if (owner && name) {
    return { owner, name, repo: `${owner}/${name}` };
  }
  if (repo.includes('/')) {
    const [repoOwner, repoName] = repo.split('/');
    if (repoOwner && repoName) return { owner: repoOwner, name: repoName, repo: `${repoOwner}/${repoName}` };
  }
  return { ...STEPHANOS_CANONICAL_REPO };
}
