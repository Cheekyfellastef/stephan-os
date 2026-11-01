import express from 'express';
import { isAllowedPrivateFrontendOrigin } from '../config/runtimeConfig.js';
import { isAllowedTailscaleFrontendOrigin } from '../config/tailscaleOrigin.js';
import {
  GAMING_RESOURCE_ALLOWED_MODES,
  getGamingResourceState,
  runGamingResourceAcceptance,
  setGamingResourceMode,
} from '../services/gamingResourceService.js';

const router = express.Router();

function text(value = '') {
  return String(value ?? '').trim();
}

function requestIp(req) {
  return text(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || req.ip).split(',')[0].trim();
}

function isLoopbackIp(ip = '') {
  const value = text(ip).toLowerCase();
  return value === '127.0.0.1' || value === '::1' || value === '::ffff:127.0.0.1';
}

function isLoopbackFrontendOrigin(origin = '') {
  if (!origin) return false;
  try {
    const parsed = new URL(origin);
    return ['http:', 'https:'].includes(parsed.protocol)
      && ['localhost', '127.0.0.1', '::1'].includes(parsed.hostname);
  } catch {
    return false;
  }
}

export function isGamingResourceControlRequestAllowed(req) {
  const origin = text(req.headers.origin);
  if (!origin) return isLoopbackIp(requestIp(req));
  return isLoopbackFrontendOrigin(origin)
    || isAllowedPrivateFrontendOrigin(origin)
    || isAllowedTailscaleFrontendOrigin(origin);
}

function requireGamingControlRoute(req, res, next) {
  if (!isGamingResourceControlRequestAllowed(req)) {
    res.status(403).json({
      ok: false,
      blocker: 'GAMING_RESOURCE_TRUSTED_FRONTEND_REQUIRED',
      arbitraryShellAllowed: false,
      arbitraryProcessKillAllowed: false,
    });
    return;
  }
  next();
}

router.use(requireGamingControlRoute);

router.get('/state', (_req, res) => {
  const result = getGamingResourceState();
  res.status(result.ok ? 200 : 503).json(result);
});

router.post('/mode', (req, res) => {
  const mode = text(req.body?.mode).toUpperCase();
  if (!GAMING_RESOURCE_ALLOWED_MODES.includes(mode)) {
    res.status(400).json({
      ok: false,
      blocker: 'GAMING_RESOURCE_MODE_NOT_ALLOWED',
      allowedModes: GAMING_RESOURCE_ALLOWED_MODES,
      arbitraryShellAllowed: false,
      arbitraryProcessKillAllowed: false,
    });
    return;
  }
  const result = setGamingResourceMode(mode);
  res.status(result.ok ? 200 : 503).json(result);
});

router.post('/acceptance', (_req, res) => {
  const result = runGamingResourceAcceptance();
  res.status(result.ok ? 200 : 503).json(result);
});

export default router;
