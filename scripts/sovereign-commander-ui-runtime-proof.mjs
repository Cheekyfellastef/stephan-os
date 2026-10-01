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

export const SOVEREIGN_COMMANDER_UI_RUNTIME_PROOF_SCHEMA = 'stephanos.sovereign-commander-ui-runtime-proof.v1';
export const SOVEREIGN_COMMANDER_UI_RUNTIME_PROOF_PROFILE = 'vr-atlas-status-pills';
export const SOVEREIGN_COMMANDER_UI_RUNTIME_PROOF_MARKER = 'SOVEREIGN_COMMANDER_UI_RUNTIME_PROOF_RESULT=';

const SHA40 = /^[0-9a-f]{40}$/i;
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_PROOF_ROOT = resolve(REPO_ROOT, '.stephanos', 'local-state-checkpoints', 'sovereign-ui-proof');
const UI_HEALTH_URL = 'http://127.0.0.1:4173/__stephanos/health';
const ATLAS_APP_ROOT = '/apps/vr-capability-atlas/';

function text(value) {
  return String(value ?? '').trim();
}

function safeStamp(value = new Date()) {
  return value.toISOString().replace(/[:.]/g, '-');
}

function gitExecutable(platform = process.platform) {
  return platform === 'win32' ? 'git.exe' : 'git';
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
    stderr: String(result?.stderr || ''),
    status: Number.isInteger(result?.status) ? result.status : null,
    errorCode: text(result?.error?.code || result?.error?.message),
  });
}

export function evaluateVrAtlasStatusPillsObservation(observation = {}) {
  const rows = Array.isArray(observation?.pills) ? observation.pills : [];
  const blockers = [];
  if (observation?.pageTitleMatches !== true) blockers.push('VR_ATLAS_PAGE_TITLE_MISMATCH');
  if (rows.length < 4) blockers.push('VR_ATLAS_STATUS_PILLS_INCOMPLETE');
  if (observation?.methodsGridVisible !== true) blockers.push('VR_ATLAS_METHODS_GRID_NOT_VISIBLE');
  for (const row of rows) {
    const label = text(row?.label) || 'unknown';
    if (row?.compact !== true) blockers.push(`VR_ATLAS_STATUS_PILL_NOT_COMPACT:${label}`);
    if (row?.centered !== true) blockers.push(`VR_ATLAS_STATUS_PILL_NOT_CENTERED:${label}`);
    if (row?.textCentered !== true) blockers.push(`VR_ATLAS_STATUS_PILL_TEXT_NOT_CENTERED:${label}`);
    if (row?.wrapContract !== true) blockers.push(`VR_ATLAS_STATUS_PILL_WRAP_CONTRACT_MISSING:${label}`);
    if (row?.overflowFree !== true) blockers.push(`VR_ATLAS_STATUS_PILL_OVERFLOW:${label}`);
  }
  return Object.freeze({
    accepted: blockers.length === 0,
    blockers: Object.freeze([...new Set(blockers)]),
    pillCount: rows.length,
  });
}

async function readAtlasEntry(repoRoot = REPO_ROOT) {
  const manifest = JSON.parse(await readFile(resolve(repoRoot, 'apps', 'vr-capability-atlas', 'app.json'), 'utf8'));
  const entry = text(manifest?.entry);
  if (!/^[A-Za-z0-9._-]+\.html$/.test(entry)) throw new Error('VR_ATLAS_ENTRY_INVALID');
  return entry;
}

function healthHeadMatches(health = {}, expectedHead = '') {
  const expected = text(expectedHead).toLowerCase();
  if (!SHA40.test(expected)) return false;
  const direct = text(health?.gitCommit || health?.commit).toLowerCase();
  if (direct === expected) return true;
  const marker = text(health?.runtimeMarker || health?.marker).toLowerCase();
  const tokens = marker.match(/[0-9a-f]{7,40}/g) || [];
  return tokens.some((token) => token === expected || (token.length >= 7 && expected.startsWith(token)));
}

