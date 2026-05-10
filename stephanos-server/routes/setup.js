import express from 'express';
import { buildIntegrationSetupModel } from '../../shared/runtime/integrationSetupModel.mjs';
import { getSpotifyConfigDiagnostics } from '../services/spotifyClient.js';

const router = express.Router();

function classifySpotifyStatus(diagnostics = {}) {
  if (!diagnostics.configured) return 'not-configured';
  if (diagnostics.tokenStatus === 'valid') return 'working';
  if (diagnostics.tokenStatus === 'failed') return 'failed';
  return 'configured';
}

router.get('/integrations', (_req, res) => {
  const spotifyDiagnostics = getSpotifyConfigDiagnostics();
  const integrationTestStatus = {
    'spotify-catalog': {
      status: classifySpotifyStatus(spotifyDiagnostics),
      error: spotifyDiagnostics.lastError || null,
    },
  };
  const integrations = buildIntegrationSetupModel({ env: process.env, integrationTestStatus }).map((row) => ({
    id: row.id,
    name: row.name,
    configured: row.configured,
    missingSecrets: row.missingSecrets,
    requiredSecretPresence: row.requiredSecretPresence,
    status: row.status,
    backendRoute: row.backendRoute,
    testEndpoint: row.testEndpoint,
    lastTestStatus: row.lastTestStatus,
    lastTestError: row.lastTestError,
    nextAction: row.nextAction,
    safetyNotes: row.safetyNotes,
  }));
  res.json({
    guidedSecretWrite: {
      mode: 'guided-only',
      requiresOperatorApproval: true,
      note: 'Stephanos will not write backend secrets automatically in this pass.',
    },
    integrations,
  });
});

export default router;
