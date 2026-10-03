#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { dirname, relative, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import {
  launchProofBrowser,
  loadPlaywright,
} from './browser-proof-runner.mjs';
import { deriveFlywheelTelemetryView } from '../shared/runtime/flywheelTelemetryModel.mjs';
import { deriveFlywheelWorkspaceView } from '../shared/runtime/upliftWorkspaceProjectionV1.mjs';

export const SOVEREIGN_COMMANDER_FLYWHEEL_RUNTIME_PROOF_SCHEMA = 'stephanos.sovereign-commander-flywheel-runtime-proof.v1';
export const SOVEREIGN_COMMANDER_FLYWHEEL_RUNTIME_PROOF_PROFILE = 'flywheel-live-feed';
export const SOVEREIGN_COMMANDER_FLYWHEEL_RUNTIME_PROOF_MARKER = 'SOVEREIGN_COMMANDER_FLYWHEEL_RUNTIME_PROOF_RESULT=';

const SHA40 = /^[0-9a-f]{40}$/i;
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_PROOF_ROOT = resolve(REPO_ROOT, '.stephanos', 'local-state-checkpoints', 'sovereign-ui-proof');
const UI_HEALTH_URL = 'http://127.0.0.1:4173/__stephanos/health';
const FLYWHEEL_URL = 'http://127.0.0.1:4173/apps/stephanos/dist/index.html?surface=flywheel';
const FEED_URL = 'http://127.0.0.1:8787/api/shared-workspace/dashboard-feed?scope=full-history';
const FEED_BUDGET_MS = 10_000;

function text(value) {
  return String(value ?? '').trim();
}

function safeStamp(value = new Date()) {
  return value.toISOString().replace(/[:.]/g, '-');
}

function gitExecutable(platform = process.platform) {
  return platform === 'win32' ? 'C:\\Program Files\\Git\\cmd\\git.exe' : 'git';
}

function fixedGit(args, {
  repoRoot = REPO_ROOT,
  spawnSyncFn = spawnSync,
  platform = process.platform,
} = {}) {
  const result = spawnSyncFn(gitExecutable(platform), args, {
    cwd: repoRoot,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    timeout: 15_000,
    maxBuffer: 64 * 1024,
  });
  return Object.freeze({
    ok: !result?.error && Number(result?.status) === 0,
    stdout: String(result?.stdout || ''),
  });
}

function healthHeadMatches(health = {}, expectedHead = '') {
  const expected = text(expectedHead).toLowerCase();
  if (!SHA40.test(expected)) return false;
  const direct = text(health?.gitCommit || health?.commit).toLowerCase();
  if (direct === expected || (direct.length >= 7 && expected.startsWith(direct))) return true;
  const marker = text(health?.runtimeMarker || health?.marker).toLowerCase();
  const tokens = marker.match(/[0-9a-f]{7,40}/g) || [];
  return tokens.some((token) => token === expected || (token.length >= 7 && expected.startsWith(token)));
}

async function fetchJsonWithinBudget(fetchFn, url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();
  try {
    const response = await fetchFn(url, {
      method: 'GET',
      cache: 'no-store',
      headers: { accept: 'application/json', 'cache-control': 'no-cache' },
      signal: controller.signal,
    });
    const elapsedMs = Date.now() - startedAt;
    const json = response?.ok ? await response.json() : null;
    return Object.freeze({ ok: response?.ok === true, status: Number(response?.status || 0), elapsedMs, json });
  } finally {
    clearTimeout(timer);
  }
}

export function evaluateFlywheelRuntimeObservation({
  feed = {},
  browser = {},
  consoleErrors = [],
  pageErrors = [],
} = {}) {
  const blockers = [];
  if (feed?.telemetryValid !== true) blockers.push('FLYWHEEL_FEED_INVALID');
  if (feed?.workspaceValid !== true) blockers.push('FLYWHEEL_WORKSPACE_PROJECTION_INVALID');
  if (!['ready', 'stale'].includes(String(feed?.state || '').toLowerCase())) blockers.push('FLYWHEEL_FEED_STATE_INVALID');
  if (Number(feed?.responseMs) > FEED_BUDGET_MS) blockers.push('FLYWHEEL_FEED_EXCEEDED_CLIENT_BUDGET');
  if (feed?.starfieldSeedPlanted !== true) blockers.push('FLYWHEEL_STARFIELD_SEED_NOT_LIVE');
  if (!['ready', 'stale'].includes(String(browser?.liveState || '').toLowerCase())) blockers.push('FLYWHEEL_BROWSER_LIVE_STATE_INVALID');
  if (!['LIVE', 'STALE'].includes(String(browser?.liveLabel || '').toUpperCase())) blockers.push('FLYWHEEL_BROWSER_LIVE_LABEL_INVALID');
  if (browser?.backendUnreachableVisible === true) blockers.push('FLYWHEEL_BROWSER_BACKEND_UNREACHABLE');
  if (browser?.seedVisible !== true) blockers.push('FLYWHEEL_BROWSER_SEED_NOT_VISIBLE');
  if (consoleErrors.length > 0) blockers.push('FLYWHEEL_BROWSER_CONSOLE_ERRORS');
  if (pageErrors.length > 0) blockers.push('FLYWHEEL_BROWSER_PAGE_ERRORS');
  return Object.freeze({
    accepted: blockers.length === 0,
    blockers: Object.freeze([...new Set(blockers)]),
  });
}

