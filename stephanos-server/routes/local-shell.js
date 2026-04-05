import express from 'express';
import { isLocalAdminRequest } from './ai-admin.js';
import { getLocalShellConfig } from '../config/localShellConfig.js';
import { launchRepoPowerShell } from '../services/localShellService.js';

const router = express.Router();

function requireLocalDesktopRuntime(req, res, next) {
  if (!isLocalAdminRequest(req)) {
    const localShellConfig = getLocalShellConfig();
    res.status(403).json({
      ok: false,
      launched: false,
      repoPath: localShellConfig.repoPath,
      reason: 'local-desktop-runtime-required',
    });
    return;
  }

  next();
}

router.get('/repo-shell-config', requireLocalDesktopRuntime, (_req, res) => {
  const localShellConfig = getLocalShellConfig();
  res.json({
    ok: true,
    repoPath: localShellConfig.repoPath,
    source: localShellConfig.source,
    windowsOnly: localShellConfig.windowsOnly,
  });
});

router.post('/open-repo-powershell', requireLocalDesktopRuntime, (_req, res) => {
  const result = launchRepoPowerShell();
  res.status(result.ok ? 200 : 500).json(result);
});

export default router;
