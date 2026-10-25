#!/usr/bin/env node
// Observe an explicitly debug-enabled, locally attached Chromium session.
// No debugging listener is started here and no browser profile is modified.
import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const BROWSER_OBSERVATION_SCHEMA = 'stephanos.sovereign-browser-observation.v1';
export const BROWSER_OBSERVATION_MARKER = 'SOVEREIGN_BROWSER_OBSERVATION_RESULT=';
export const BROWSER_CDP_ENDPOINT = 'http://127.0.0.1:9222';
const DEFAULT_ORIGINS = Object.freeze([
  'http://127.0.0.1:4173', 'http://localhost:4173',
  'http://127.0.0.1:5173', 'http://localhost:5173',
]);
const MAX_TABS = 8;
const REPO_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const DEFAULT_PROOF_ROOT = resolve(REPO_ROOT, '.stephanos', 'local-state-checkpoints', 'sovereign-browser-observation');
const NATIVE_HOST_ROOT = resolve(REPO_ROOT, '.stephanos', 'local-state-checkpoints', 'sovereign-browser-native-host');
const DEFAULT_NATIVE_RECEIPT_ROOTS = Object.freeze([
  ...['chrome', 'edge', 'brave'].map(browser => resolve(NATIVE_HOST_ROOT, browser, 'receipts')),
  // Continue reading a prior single-browser install without changing its files
  // or registry entry when a different browser is installed.
  resolve(NATIVE_HOST_ROOT, 'receipts'),
]);
const NATIVE_MAX_AGE_MS = 10 * 60 * 1000;
// Keep this order aligned with the fixed native host's unsigned sample.
// This validates receipt integrity; it is not a signer or hostile-writer proof.
const NATIVE_SAMPLE_KEYS = Object.freeze([
  'schemaVersion', 'observedAtUtc', 'mechanism', 'readOnly', 'observationOnly',
  'servedHeadVerified', 'functionalAcceptanceVerified', 'connectedTabCount',
  'admittedTabCount', 'observedTabCount', 'diagnosticTabCount', 'screenshotCount',
  'scanOnly', 'observations', 'screenshots',
]);
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const clean = (value) => String(value ?? '').trim();
const safeCount = (value) => Number.isSafeInteger(value) && value >= 0 ? value : 0;

export function parseBrowserObservationArguments(args = []) {
  // The remote registry fixes the read-only mode. Its caller cannot request
  // another mode, URL, endpoint, shell or profile. Empty args remain the local
  // operator's separately opted-in diagnostic CLI.
  if (args.length === 0) return Object.freeze({ ok: true, nativeReceiptOnly: false });
  if (args.length === 1 && args[0] === '--native-receipt-only')
    return Object.freeze({ ok: true, nativeReceiptOnly: true });
  return Object.freeze({ ok: false, blocker: 'BROWSER_OBSERVATION_ARGUMENT_NOT_ALLOWED' });
}

export function admittedBrowserOrigins(env = {}) {
  const extra = clean(env.STEPHANOS_BROWSER_OBSERVE_ALLOWED_ORIGINS);
  const origins = new Set(DEFAULT_ORIGINS);
  if (extra) {
    const parts = extra.split(',').map(clean);
    // This is local operator configuration, not a remotely supplied URL.
    if (parts.length > 8) throw new Error('BROWSER_ORIGIN_ALLOWLIST_TOO_LARGE');
    for (const part of parts) {
      const url = new URL(part);
      if (!['http:', 'https:'].includes(url.protocol)
        || url.username || url.password || url.search || url.hash
        || url.pathname !== '/' || part.endsWith('/')
        || url.origin !== part) throw new Error('BROWSER_ORIGIN_ALLOWLIST_INVALID');
      origins.add(url.origin);
    }
  }
  return origins;
}

export function admittedBrowserTab(rawUrl, origins = admittedBrowserOrigins()) {
  try {
    const url = new URL(rawUrl);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return false;
    return origins.has(url.origin);
  } catch { return false; }
}