export async function collectFlywheelRuntimeProof({
  repoRoot = REPO_ROOT,
  proofRoot = DEFAULT_PROOF_ROOT,
  fetchFn = globalThis.fetch,
  loadPlaywrightFn = loadPlaywright,
  launchBrowserFn = launchProofBrowser,
  spawnSyncFn = spawnSync,
  platform = process.platform,
  now = () => new Date(),
} = {}) {
  const branch = fixedGit(['branch', '--show-current'], { repoRoot, spawnSyncFn, platform });
  const headRead = fixedGit(['rev-parse', 'HEAD'], { repoRoot, spawnSyncFn, platform });
  const sourceHead = text(headRead.stdout).toLowerCase();
  if (!branch.ok || text(branch.stdout) !== 'main') {
    return Object.freeze({ ok: false, blocker: 'FLYWHEEL_PROOF_CANONICAL_MAIN_REQUIRED', sourceHead: SHA40.test(sourceHead) ? sourceHead : '', exactHeadProofOk: false });
  }
  if (!headRead.ok || !SHA40.test(sourceHead)) {
    return Object.freeze({ ok: false, blocker: 'FLYWHEEL_PROOF_SOURCE_HEAD_UNAVAILABLE', sourceHead: '', exactHeadProofOk: false });
  }

  let health = null;
  try {
    const response = await fetchFn(UI_HEALTH_URL, { method: 'GET', cache: 'no-store' });
    if (response?.ok) health = await response.json();
  } catch {}
  if (!health || !healthHeadMatches(health, sourceHead)) {
    return Object.freeze({ ok: false, blocker: 'FLYWHEEL_PROOF_4173_EXACT_HEAD_REQUIRED', sourceHead, exactHeadProofOk: false });
  }

  let feedResult = null;
  try {
    feedResult = await fetchJsonWithinBudget(fetchFn, FEED_URL, FEED_BUDGET_MS);
  } catch (error) {
    return Object.freeze({
      ok: false,
      blocker: error?.name === 'AbortError' ? 'FLYWHEEL_PROOF_FEED_TIMEOUT' : 'FLYWHEEL_PROOF_FEED_REQUEST_FAILED',
      sourceHead,
      exactHeadProofOk: true,
      finalVerdict: 'FLYWHEEL_RUNTIME_PROOF_BLOCKED',
    });
  }
  const telemetryView = deriveFlywheelTelemetryView(feedResult?.json || {});
  const workspaceView = deriveFlywheelWorkspaceView(feedResult?.json || {});
  const feed = Object.freeze({
    httpOk: feedResult?.ok === true,
    httpStatus: feedResult?.status || 0,
    responseMs: feedResult?.elapsedMs ?? FEED_BUDGET_MS + 1,
    state: String(feedResult?.json?.state || '').toLowerCase(),
    telemetryValid: telemetryView.valid === true,
    workspaceValid: workspaceView.valid === true,
    goalCount: Array.isArray(feedResult?.json?.projection?.goals) ? feedResult.json.projection.goals.length : 0,
    eventCount: Array.isArray(feedResult?.json?.records?.eventRecords) ? feedResult.json.records.eventRecords.length : 0,
    starfieldSeedPlanted: workspaceView?.outcomeSeedGrowth?.planted === true,
    starfieldSeedStage: text(workspaceView?.outcomeSeedGrowth?.stage),
  });

  const pw = await loadPlaywrightFn();
  if (!pw?.chromium) {
    return Object.freeze({ ok: false, blocker: 'FLYWHEEL_PROOF_BROWSER_AUTOMATION_UNAVAILABLE', sourceHead, exactHeadProofOk: true, feed, url: FLYWHEEL_URL });
  }

  const consoleErrors = [];
  const pageErrors = [];
  let browser = null;
  try {
    browser = await launchBrowserFn(pw, { platform, headless: true });
    const context = await browser.newContext({ serviceWorkers: 'block' });
    const page = await context.newPage();
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    page.on('pageerror', (error) => pageErrors.push(text(error?.message || error)));

    const response = await page.goto(FLYWHEEL_URL, { waitUntil: 'domcontentloaded', timeout: 15_000 });
    if (!response || !response.ok() || page.url() !== FLYWHEEL_URL) throw new Error('FLYWHEEL_PROOF_RUNTIME_URL_MISMATCH');
    await page.waitForSelector('[data-testid="flywheel-live-state"]', { state: 'visible', timeout: 15_000 });
    await page.waitForFunction(() => {
      const live = document.querySelector('[data-testid="flywheel-live-state"]');
      return ['ready', 'stale'].includes(String(live?.dataset?.state || '').toLowerCase());
    }, null, { timeout: 15_000 });

    const browserObservation = await page.evaluate(() => {
      const live = document.querySelector('[data-testid="flywheel-live-state"]');
      const unreachable = document.querySelector('[data-testid="flywheel-backend-unreachable"]');
      const seed = document.querySelector('[data-testid="flywheel-outcome-seed-growth"]');
      const isVisible = (node) => {
        if (!node) return false;
        const style = getComputedStyle(node);
        const rect = node.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
      };
      return {
        liveState: String(live?.dataset?.state || '').trim().toLowerCase(),
        liveLabel: String(live?.textContent || '').trim().toUpperCase(),
        backendUnreachableVisible: isVisible(unreachable),
        seedVisible: isVisible(seed),
      };
    });

    const evaluation = evaluateFlywheelRuntimeObservation({
      feed,
      browser: browserObservation,
      consoleErrors,
      pageErrors,
    });
    const accepted = evaluation.accepted;

    await mkdir(proofRoot, { recursive: true });
    const stamp = safeStamp(now());
    const screenshotPath = resolve(proofRoot, `${sourceHead}-flywheel-live-feed-${stamp}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: true });
    const screenshotSha256 = createHash('sha256').update(await readFile(screenshotPath)).digest('hex');

    const receipt = {
      schemaVersion: SOVEREIGN_COMMANDER_FLYWHEEL_RUNTIME_PROOF_SCHEMA,
      profile: SOVEREIGN_COMMANDER_FLYWHEEL_RUNTIME_PROOF_PROFILE,
      ok: accepted,
      sourceHead,
      exactHeadProofOk: true,
      url: FLYWHEEL_URL,
      generatedAtUtc: now().toISOString(),
      browserMechanism: 'shared-browser-proof-runner-playwright-edge',
      screenshotPath: relative(repoRoot, screenshotPath).replaceAll('\\', '/'),
      screenshotSha256,
      feed,
      browser: browserObservation,
      blockers: evaluation.blockers,
      consoleErrorCount: consoleErrors.length,
      pageErrorCount: pageErrors.length,
    };
    receipt.evidenceHash = createHash('sha256').update(JSON.stringify(receipt)).digest('hex');
    const receiptPath = resolve(proofRoot, `${sourceHead}-flywheel-live-feed-${stamp}.json`);
    await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');

    return Object.freeze({
      ...receipt,
      receiptPath: relative(repoRoot, receiptPath).replaceAll('\\', '/'),
      finalVerdict: accepted ? 'FLYWHEEL_RUNTIME_PROOF_PASS' : 'FLYWHEEL_RUNTIME_PROOF_BLOCKED',
    });
  } catch (error) {
    return Object.freeze({
      ok: false,
      blocker: text(error?.code || error?.message || 'FLYWHEEL_RUNTIME_PROOF_FAILED'),
      sourceHead,
      exactHeadProofOk: true,
      feed,
      consoleErrorCount: consoleErrors.length,
      pageErrorCount: pageErrors.length,
      finalVerdict: 'FLYWHEEL_RUNTIME_PROOF_BLOCKED',
    });
  } finally {
    await browser?.close?.();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = await collectFlywheelRuntimeProof();
  process.stdout.write(`${SOVEREIGN_COMMANDER_FLYWHEEL_RUNTIME_PROOF_MARKER}${JSON.stringify(result)}\n`);
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.exitCode = result.ok ? 0 : 2;
}
