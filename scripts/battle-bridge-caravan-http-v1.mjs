import { randomBytes } from 'node:crypto';
import {
  projectMobileInstallationV1, mobileInstallationRequestOptionsV1,
  verifyMobileInstallationAssertionV1,
} from '../shared/agents/battleBridgeMobileInstallationV1.mjs';
import { createBattleBridgeMobileInstallationProviderV1 } from './windows/battle-bridge-mobile-install-native-v1.mjs';
import { renderBattleBridgeCaravanPageV1 } from './battle-bridge-caravan-page-v1.mjs';

export const CARAVAN_PATH = '/caravan';
export const CARAVAN_NONCE_TTL_MS = 5 * 60_000;
const REQUEST_ID = /^mobile-install-[a-z0-9][a-z0-9-]{7,63}$/;
const MAX_BODY = 24 * 1024;
const validId = value => typeof value === 'string' && REQUEST_ID.test(value);
const hex = (value, length) => typeof value === 'string' && value.length === length && /^[a-f0-9]+$/.test(value);
const exactKeys = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).sort().join(',') === [...keys].sort().join(',');
const code = value => typeof value === 'string' && /^[A-Z][A-Z0-9_]{0,79}$/.test(value) ? value : 'MOBILE_INSTALLATION_UNPROVEN';

function json(res, status, body) {
  const output = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store',
    'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer',
    'content-length': Buffer.byteLength(output),
  });
  res.end(output);
}

async function readBody(req) {
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(req.headers['content-type'] || ''))
    throw Object.assign(new Error('JSON_REQUIRED'), { statusCode: 415 });
  const chunks = [];
  let length = 0;
  for await (const chunk of req) {
    length += chunk.length;
    if (length > MAX_BODY) throw Object.assign(new Error('REQUEST_TOO_LARGE'), { statusCode: 413 });
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw Object.assign(new Error('INVALID_JSON'), { statusCode: 400 }); }
}

function unconfirmed(requestId = '', reason = 'MOBILE_INSTALLATION_UNPROVEN') {
  return {
    state: 'UNKNOWN', title: 'Outcome not yet confirmed',
    description: requestId
      ? 'Reconnect to check this same request. Approval will not be sent again automatically.'
      : 'The protected installation status is not available yet.',
    canApprove: false, requestId, observedAtUtc: '', blockers: [code(reason)],
    receiptVerified: false, sourceHead: '', packageSha256: '', candidateSha256: '',
  };
}

/** Presentation only. Browser input never supplies protected enrollment or trust. */
export function publicCaravanObservationV1(snapshot, { nowMs = Date.now(), requestId = '', minimumSequence = 0 } = {}) {
  if (snapshot?.candidate && snapshot?.enrollment) {
    // A production protected reader must supply its durable journal watermark.
    if (!Number.isSafeInteger(snapshot.minimumSequence) || snapshot.minimumSequence < 1)
      return unconfirmed(requestId, 'MOBILE_INSTALLATION_JOURNAL_UNPROVEN');
    const projected = projectMobileInstallationV1(snapshot, { nowMs,
      minimumSequence: Math.max(minimumSequence, snapshot.minimumSequence) });
    const result = {
      state: projected.state, title: projected.title, description: projected.description,
      canApprove: projected.canApprove === true,
      requestId: validId(projected.requestId) ? projected.requestId : requestId,
      observedAtUtc: projected.observedAtUtc || '',
      blockers: Array.isArray(projected.blockers) ? projected.blockers.map(code).slice(0, 8) : [],
      receiptVerified: projected.receiptVerified === true,
      sequence: projected.sequence || 0,
      sourceHead: hex(projected.sourceHead, 40) ? projected.sourceHead : '',
      packageSha256: hex(projected.packageSha256, 64) ? projected.packageSha256 : '',
      candidateSha256: hex(projected.candidateSha256, 64) ? projected.candidateSha256 : '',
    };
    if (requestId && result.requestId !== requestId) return unconfirmed(requestId, 'MOBILE_INSTALLATION_REQUEST_MISMATCH');
    return result;
  }
  const observation = snapshot?.nativeObservation;
  // A readiness probe conveys no enrollment, approval or execution authority.
  if (requestId) return unconfirmed(requestId, snapshot?.reason || observation?.reason);
  if (observation?.enrollmentObservation?.state === 'MISSING'
      && observation.reason === 'MOBILE_INSTALL_ENROLLMENT_MISSING') {
    return {
      state: 'SETUP_REQUIRED', title: 'First Windows setup required',
      description: 'The protected installer has not been enrolled. Once setup is complete, approved installations can be handled here.',
      canApprove: false, requestId: '', observedAtUtc: observation.observedAtUtc || '',
      blockers: [code(observation.reason)], receiptVerified: false, sourceHead: '', packageSha256: '', candidateSha256: '',
    };
  }
  if (observation?.reason === 'MOBILE_INSTALL_OPERATOR_SESSION_MISSING') {
    return {
      state: 'SIGN_IN_REQUIRED', title: 'Waiting for Windows sign-in',
      description: 'The installation path requires an existing Windows operator session.',
      canApprove: false, requestId: '', observedAtUtc: observation.observedAtUtc || '',
      blockers: [code(observation.reason)], receiptVerified: false, sourceHead: '', packageSha256: '', candidateSha256: '',
    };
  }
  return unconfirmed('', observation?.reason || snapshot?.reason);
}

