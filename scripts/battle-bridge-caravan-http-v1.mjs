import { randomBytes, timingSafeEqual, createHash } from 'node:crypto';
import {
  projectMobileInstallationV1, mobileInstallationRequestOptionsV1,
  verifyMobileInstallationAssertionV1,
  normalizeMobileDevicePairingContextV1, mobileDevicePairingCreateOptionsV1,
  mobileDevicePairingSetupDescriptorV1, verifyMobileDevicePairingRegistrationV1,
  verifyMobileDevicePairingSetupAssertionV1,
} from '../shared/agents/battleBridgeMobileInstallationV1.mjs';
import { createBattleBridgeMobileInstallationProviderV1 } from './windows/battle-bridge-mobile-install-native-v1.mjs';
import { renderBattleBridgeCaravanPageV1 } from './battle-bridge-caravan-page-v1.mjs';

export const CARAVAN_PATH = '/caravan';
export const CARAVAN_NONCE_TTL_MS = 5 * 60_000;
export const CARAVAN_PAIRING_TTL_MS = 15 * 60_000;
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

async function readBody(req, maximum = MAX_BODY) {
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(req.headers['content-type'] || ''))
    throw Object.assign(new Error('JSON_REQUIRED'), { statusCode: 415 });
  const chunks = [];
  let length = 0;
  for await (const chunk of req) {
    length += chunk.length;
    if (length > maximum) throw Object.assign(new Error('REQUEST_TOO_LARGE'), { statusCode: 413 });
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
  // One optional bounded capture draft belongs to this existing handler only.
  // It is neither enrollment nor a native request, journal, queue or authority.
  let pairingDraft = null, pairingArmPending = false;
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
  function pairingCurrent() {
    if (pairingDraft && pairingDraft.stage !== 'EXPIRED' && nowMs() >= pairingDraft.expires) {
      pairingDraft.stage = 'EXPIRED';
      pairingDraft.registration = pairingDraft.assertion = pairingDraft.descriptor = null;
    }
    return pairingDraft;
  }
  function pairingView(draft) {
    const body = { ok: true, stage: draft?.stage || 'UNKNOWN', installability: 'NOT_INSTALLABLE',
      executionAuthorityGranted: false, enrollmentQualified: false };
    if (!draft) return body;
    Object.assign(body, { contextSha256: draft.contextSha256, sourceHead: draft.context.sourceHead,
      expiresAtUtc: draft.context.expiresAtUtc });
    if (draft.stage === 'AWAITING_CONFIRMATION') Object.assign(body, {
      publicKey: draft.descriptor.publicKey, setupDescriptorSha256: draft.descriptor.setupDescriptorSha256,
      deviceFingerprint: draft.deviceFingerprint });
    return body;
  }
  function captureMatches(req, draft) {
    const value = req.headers['x-stephanos-pairing-capture'];
    return draft && typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
      && timingSafeEqual(Buffer.from(value, 'hex'), draft.capability);
  }
  function strictPairingOrigin(req) {
    if (typeof options.publicOrigin !== 'string' || !options.publicOrigin) return false;
    const site = req.headers['sec-fetch-site'];
    if (site && site !== 'same-origin' && site !== 'none') return false;
    return req.headers.origin ? req.headers.origin === options.publicOrigin
      : req.method === 'GET' && site === 'same-origin';
  }
  const canonicalCapture = value => JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
  async function handlePairing(req, res, url) {
    const route = url.pathname.slice((CARAVAN_PATH + '/setup/').length);
    const privateRoute = route === 'arm' || route === 'result';
    if (privateRoute) {
      // This callback is wired privately by Commander from its existing bearer.
      // No browser boolean, Origin, capability or payload can grant this access.
      if (typeof options.privateOwnerAuthorized !== 'function' || options.privateOwnerAuthorized(req) !== true
          || req.headers.origin !== undefined
          || (req.headers['sec-fetch-site'] && req.headers['sec-fetch-site'] !== 'none')) {
        json(res, 403, { ok: false, message: 'Private owner authorization is required.' }); return true;
      }
    } else if (!strictPairingOrigin(req)) {
      json(res, 403, { ok: false, message: 'Use the paired private origin.' }); return true;
    }
    if (url.search) { json(res, 400, { ok: false, message: 'Unexpected setup parameters.' }); return true; }
    if (privateRoute && req.method !== (route === 'arm' ? 'POST' : 'GET')) {
      json(res, 405, { ok: false, message: 'Method not allowed.' }); return true;
    }
    if (route === 'result') {
      const draft = pairingCurrent(), body = pairingView(draft);
      delete body.publicKey; delete body.deviceFingerprint; delete body.setupDescriptorSha256;
      if (draft?.stage === 'COMPLETED') {
        Object.assign(body, { context: draft.context, registration: draft.registration,
          assertion: draft.assertion,
          setupDescriptor: draft.descriptor.setupDescriptor,
          setupDescriptorSha256: draft.descriptor.setupDescriptorSha256,
          proposedEnrollmentJson: draft.descriptor.proposedEnrollmentJson });
      }
      json(res, 200, body); return true;
    }
    if (route === 'arm') {
      const body = await readBody(req);
      const normalized = exactKeys(body, ['context'])
        ? normalizeMobileDevicePairingContextV1(body.context, { nowMs: nowMs() }) : null;
      if (!normalized?.ok || normalized.context.sourceHead !== options.expectedMain
          || !options.publicOrigin || normalized.context.origin !== options.publicOrigin) {
        json(res, 400, { ok: false, message: 'A fresh source-bound setup context is required.' }); return true;
      }
      const current = pairingCurrent();
      if (pairingArmPending || (current && current.stage !== 'EXPIRED' && current.contextSha256 !== normalized.contextSha256)) {
        json(res, 409, { ok: false, message: 'The original setup capture remains active.' }); return true;
      }
      if (!current || current.stage === 'EXPIRED') {
        pairingArmPending = true;
        try {
          if (projected(await provider.observe()).state !== 'SETUP_REQUIRED') {
            json(res, 409, { ok: false, message: 'Protected setup is not currently missing.' }); return true;
          }
          const checked = normalizeMobileDevicePairingContextV1(normalized.context, { nowMs: nowMs() });
          if (!checked.ok) { json(res, 410, { ok: false, stage: 'EXPIRED' }); return true; }
          pairingDraft = { context: checked.context, contextSha256: checked.contextSha256,
            expires: Math.min(Date.parse(checked.context.expiresAtUtc), nowMs() + CARAVAN_PAIRING_TTL_MS),
            capability: randomBytes(32), stage: 'ARMED', registration: null, assertion: null, descriptor: null };
        } finally { pairingArmPending = false; }
      }
      json(res, 200, { ...pairingView(pairingDraft),
        captureUrl: pairingDraft.context.origin + '/caravan#pairing=' + pairingDraft.capability.toString('hex') });
      return true;
    }
    const draft = pairingCurrent();
    if (!captureMatches(req, draft)) {
      json(res, 403, { ok: false, message: 'The setup capture is unavailable.' }); return true;
    }
    if (draft.stage === 'EXPIRED') { json(res, 410, pairingView(draft)); return true; }
    if (route === 'status' && req.method === 'GET') {
      json(res, 200, { ...pairingView(draft), csrfNonce: freshNonce() }); return true;
    }
    if (!['begin-create', 'register', 'assert'].includes(route)) {
      json(res, 404, { ok: false, message: 'Setup route not found.' }); return true;
    }
    if (req.method !== 'POST') { json(res, 405, { ok: false, message: 'Method not allowed.' }); return true; }
    const nonce = req.headers['x-stephanos-caravan-nonce'];
    if (!nonces.has(nonce) || nonces.get(nonce) <= nowMs()) {
      json(res, 403, { ...pairingView(draft), ok: false, message: 'Refresh setup status before continuing.' }); return true;
    }
    nonces.delete(nonce);
    const body = await readBody(req, route === 'register' ? 64 * 1024 : MAX_BODY);
    const csrfNonce = freshNonce();
    // The body can arrive slowly. Never admit a credential after draft expiry
    // or a private re-arm replaced this exact capture during that await.
    if (pairingCurrent() !== draft || draft.stage === 'EXPIRED') {
      json(res, 410, { ...pairingView(draft), csrfNonce }); return true;
    }
    if (route === 'begin-create') {
      if (!exactKeys(body, [])) { json(res, 400, { ok: false, csrfNonce }); return true; }
      if (draft.stage !== 'ARMED') { json(res, 409, { ...pairingView(draft), ok: false, csrfNonce }); return true; }
      const create = mobileDevicePairingCreateOptionsV1(draft.context, { nowMs: nowMs() });
      if (!create.ok) { json(res, 409, { ...pairingView(draft), ok: false, csrfNonce }); return true; }
      draft.stage = 'CREATE_STARTED';
      json(res, 200, { ...pairingView(draft), csrfNonce, publicKey: create.publicKey }); return true;
    }
    if (route === 'register') {
      if (!exactKeys(body, ['registration'])) { json(res, 400, { ok: false, csrfNonce }); return true; }
      const encoded = canonicalCapture(body.registration);
      if (draft.registration) {
        json(res, encoded === draft.registrationCanonical ? 200 : 409,
          { ...pairingView(draft), ok: encoded === draft.registrationCanonical, csrfNonce }); return true;
      }
      if (draft.stage !== 'CREATE_STARTED') { json(res, 409, { ...pairingView(draft), ok: false, csrfNonce }); return true; }
      const verified = verifyMobileDevicePairingRegistrationV1(draft.context, body.registration, { nowMs: nowMs() });
      const descriptor = verified.ok && mobileDevicePairingSetupDescriptorV1(draft.context, body.registration, { nowMs: nowMs() });
      if (!verified.ok || !descriptor.ok) { json(res, 400, { ...pairingView(draft), ok: false, csrfNonce }); return true; }
      draft.registration = JSON.parse(encoded); draft.registrationCanonical = encoded; draft.descriptor = descriptor;
      draft.deviceFingerprint = createHash('sha256').update(Buffer.from(verified.publicKeySpki, 'base64url')).digest('hex');
      draft.stage = 'AWAITING_CONFIRMATION';
      json(res, 200, { ...pairingView(draft), csrfNonce }); return true;
    }
    if (!exactKeys(body, ['assertion'])) { json(res, 400, { ok: false, csrfNonce }); return true; }
    const encoded = canonicalCapture(body.assertion);
    if (draft.stage === 'COMPLETED') {
      json(res, encoded === draft.assertionCanonical ? 200 : 409,
        { ...pairingView(draft), ok: encoded === draft.assertionCanonical, csrfNonce }); return true;
    }
    if (draft.stage !== 'AWAITING_CONFIRMATION') { json(res, 409, { ...pairingView(draft), ok: false, csrfNonce }); return true; }
    const verified = verifyMobileDevicePairingSetupAssertionV1(draft.context, draft.registration, body.assertion, { nowMs: nowMs() });
    if (!verified.ok || verified.devicePossessionVerified !== true) { json(res, 403, { ...pairingView(draft), ok: false, csrfNonce }); return true; }
    draft.assertion = JSON.parse(encoded); draft.assertionCanonical = encoded; draft.stage = 'COMPLETED';
    json(res, 200, { ...pairingView(draft), csrfNonce }); return true;
  }
  return async function handleCaravan(req, res, url) {
    if (url.pathname !== CARAVAN_PATH && !url.pathname.startsWith(CARAVAN_PATH + '/')) return false;
    if (url.pathname.startsWith(CARAVAN_PATH + '/setup/')) {
      try { return await handlePairing(req, res, url); }
      catch (error) {
        json(res, [400, 413, 415].includes(error?.statusCode) ? error.statusCode : 503,
          { ok: false, stage: 'UNKNOWN', installability: 'NOT_INSTALLABLE', executionAuthorityGranted: false,
            message: 'The setup capture could not be confirmed.' }); return true;
      }
    }
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
