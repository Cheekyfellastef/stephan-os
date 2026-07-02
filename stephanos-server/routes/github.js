import express from 'express';
import { fetchGithubPrEvidence, resolveGithubRepoConfig, resolveGithubTokenConfig } from '../services/githubPrEvidenceService.js';
import { providerSecretStore } from '../services/providerSecretStore.js';
import { readGithubTelemetry } from '../services/githubTelemetryService.js';

const router = express.Router();

router.get('/telemetry', async (_req, res) => {
  const payload = await readGithubTelemetry();
  res.status(payload.status === 'adapter_error' ? 502 : 200).json(payload);
});

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
  const secretStatus = providerSecretStore.getMaskedProviderStatus('github');
  const tokenConfig = resolveGithubTokenConfig({
    env: process.env,
    secretStoreToken: providerSecretStore.getSecret('github'),
  });
  if (!tokenConfig.configured) {
    res.json({ status: 'needs-configuration', source: 'none', owner, repo, prNumber, recommendedNextAction: 'Configure read-only GitHub token to fetch PR evidence.' });
    return;
  }
  const payload = await fetchGithubPrEvidence({ owner, repo, prNumber, token: tokenConfig.token });
  payload.tokenStatus = {
    configured: true,
    masked: secretStatus?.masked || (tokenConfig.authority === 'env' ? '••••••••env' : ''),
    updatedAt: secretStatus?.updatedAt || null,
    authority: tokenConfig.authority,
  };
  res.status(payload.status === 'error' ? 502 : 200).json(payload);
});

export default router;