export function safeBrowserPageId(rawUrl) {
  try {
    const url = new URL(rawUrl);
    // Hash the full URL, but never publish query parameters or fragment values.
    return sha256(rawUrl).slice(0, 16);
  } catch { return ''; }
}

export function summarizeDomObservation(dom = {}) {
  const images = Array.isArray(dom.images) ? dom.images.slice(0, 500) : [];
  const links = Array.isArray(dom.links) ? dom.links.slice(0, 1000) : [];
  const brokenImages = images.filter((item) => item?.complete === true && item?.naturalWidth === 0).length;
  const unloadedImages = images.filter((item) => item?.complete !== true).length;
  const emptyLinks = links.filter((item) => !clean(item?.href)).length;
  const genericSpotifyLinks = links.filter((item) => {
    try {
      const url = new URL(item?.href);
      return url.hostname === 'open.spotify.com' && ['/', '/intl-en'].includes(url.pathname);
    } catch { return false; }
  }).length;
  return Object.freeze({
    readyState: ['loading', 'interactive', 'complete'].includes(dom.readyState) ? dom.readyState : 'unknown',
    imageCount: images.length,
    brokenImages,
    unloadedImages,
    linkCount: links.length,
    emptyLinks,
    genericSpotifyLinks,
    buttonCount: safeCount(dom.buttonCount),
    disabledButtonCount: safeCount(dom.disabledButtonCount),
    headingCount: safeCount(dom.headingCount),
    // Observations are not source-head or semantic interaction acceptance proof.
    semanticFunctionalityVerified: false,
    historicalConsoleErrorsKnown: false,
    historicalNetworkFailuresKnown: false,
  });
}

