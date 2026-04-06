import express from 'express';
import { providerSecretStore } from '../services/providerSecretStore.js';

const router = express.Router();

function getRequestIp(req) {
  return String(
    req.headers['x-forwarded-for']
      || req.socket?.remoteAddress
      || req.ip
      || '',
  ).split(',')[0].trim();
}

function isLoopbackIp(ip = '') {
  const normalized = String(ip || '').trim();
  return normalized === '127.0.0.1'
    || normalized === '::1'
    || normalized === '::ffff:127.0.0.1';
}

function isLoopbackOrigin(origin = '') {
  if (!origin) return true;
  try {
    const parsed = new URL(origin);
    return ['localhost', '127.0.0.1'].includes(parsed.hostname);
  } catch {
    return false;
  }
}

function isLoopbackHostHeader(host = '') {
  const normalized = String(host || '').trim().toLowerCase();
  if (!normalized) return false;
  const hostOnly = normalized.split(':')[0];
  return hostOnly === 'localhost' || hostOnly === '127.0.0.1' || hostOnly === '[::1]';
}

export function isLocalAdminRequest(req) {
  const requestIp = getRequestIp(req);
  const requestOrigin = String(req.headers.origin || '');
  const requestHost = String(req.headers.host || '');
  const hostLooksLoopback = isLoopbackHostHeader(requestHost);
  return isLoopbackIp(requestIp) && isLoopbackOrigin(requestOrigin) && hostLooksLoopback;
}

function requireLocalAdmin(req, res, next) {
  if (!isLocalAdminRequest(req)) {
    console.warn('[SECRET AUTHORITY] denied', {
      target: `http://${String(req.headers.host || '')}`,
      reason: 'non-local-admin-route',
      requestIp: getRequestIp(req),
      origin: String(req.headers.origin || ''),
    });
    res.status(403).json({
      success: false,
      error: 'Local admin access required.',
      authority: 'localhost-only-admin-surface',
      reason: 'non-local-admin-route',
    });
    return;
  }

  console.info('[SECRET AUTHORITY]', {
    sessionKind: 'local-desktop',
    target: `http://${String(req.headers.host || 'localhost:8787')}`,
    source: 'pc-local-admin',
  });

  next();
}

router.use(requireLocalAdmin);

router.get('/provider-secrets', (_req, res) => {
  res.json({
    success: true,
    data: {
      authority: 'backend-local-secret-store',
      providers: providerSecretStore.getMaskedStatusSnapshot(),
    },
  });
});

router.put('/provider-secrets/:provider', (req, res) => {
  try {
    const status = providerSecretStore.setSecret(req.params.provider, req.body?.apiKey || '');
    console.info('[PROVIDER SAVE]', { provider: String(req.params.provider || ''), outcome: 'accepted' });
    res.json({ success: true, data: status });
  } catch (error) {
    console.warn('[PROVIDER SAVE]', {
      provider: String(req.params.provider || ''),
      outcome: 'rejected',
      reason: error?.message || 'unknown-error',
    });
    res.status(400).json({
      success: false,
      error: error?.message || 'Failed to store provider secret.',
    });
  }
});

router.delete('/provider-secrets/:provider', (req, res) => {
  const removed = providerSecretStore.clearSecret(req.params.provider);
  res.json({
    success: true,
    data: {
      provider: String(req.params.provider || ''),
      removed,
      authority: 'backend-local-secret-store',
    },
  });
});

export default router;