export async function collectVrAtlasStatusPillProof({
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
    return Object.freeze({ ok: false, blocker: 'VR_ATLAS_PROOF_CANONICAL_MAIN_REQUIRED', sourceHead: SHA40.test(sourceHead) ? sourceHead : '', exactHeadProofOk: false });
  }
  if (!headRead.ok || !SHA40.test(sourceHead)) {
    return Object.freeze({ ok: false, blocker: 'VR_ATLAS_PROOF_SOURCE_HEAD_UNAVAILABLE', sourceHead: '', exactHeadProofOk: false });
  }

  let health = null;
  try {
    const response = await fetchFn(UI_HEALTH_URL, { method: 'GET', cache: 'no-store' });
    if (response?.ok) health = await response.json();
  } catch {}
  if (!health || !healthHeadMatches(health, sourceHead)) {
    return Object.freeze({ ok: false, blocker: 'VR_ATLAS_PROOF_4173_EXACT_HEAD_REQUIRED', sourceHead, exactHeadProofOk: false });
  }

  const entry = await readAtlasEntry(repoRoot);
  const url = `http://127.0.0.1:4173${ATLAS_APP_ROOT}${entry}`;
  const pw = await loadPlaywrightFn();
  if (!pw?.chromium) {
    return Object.freeze({ ok: false, blocker: 'VR_ATLAS_PROOF_BROWSER_AUTOMATION_UNAVAILABLE', sourceHead, exactHeadProofOk: true, url });
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

    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15_000 });
    if (!response || !response.ok() || page.url() !== url) throw new Error('VR_ATLAS_PROOF_RUNTIME_URL_MISMATCH');
    await page.waitForSelector('#methodsGrid .method > .status', { state: 'visible', timeout: 15_000 });
    await page.waitForTimeout(500);

    const observation = await page.evaluate(() => {
      const methodsGrid = document.querySelector('#methodsGrid');
      const pills = [...document.querySelectorAll('#methodsGrid .method > .status')].map((status) => {
        const card = status.closest('.method');
        const style = getComputedStyle(status);
        const rect = status.getBoundingClientRect();
        const cardRect = card?.getBoundingClientRect?.() || { top: 0, height: 0 };
        const mid = rect.top + rect.height / 2;
        const cardMid = cardRect.top + cardRect.height / 2;
        const centerTolerance = Math.max(5, cardRect.height * 0.17);
        return {
          label: String(status.textContent || '').trim(),
          width: Number(rect.width.toFixed(2)),
          height: Number(rect.height.toFixed(2)),
          cardHeight: Number(cardRect.height.toFixed(2)),
          compact: rect.height <= 48 && rect.width <= 140 && (!cardRect.height || rect.height < cardRect.height * 0.72),
          centered: Math.abs(mid - cardMid) <= centerTolerance,
          textCentered: style.textAlign === 'center',
          wrapContract: style.whiteSpace === 'normal' && style.overflowWrap === 'anywhere',
          overflowFree: status.scrollWidth <= status.clientWidth + 1 && status.scrollHeight <= status.clientHeight + 1,
          alignSelf: style.alignSelf,
          justifySelf: style.justifySelf,
        };
      });
      return {
        pageTitleMatches: /VR Capability Atlas/i.test(document.title),
        methodsGridVisible: !!methodsGrid && getComputedStyle(methodsGrid).display !== 'none',
        pills,
      };
    });

    const evaluation = evaluateVrAtlasStatusPillsObservation(observation);
    if (consoleErrors.length) evaluation.blockers.push?.('VR_ATLAS_CONSOLE_ERRORS');
    if (pageErrors.length) evaluation.blockers.push?.('VR_ATLAS_PAGE_ERRORS');
    const runtimeBlockers = [
      ...evaluation.blockers,
      ...(consoleErrors.length ? ['VR_ATLAS_CONSOLE_ERRORS'] : []),
      ...(pageErrors.length ? ['VR_ATLAS_PAGE_ERRORS'] : []),
    ];
    const accepted = runtimeBlockers.length === 0;

    await mkdir(proofRoot, { recursive: true });
    const stamp = safeStamp(now());
    const screenshotPath = resolve(proofRoot, `${sourceHead}-vr-atlas-status-pills-${stamp}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: true });

    const receipt = {
      schemaVersion: SOVEREIGN_COMMANDER_UI_RUNTIME_PROOF_SCHEMA,
      profile: SOVEREIGN_COMMANDER_UI_RUNTIME_PROOF_PROFILE,
      ok: accepted,
      sourceHead,
      exactHeadProofOk: true,
      url,
      generatedAtUtc: now().toISOString(),
      browserMechanism: 'shared-browser-proof-runner-playwright-edge',
      screenshotPath: relative(repoRoot, screenshotPath).replaceAll('\\', '/'),
      pillCount: evaluation.pillCount,
      blockers: runtimeBlockers,
      consoleErrorCount: consoleErrors.length,
      pageErrorCount: pageErrors.length,
      observation,
    };
    receipt.evidenceHash = createHash('sha256').update(JSON.stringify(receipt)).digest('hex');
    const receiptPath = resolve(proofRoot, `${sourceHead}-vr-atlas-status-pills-${stamp}.json`);
    await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');

    return Object.freeze({
      ...receipt,
      receiptPath: relative(repoRoot, receiptPath).replaceAll('\\', '/'),
      finalVerdict: accepted ? 'VR_ATLAS_RUNTIME_PROOF_PASS' : 'VR_ATLAS_RUNTIME_PROOF_BLOCKED',
    });
  } catch (error) {
    return Object.freeze({
      ok: false,
      blocker: text(error?.code || error?.message || 'VR_ATLAS_RUNTIME_PROOF_FAILED'),
      sourceHead,
      exactHeadProofOk: true,
      url,
      consoleErrorCount: consoleErrors.length,
      pageErrorCount: pageErrors.length,
      finalVerdict: 'VR_ATLAS_RUNTIME_PROOF_BLOCKED',
    });
  } finally {
    await browser?.close?.();
  }
}

export function parseUiRuntimeProofArgs(argv = process.argv.slice(2)) {
  let profile = SOVEREIGN_COMMANDER_UI_RUNTIME_PROOF_PROFILE;
  for (let index = 0; index < argv.length; index += 1) {
    const token = text(argv[index]);
    if (token === '--profile') {
      profile = text(argv[index + 1]);
      index += 1;
    } else {
      throw new Error('SOVEREIGN_COMMANDER_UI_RUNTIME_PROOF_ARGUMENT_NOT_ALLOWED');
    }
  }
  if (profile !== SOVEREIGN_COMMANDER_UI_RUNTIME_PROOF_PROFILE) {
    throw new Error('SOVEREIGN_COMMANDER_UI_RUNTIME_PROOF_PROFILE_NOT_ALLOWED');
  }
  return Object.freeze({ profile });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    parseUiRuntimeProofArgs();
    const result = await collectVrAtlasStatusPillProof();
    process.stdout.write(`${SOVEREIGN_COMMANDER_UI_RUNTIME_PROOF_MARKER}${JSON.stringify(result)}\n`);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    process.exitCode = result.ok ? 0 : 2;
  } catch (error) {
    const result = {
      ok: false,
      blocker: text(error?.message || error || 'SOVEREIGN_COMMANDER_UI_RUNTIME_PROOF_FAILED'),
      exactHeadProofOk: false,
      finalVerdict: 'VR_ATLAS_RUNTIME_PROOF_BLOCKED',
    };
    process.stdout.write(`${SOVEREIGN_COMMANDER_UI_RUNTIME_PROOF_MARKER}${JSON.stringify(result)}\n`);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    process.exitCode = 2;
  }
}