export async function readNativeBrowserObservation({
  nativeReceiptRoot,
  now = () => new Date(),
} = {}) {
  const roots = nativeReceiptRoot === undefined ? DEFAULT_NATIVE_RECEIPT_ROOTS : [nativeReceiptRoot];
  const candidates = [];
  for (const root of roots) {
    try {
      const names = await readdir(root);
      candidates.push(...names.filter((item) => /^[0-9]{8}T[0-9]{9}-[a-f0-9]{16}\.json$/.test(item))
        .sort().reverse().slice(0, 24).map(name => ({ root, name })));
    } catch { /* A browser need not be installed. */ }
  }
  for (const { root, name } of candidates.sort((a, b) => b.name.localeCompare(a.name)).slice(0, 24)) {
    try {
      const full = resolve(root, name);
      const metadata = await lstat(full);
      if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > 70_000) continue;
      const receipt = JSON.parse(await readFile(full, 'utf8'));
      if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)
        || Object.keys(receipt).length !== NATIVE_SAMPLE_KEYS.length + 1
        || NATIVE_SAMPLE_KEYS.some(key => !Object.hasOwn(receipt, key))
        || !/^[a-f0-9]{64}$/.test(receipt.evidenceHash || '')
        || !name.endsWith(`-${receipt.evidenceHash.slice(0, 16)}.json`)
        || sha256(JSON.stringify(Object.fromEntries(NATIVE_SAMPLE_KEYS.map(key => [key, receipt[key]])))) !== receipt.evidenceHash
        || receipt.schemaVersion !== BROWSER_OBSERVATION_SCHEMA
        || receipt.mechanism !== 'operator-permissioned-chromium-native-messaging'
        || receipt.readOnly !== true || receipt.observationOnly !== true
        || receipt.servedHeadVerified !== false || receipt.functionalAcceptanceVerified !== false
        || typeof receipt.scanOnly !== 'boolean') continue;
      if (typeof receipt.observedAtUtc !== 'string'
        || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(receipt.observedAtUtc)
        || !Number.isFinite(Date.parse(receipt.observedAtUtc))
        || new Date(receipt.observedAtUtc).toISOString() !== receipt.observedAtUtc) continue;
      const age = now().getTime() - Date.parse(receipt.observedAtUtc);
      if (!Number.isFinite(age) || age < -60_000 || age > NATIVE_MAX_AGE_MS) continue;
      const diagnosticOnly = receipt.scanOnly === true;
      if (!Number.isSafeInteger(receipt.diagnosticTabCount) || receipt.diagnosticTabCount < 1
        || receipt.diagnosticTabCount > 8
        || receipt.connectedTabCount !== receipt.diagnosticTabCount
        || receipt.admittedTabCount !== receipt.diagnosticTabCount
        || !Array.isArray(receipt.observations)
        || receipt.observations.length !== receipt.diagnosticTabCount
        || !Array.isArray(receipt.screenshots)) continue;
      const imageClaims = receipt.observations.map(row => row?.screenshotSha256);
      if (imageClaims.some(value => typeof value !== 'string'
        || (value !== '' && !/^[a-f0-9]{64}$/.test(value)))) continue;
      if (diagnosticOnly) {
        if (receipt.observedTabCount !== 0 || receipt.screenshotCount !== 0
          || receipt.screenshots.length !== 0 || imageClaims.some(Boolean)) continue;
      } else {
        if (receipt.observedTabCount !== 1 || receipt.screenshotCount !== 1
          || receipt.screenshots.length !== 1) continue;
        const item = receipt.screenshots[0];
        if (!/^[0-9]{8}T[0-9]{9}-[a-f0-9]{16}\.jpg$/.test(item?.imageName || '')
          || !/^[a-f0-9]{64}$/.test(item?.sha256 || '')
          || !item.imageName.endsWith(`-${item.sha256.slice(0, 16)}.jpg`)
          || imageClaims.filter(Boolean).length !== 1
          || !imageClaims.includes(item.sha256)) continue;
        const imageFile = resolve(root, item.imageName);
        const imageStat = await lstat(imageFile);
        if (!imageStat.isFile() || imageStat.isSymbolicLink() || imageStat.size > 2_800_000) continue;
        if (sha256(await readFile(imageFile)) !== item.sha256) continue;
      }
      return Object.freeze({
        schemaVersion: BROWSER_OBSERVATION_SCHEMA,
        ok: true,
        observedAtUtc: receipt.observedAtUtc,
        connectedTabCount: safeCount(receipt.connectedTabCount),
        admittedTabCount: safeCount(receipt.admittedTabCount),
        observedTabCount: safeCount(receipt.observedTabCount),
        diagnosticTabCount: safeCount(receipt.diagnosticTabCount),
        screenshotCount: safeCount(receipt.screenshotCount),
        evidenceHash: receipt.evidenceHash,
        observationOnly: true,
        servedHeadVerified: false,
        functionalAcceptanceVerified: false,
        readOnly: true,
        mechanism: 'operator-permissioned-chromium-native-messaging',
        finalVerdict: diagnosticOnly ? 'BROWSER_OBSERVATION_DIAGNOSTIC' : 'BROWSER_OBSERVATION_CAPTURED',
      });
    } catch { /* Ignore malformed/untrusted receipts; never produce green. */ }
  }
  return null;
}

async function connectLocalBrowser() {
  let chromium;
  try {
    const module = await import('playwright');
    chromium = module.chromium;
  } catch {
    try {
      const module = await import('@playwright/test');
      chromium = module.chromium;
    } catch { throw new Error('BROWSER_PLAYWRIGHT_UNAVAILABLE'); }
  }
  return chromium.connectOverCDP(BROWSER_CDP_ENDPOINT, { timeout: 4_000 });
}