/** Adapter for existing Commander; no listener, task, durable queue or authority. */
export function createBattleBridgeCaravanHttpHandlerV1(options = {}) {
  const nowMs = options.nowMs || Date.now;
  const provider = options.provider || createBattleBridgeMobileInstallationProviderV1({ expectedMain: options.expectedMain });
  const nonces = new Map();
  const pending = new Set();
  const attempted = new Map(); // Retain uncertain dispatches; never a replacement for the native journal.
  const watermarks = new Map(); // Presentation replay protection; native journal remains authoritative.
  function freshNonce() {
    const now = nowMs();
    for (const [nonce, expires] of nonces) if (expires <= now) nonces.delete(nonce);
    while (nonces.size >= 32) nonces.delete(nonces.keys().next().value);
    const nonce = randomBytes(32).toString('hex');
    nonces.set(nonce, now + CARAVAN_NONCE_TTL_MS);
    return nonce;
  }
  function allowedOrigin(req) {
    const site = req.headers['sec-fetch-site'];
    if (site && site !== 'same-origin' && site !== 'none') return false;
    const origin = req.headers.origin;
    if (!origin) return req.method === 'GET';
    if (options.publicOrigin) return origin === options.publicOrigin;
    return origin === 'https://' + req.headers.host || origin === 'http://' + req.headers.host;
  }
  function projected(snapshot, requestId = '') {
    const id = requestId || snapshot?.candidate?.requestId || '';
    const view = publicCaravanObservationV1(snapshot, { nowMs: nowMs(), requestId, minimumSequence: watermarks.get(id) || 0 });
    if (view.receiptVerified && validId(view.requestId)) {
      if (!watermarks.has(view.requestId) && watermarks.size >= 64) watermarks.delete(watermarks.keys().next().value);
      watermarks.set(view.requestId, Math.max(watermarks.get(view.requestId) || 0, view.sequence));
    }
    const previousAttempt = attempted.get(view.requestId);
    if (previousAttempt && view.canApprove)
      return unconfirmed(view.requestId, 'MOBILE_INSTALLATION_RESULT_RECONCILIATION_REQUIRED');
    if (previousAttempt && view.receiptVerified && view.sequence > previousAttempt.sequence
        && ['READY', 'FAILED', 'CANCELLED'].includes(view.state)) attempted.delete(view.requestId);
    return view;
  }
  return async function handleCaravan(req, res, url) {
    if (url.pathname !== CARAVAN_PATH && !url.pathname.startsWith(CARAVAN_PATH + '/')) return false;
    if (!allowedOrigin(req)) {
      json(res, 403, { ok: false, message: 'Open this page from your private Commander address.' }); return true;
    }
    if (url.pathname === CARAVAN_PATH && req.method === 'GET') {
      const html = renderBattleBridgeCaravanPageV1(freshNonce());
      res.writeHead(200, {
        'content-type': 'text/html; charset=utf-8', 'content-length': Buffer.byteLength(html),
        'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer',
        'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
      });
      res.end(html); return true;
    }
    const route = url.pathname.slice((CARAVAN_PATH + '/').length);
    try {
      if (req.method === 'GET' && route === 'status') {
        if (url.search) { json(res, 400, { ok: false, message: 'Unexpected status parameters.' }); return true; }
        json(res, 200, { ok: true, csrfNonce: freshNonce(), view: projected(await provider.observe()) }); return true;
      }
      if (req.method === 'GET' && route === 'reconcile') {
        const requestId = url.searchParams.get('requestId');
        if (!validId(requestId) || [...url.searchParams].length !== 1) {
          json(res, 400, { ok: false, message: 'A valid original request is required.' }); return true;
        }
        json(res, 200, { ok: true, csrfNonce: freshNonce(), view: projected(await provider.reconcile(requestId), requestId) }); return true;
      }
      if (!['prepare', 'approve', 'cancel'].includes(route)) { json(res, 404, { ok: false, message: 'Page not found.' }); return true; }
      if (req.method !== 'POST') { json(res, 405, { ok: false, message: 'Method not allowed.' }); return true; }
      if (url.search) { json(res, 400, { ok: false, message: 'Unexpected request parameters.' }); return true; }
      const nonce = req.headers['x-stephanos-caravan-nonce'];
      const expires = nonces.get(nonce);
      if (!expires || expires <= nowMs()) {
        json(res, 403, { ok: false, csrfNonce: freshNonce(), message: 'Refresh status before confirming.' }); return true;
      }
      nonces.delete(nonce);
      const csrfNonce = freshNonce();
      const body = await readBody(req);
      if (route === 'cancel') {
        if (!exactKeys(body, ['requestId']) || !validId(body.requestId)) {
          json(res, 400, { ok: false, csrfNonce, message: 'Only the original request can be cancelled.' }); return true;
        }
        const requestId = body.requestId;
        if (pending.has(requestId) || pending.size >= 8 || typeof provider.cancel !== 'function') {
          json(res, 409, { ok: false, csrfNonce, view: unconfirmed(requestId), message: 'Check the existing request before cancelling.' }); return true;
        }
        pending.add(requestId);
        try {
          const current = await provider.reconcile(requestId), view = projected(current, requestId);
          if (!view.receiptVerified || current?.candidate?.requestId !== requestId) {
            json(res, 409, { ok: false, csrfNonce, view, message: 'The original request could not be verified.' }); return true;
          }
          const outcome = await provider.cancel(requestId);
          json(res, 200, { ok: true, csrfNonce, view: projected(outcome, requestId) }); return true;
        } finally { pending.delete(requestId); }
      }
      if (route === 'prepare') {
        if (!exactKeys(body, ['requestId', 'candidateSha256']) || !validId(body.requestId) || !hex(body.candidateSha256, 64)) {
          json(res, 400, { ok: false, csrfNonce, message: 'Confirm the displayed request. The installed authority selects the package and target.' }); return true;
        }
        const snapshot = await provider.prepare();
        const view = projected(snapshot);
        if (!view.canApprove) {
          json(res, 409, { ok: false, csrfNonce, view, message: 'The protected installer is not ready for approval.' }); return true;
        }
        if (view.requestId !== body.requestId || view.candidateSha256 !== body.candidateSha256) {
          json(res, 409, { ok: false, csrfNonce, view, message: 'The installation changed. Review the updated details before approving.' }); return true;
        }
        const result = mobileInstallationRequestOptionsV1(snapshot.candidate, snapshot.enrollment, { nowMs: nowMs() });
        if (!result.ok) {
          json(res, 409, { ok: false, csrfNonce, view: unconfirmed(view.requestId), message: 'A fresh installation approval is required.' }); return true;
        }
        json(res, 200, { ok: true, csrfNonce, view, publicKey: result.publicKey }); return true;
      }
      if (!exactKeys(body, ['requestId', 'assertion']) || !validId(body.requestId)) {
        json(res, 400, { ok: false, csrfNonce, message: 'Only the original request and device confirmation are accepted.' }); return true;
      }
      const requestId = body.requestId;
      if (pending.has(requestId) || attempted.has(requestId) || pending.size >= 8 || attempted.size >= 64) {
        json(res, 409, { ok: false, csrfNonce, view: unconfirmed(requestId), message: 'Check the existing request before continuing.' }); return true;
      }
      pending.add(requestId);
      let dispatched = false;
      try {
        const snapshot = await provider.reconcile(requestId);
        const view = projected(snapshot, requestId);
        if (snapshot?.candidate?.requestId !== requestId || !view.canApprove) {
          json(res, 409, { ok: false, csrfNonce, view, message: 'This request is not awaiting approval.' }); return true;
        }
        const verified = verifyMobileInstallationAssertionV1({
          candidate: snapshot.candidate, enrollment: snapshot.enrollment, assertion: body.assertion,
        }, { nowMs: nowMs() });
        if (!verified.ok || verified.approvalVerified !== true) {
          json(res, 403, { ok: false, csrfNonce, view, message: 'Device confirmation could not be verified.' }); return true;
        }
        // Preflight is never native authority. Forward original evidence only.
        // Protected execution must reverify identity, release eligibility and journal.
        attempted.set(requestId, { sequence: view.sequence });
        dispatched = true;
        const outcome = await provider.approve({ requestId, assertion: body.assertion });
        json(res, 200, { ok: true, csrfNonce, view: projected(outcome, requestId) }); return true;
      } catch {
        json(res, 503, { ok: false, csrfNonce, view: unconfirmed(requestId),
          message: dispatched ? 'Approval was sent; check the same request for its result.' : 'The protected installation status is unavailable.' });
        return true;
      } finally { pending.delete(requestId); }
    } catch (error) {
      const status = [400, 413, 415].includes(error?.statusCode) ? error.statusCode : 503;
      json(res, status, { ok: false, csrfNonce: freshNonce(), message: status === 503
        ? 'The protected installation status is unavailable.' : 'The request format was not accepted.',
        view: unconfirmed() });
      return true;
    }
  };
}
