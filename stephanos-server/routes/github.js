import express from 'express';
import { fetchGithubPrEvidence, resolveGithubRepoConfig } from '../services/githubPrEvidenceService.js';

const router = express.Router();

router.get('/pr-evidence', async (req, res) => {
  const prNumber = Number(req.query.pr || 0) || null;
  if (!prNumber) {
    res.status(400).json({ status: 'needs-pr-number', source: 'none', recommendedNextAction: 'Provide a valid PR number.' });
    return;
  }
  const repoConfig = resolveGithubRepoConfig(process.env);
  const owner = String(req.query.owner || '').trim() || repoConfig?.owner || '';
  const repo = String(req.query.repo || '').trim() || repoConfig?.repo || '';
  if (!owner || !repo) {
    res.json({ status: 'needs-repo', source: 'none', prNumber, recommendedNextAction: 'Configure canonical repository owner/repo for read-only PR evidence.' });
    return;
  }
  const token = String(process.env.GITHUB_TOKEN || process.env.STEPHANOS_GITHUB_TOKEN || '').trim();
  if (!token) {
    res.json({ status: 'needs-configuration', source: 'none', owner, repo, prNumber, recommendedNextAction: 'Configure read-only GitHub token to fetch PR evidence.' });
    return;
  }
  const payload = await fetchGithubPrEvidence({ owner, repo, prNumber, token });
  res.status(payload.status === 'error' ? 502 : 200).json(payload);
});

export default router;