export async function observeSovereignBrowser({
  connect = connectLocalBrowser,
  env = process.env,
  now = () => new Date(),
  proofRoot = DEFAULT_PROOF_ROOT,
  nativeReceiptRoot,
  maxTabs = MAX_TABS,
  nativeReceiptOnly = false,
} = {}) {
  const observedAtUtc = now().toISOString();
  const native = await readNativeBrowserObservation({ nativeReceiptRoot, now });
  if (native) return native;
  // The normal route is the operator-permissioned extension. A legacy
  // debug-enabled CDP browser is never inspected by default.
  if (nativeReceiptOnly || env.STEPHANOS_BROWSER_OBSERVE_ENABLE_CDP !== '1') {
    return Object.freeze({
      ok: false, observedAtUtc, blocker: 'BROWSER_NATIVE_WITNESS_NOT_READY',
      finalVerdict: 'BROWSER_OBSERVATION_BLOCKED',
    });
  }
  let allowedOrigins;
  try { allowedOrigins = admittedBrowserOrigins(env); }
  catch { return Object.freeze({ ok: false, observedAtUtc, blocker: 'BROWSER_ORIGIN_ALLOWLIST_INVALID', finalVerdict: 'BROWSER_OBSERVATION_BLOCKED' }); }
  let browser;
  try { browser = await connect(); }
  catch (error) {
    const msg = clean(error?.message);
    const blocker = msg.includes('BROWSER_PLAYWRIGHT_UNAVAILABLE')
      ? 'BROWSER_PLAYWRIGHT_UNAVAILABLE' : 'BROWSER_SESSION_NOT_CONNECTED';
    return Object.freeze({ ok: false, observedAtUtc, blocker, finalVerdict: 'BROWSER_OBSERVATION_BLOCKED' });
  }
  // Do not close browser: it belongs to the operator. Process exit disconnects CDP.
  const pages = browser.contexts().flatMap((context) => context.pages());
  const admitted = pages.filter((page) => admittedBrowserTab(page.url(), allowedOrigins));
  if (!admitted.length) {
    return Object.freeze({ ok: false, observedAtUtc, blocker: 'NO_AUTHORISED_STEPHANOS_BROWSER_TABS', connectedTabCount: pages.length, observedTabCount: 0, finalVerdict: 'BROWSER_OBSERVATION_BLOCKED' });
  }
  const limit = Math.min(MAX_TABS, Math.max(1, Number(maxTabs) || MAX_TABS));
  const observations = [];
  await mkdir(proofRoot, { recursive: true });
  for (const page of admitted.slice(0, limit)) {
    const initialUrl = page.url();
    const id = safeBrowserPageId(initialUrl);
    const errors = { console: 0, page: 0, network: 0 };
    let mainDocumentChanged = false;
    const onConsole = (msg) => { if (msg.type() === 'error') errors.console += 1; };
    const onPageError = () => { errors.page += 1; };
    const onRequestFailed = () => { errors.network += 1; };
    const onNavigation = (frame) => {
      if (!frame.parentFrame()) mainDocumentChanged = true;
    };
    page.on('console', onConsole);
    page.on('pageerror', onPageError);
    page.on('requestfailed', onRequestFailed);
    page.on('framenavigated', onNavigation);
    try {
      if (!admittedBrowserTab(initialUrl, allowedOrigins)) throw new Error('BROWSER_ORIGIN_CHANGED');
      // Passive only: no reload, click, goto, storage/cookie access, form entry or script mutation.
      const dom = await page.evaluate((origins) => {
        if (!origins.includes(location.origin)
          || !['http:', 'https:'].includes(location.protocol)) return null;
        return {
          readyState: document.readyState,
          images: [...document.querySelectorAll('img')].slice(0, 500).map((el) => ({ complete: el.complete, naturalWidth: el.naturalWidth })),
          links: [...document.querySelectorAll('a')].slice(0, 1000).map((el) => ({ href: el.href })),
          buttonCount: document.querySelectorAll('button').length,
          disabledButtonCount: document.querySelectorAll('button:disabled').length,
          headingCount: document.querySelectorAll('h1,h2,h3').length,
        };
      }, [...allowedOrigins]);
      if (!dom || mainDocumentChanged || page.url() !== initialUrl) throw new Error('BROWSER_ORIGIN_CHANGED');
      const screenshot = await page.screenshot({ type: 'png', timeout: 7_000 });
      // Discard bytes when a navigation occurred during capture, including an
      // away-and-back transition whose final URL equals the original URL.
      if (mainDocumentChanged || page.url() !== initialUrl) throw new Error('BROWSER_ORIGIN_CHANGED');
      const screenshotHash = sha256(screenshot);
      const screenshotName = `${observedAtUtc.replace(/[:.]/g, '-')}-${id}.png`;
      await writeFile(resolve(proofRoot, screenshotName), screenshot);
      observations.push(Object.freeze({
        tabId: id,
        captured: true,
        screenshotSha256: screenshotHash,
        screenshotName,
        ...summarizeDomObservation(dom),
        // Only events that occur *after* listeners attach are available here.
        errorsObservedDuringCapture: { ...errors },
      }));
    } catch {
      observations.push(Object.freeze({ tabId: id, captured: false, blocker: 'BROWSER_TAB_CAPTURE_FAILED' }));
    } finally {
      page.off('console', onConsole);
      page.off('pageerror', onPageError);
      page.off('requestfailed', onRequestFailed);
      page.off('framenavigated', onNavigation);
    }
  }
  const capturedCount = observations.filter((item) => item.captured).length;
  const receipt = {
    schemaVersion: BROWSER_OBSERVATION_SCHEMA,
    observedAtUtc,
    mechanism: 'operator-opt-in-local-chromium-cdp',
    readOnly: true,
    connectedTabCount: pages.length,
    admittedTabCount: admitted.length,
    observedTabCount: observations.length,
    screenshotCount: capturedCount,
    truncated: admitted.length > limit,
    observationOnly: true,
    servedHeadVerified: false,
    functionalAcceptanceVerified: false,
    observations,
  };
  const evidenceHash = sha256(JSON.stringify(receipt));
  const receiptName = `${observedAtUtc.replace(/[:.]/g, '-')}-${evidenceHash.slice(0, 16)}.json`;
  await writeFile(resolve(proofRoot, receiptName), `${JSON.stringify({ ...receipt, evidenceHash }, null, 2)}\n`, 'utf8');
  return Object.freeze({
    ...receipt,
    evidenceHash,
    receiptName,
    ok: capturedCount > 0 && capturedCount === observations.length,
    finalVerdict: capturedCount > 0 && capturedCount === observations.length
      ? 'BROWSER_OBSERVATION_CAPTURED' : 'BROWSER_OBSERVATION_PARTIAL',
  });
}

