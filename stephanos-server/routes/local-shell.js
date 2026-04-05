import express from 'express';
import { isLocalAdminRequest } from './ai-admin.js';
import { getLocalShellConfig } from '../config/localShellConfig.js';
import { focusRepoPowerShell, launchRepoPowerShell } from '../services/localShellService.js';

const router = express.Router();

function localShellLog(event, details = {}) {
  const safeDetails = Object.entries(details)
    .reduce((acc, [key, value]) => {
      if (value === undefined) {
        return acc;
      }
      acc[key] = value;
      return acc;
    }, {});
  console.info('[LOCAL SHELL]', event, safeDetails);
}

function requireLocalDesktopRuntime(req, res, next) {
  const localShellConfig = getLocalShellConfig();
  const requestHost = String(req.headers.host || '');
  const requestOrigin = String(req.headers.origin || '');
  const accepted = isLocalAdminRequest(req);

  localShellLog('local guard evaluated', {
    accepted,
    requestHost,
    requestOrigin,
    route: req.path,
  });

  if (!accepted) {
    localShellLog('local guard rejected request', {
      requestHost,
      requestOrigin,
      route: req.path,
      reason: 'local-desktop-runtime-required',
    });
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
  localShellLog('repo shell config requested', {
    repoPath: localShellConfig.repoPath,
    source: localShellConfig.source,
  });
  res.json({
    ok: true,
    repoPath: localShellConfig.repoPath,
    source: localShellConfig.source,
    windowsOnly: localShellConfig.windowsOnly,
  });
});

router.post('/open-repo-powershell', requireLocalDesktopRuntime, (_req, res) => {
  const localShellConfig = getLocalShellConfig();
  localShellLog('open repo powershell route hit', {
    repoPath: localShellConfig.repoPath,
  });

  const result = launchRepoPowerShell();

  localShellLog('open repo powershell route result', {
    ok: result.ok,
    launched: result.launched,
    pid: result.pid,
    reason: result.reason,
    repoPath: result.repoPath,
    focusApplied: result.focusApplied,
    topmostApplied: result.topmostApplied,
  });

  res.status(result.ok ? 200 : 500).json(result);
});

router.post('/focus-repo-powershell', requireLocalDesktopRuntime, (_req, res) => {
  localShellLog('focus repo powershell route hit');
  const result = focusRepoPowerShell();

  localShellLog('focus repo powershell route result', {
    ok: result.ok,
    focused: result.focused,
    pid: result.pid,
    reason: result.reason,
    focusApplied: result.focusApplied,
    topmostApplied: result.topmostApplied,
    repoPath: result.repoPath,
  });

  res.status(result.ok ? 200 : 500).json(result);
});

export default router;
