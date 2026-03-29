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

export function isLocalAdminRequest(req) {
  const requestIp = getRequestIp(req);
  const requestOrigin = String(req.headers.origin || '');
  const requestHost = String(req.headers.host || '');
  const hostLooksLoopback = requestHost.startsWith('localhost:') || requestHost.startsWith('127.0.0.1:');
  return isLoopbackIp(requestIp) && isLoopbackOrigin(requestOrigin) && hostLooksLoopback;
}

function requireLocalAdmin(req, res, next) {
  if (!isLocalAdminRequest(req)) {
    res.status(403).json({
      success: false,
      error: 'Local admin access required.',
      authority: 'localhost-only-admin-surface',
    });
    return;
  }

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
    res.json({ success: true, data: status });
  } catch (error) {
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