export function publicBrowserObservationProjection(result = {}) {
  return Object.freeze({
    schemaVersion: BROWSER_OBSERVATION_SCHEMA,
    ok: result.ok === true,
    finalVerdict: ['BROWSER_OBSERVATION_CAPTURED', 'BROWSER_OBSERVATION_DIAGNOSTIC', 'BROWSER_OBSERVATION_PARTIAL', 'BROWSER_OBSERVATION_BLOCKED'].includes(result.finalVerdict) ? result.finalVerdict : 'BROWSER_OBSERVATION_BLOCKED',
    blocker: clean(result.blocker).slice(0, 96),
    observedAtUtc: clean(result.observedAtUtc).slice(0, 40),
    connectedTabCount: safeCount(result.connectedTabCount),
    admittedTabCount: safeCount(result.admittedTabCount),
    observedTabCount: safeCount(result.observedTabCount),
    screenshotCount: safeCount(result.screenshotCount),
    diagnosticTabCount: safeCount(result.diagnosticTabCount),
    evidenceHash: /^[0-9a-f]{64}$/.test(clean(result.evidenceHash)) ? result.evidenceHash : '',
    observationOnly: true,
    servedHeadVerified: false,
    functionalAcceptanceVerified: false,
    readOnly: true,
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const parsed = parseBrowserObservationArguments(process.argv.slice(2));
  const result = parsed.ok ? await observeSovereignBrowser({ nativeReceiptOnly: parsed.nativeReceiptOnly })
    : { ...parsed, finalVerdict: 'BROWSER_OBSERVATION_BLOCKED' };
  const projection = publicBrowserObservationProjection(result);
  process.stdout.write(`${BROWSER_OBSERVATION_MARKER}${JSON.stringify(projection)}\n`);
  process.exitCode = result.ok ? 0 : 2;
}
