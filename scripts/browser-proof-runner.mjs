import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_URL = process.env.STEPHANOS_BROWSER_PROOF_URL || 'http://127.0.0.1:4173/apps/stephanos/dist/index.html';
const OUT_DIR = resolve(process.cwd(), 'tmp/browser-proof');

function stamp() { return new Date().toISOString(); }
function ok(v) { return v === true || v === 'yes' || v === 0; }
function line(label, value) { return `${label}: ${value == null || value === '' ? 'unavailable' : value}`; }
function sanitizeAutomationUnavailable(message = '') {
  const text = String(message || 'browser automation unavailable');
  if (/Executable doesn't exist|Please run the following command to download new browsers|playwright install/i.test(text)) {
    return 'Playwright browser executable unavailable; use installed Microsoft Edge/system browser on the operator desktop instead of downloading browser binaries in Codex.';
  }
  return text.split('\n').slice(0, 3).join(' | ');
}

export function expectedNextProofFromProjection(projection = {}) {
  return projection?.operatorProofConcierge?.nextProof || projection?.nextProofToCollect || 'none';
}

export function shouldGenerateBrowserProofPacket(projection = {}) {
  return expectedNextProofFromProjection(projection) === 'browser-proof-checklist';
}

export function evaluateBrowserProofResult(result = {}) {
  const checks = result.checks || {};
  const blocking = [];
  if (!ok(checks.runtimeReachable)) blocking.push('4173 runtime unreachable');
  if (!ok(checks.footerGitCommitPresent)) blocking.push('footer UI Git Commit missing');
  if (!ok(checks.uiBuildTimestampPresent)) blocking.push('UI Build Timestamp missing');
  if (!ok(checks.proofConciergeDomNextProofMatches)) blocking.push('Proof Concierge DOM next proof is not browser-proof-checklist');
  if (!ok(checks.proofConciergePrimaryButtonPresent)) blocking.push('Proof Concierge primary button missing');
  if (!ok(checks.proofConciergeVisibleDriftClear)) blocking.push('Proof Concierge visible drift detected');
  if (!ok(checks.cloneParityClear)) blocking.push('clone parity is not clear');
  if (!ok(checks.operatorDiagnosticCopyPresent)) blocking.push('operator-facing diagnostic copy missing');
  if (Number(checks.consoleErrorCount || 0) > 0) blocking.push(`console error count ${checks.consoleErrorCount}`);
  if (result.automationUnavailable) blocking.push(`automation unavailable: ${result.automationUnavailable}`);
  const observed = result.browserAutomationAvailable === true && !result.automationUnavailable && checks.runtimeReachable === true;
  return { accepted: observed, observed, mergeReady: observed && blocking.length === 0, blocking };
}

function listSection(title, items = []) {
  return items.length ? [title, ...items.map((item) => `- ${item}`)] : [title, '- none'];
}

function consoleErrorSummary(errors = []) {
  return errors.slice(0, 5).map((item) => String(item || '').split('\n')[0].slice(0, 220)).filter(Boolean);
}

export function buildBrowserProofPacket(result = {}) {
  const verdict = evaluateBrowserProofResult(result);
  const repair = result.automationUnavailable || !result.browserAutomationAvailable;
  const header = repair ? 'Browser Proof Repair Packet V1' : 'Browser Proof Checklist V1';
  const status = repair ? 'repair-required' : (verdict.observed ? 'observed' : 'repair-required');
  const checks = result.checks || {};
  return [
    header,
    '',
    line('Packet Kind', 'browser-proof-checklist'),
    line('Proof Item', 'browser-proof-checklist'),
    line('Status', status),
    line('Runtime URL', result.url || DEFAULT_URL),
    line('Generated At', result.generatedAt || stamp()),
    line('Local browser mechanism', result.localBrowserMechanism || 'Microsoft Edge/system browser via Playwright when available; no browser binary download'),
    line('Screenshot evidence', result.screenshotPath || 'not captured'),
    '',
    'Required checks:',
    line('- 4173 runtime reachable', checks.runtimeReachable ? 'yes' : 'no'),
    line('- Footer UI Git Commit', checks.footerGitCommit || (checks.footerGitCommitPresent ? 'present' : 'missing')),
    line('- UI Build Timestamp', checks.uiBuildTimestamp || (checks.uiBuildTimestampPresent ? 'present' : 'missing')),
    line('- Source fingerprint / runtime marker', checks.sourceFingerprint || checks.runtimeMarker || 'unavailable'),
    line('- Proof Concierge DOM next proof', checks.proofConciergeDomNextProof || 'unavailable'),
    line('- Proof Concierge DOM primary button text', checks.proofConciergePrimaryButtonText || 'unavailable'),
    line('- Proof Concierge visible drift', checks.proofConciergeVisibleDrift || 'unavailable'),
    line('- Clone parity', checks.cloneParity || 'unavailable'),
    line('- Operator-facing diagnostic copy presence', checks.operatorDiagnosticCopyPresent ? 'yes' : 'no'),
    line('- Console error count', checks.consoleErrorCount ?? 'unavailable'),
    '',
    ...listSection('Observed caveats:', verdict.blocking),
    ...listSection('Merge blockers:', verdict.mergeReady ? [] : verdict.blocking),
    ...(Number(checks.consoleErrorCount || 0) > 0 ? ['Console error summary:', ...consoleErrorSummary(result.consoleErrors || checks.consoleErrors || []).map((item) => `- ${item}`)] : []),
    'Safety locks: mutation no; Codex auto-dispatch no; OpenClaw locked; merge readiness no / hold; no paid APIs; no automatic browsing beyond local Stephanos runtime URL.',
    repair ? 'Repair action: install/enable Playwright with a system Microsoft Edge channel, or run this packet again from the operator Windows desktop where Edge and the 4173 runtime are available.' : 'Next action: paste this packet into Command Deck as browser-proof-checklist evidence.',
  ].join('\n');
}

async function loadPlaywright() {
  try { return await import('playwright'); } catch {}
  try { return await import('@playwright/test'); } catch {}
  return null;
}

async function collectWithBrowser(url = DEFAULT_URL) {
  const pw = await loadPlaywright();
  if (!pw?.chromium) return { browserAutomationAvailable: false, automationUnavailable: 'Playwright chromium API unavailable', url, generatedAt: stamp(), checks: { runtimeReachable: false } };
  const errors = [];
  let browser;
  try {
    browser = await pw.chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : undefined, headless: true });
    const page = await browser.newPage();
    page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForTimeout(750);
    const checks = await page.evaluate(() => {
      const text = (v) => String(v || '').trim();
      const body = document.body?.innerText || '';
      const footer = document.querySelector('footer.runtime-diagnostic')?.innerText || '';
      const card = document.querySelector('[data-testid="operator-proof-concierge"], [data-proof-concierge-instance="yes"]');
      const next = card?.querySelector('[data-testid="operator-proof-concierge-next-proof"], [data-proof-concierge-field="next-proof"] strong')?.textContent || card?.getAttribute('data-proof-concierge-next-proof-rendered') || '';
      const btn = card?.querySelector('[data-testid="operator-proof-concierge-primary-copy"], [data-concierge-button-role="primary-proof-copy"]');
      const drift = card?.getAttribute('data-proof-concierge-render-input-proof-state-contradiction-detected') === 'yes' || card?.getAttribute('data-proof-concierge-initial-render-next-proof') !== card?.getAttribute('data-proof-concierge-post-hydration-current-dom-next-proof');
      return {
        runtimeReachable: true,
        footerGitCommitPresent: /git commit|commit/i.test(footer),
        footerGitCommit: (footer.match(/(?:git commit|commit)[:\s]+([^\n]+)/i) || [])[1] || '',
        uiBuildTimestampPresent: /build/i.test(footer) && /\d{4}-\d{2}-\d{2}|timestamp/i.test(footer + body),
        uiBuildTimestamp: (footer.match(/build[:\s]+([^\n]+)/i) || [])[1] || '',
        sourceFingerprint: (footer.match(/fingerprint[:\s]+([^\n]+)/i) || [])[1] || '',
        runtimeMarker: (footer.match(/marker[:\s]+([^\n]+)/i) || [])[1] || '',
        proofConciergeDomNextProof: text(next),
        proofConciergeDomNextProofMatches: text(next) === 'browser-proof-checklist',
        proofConciergePrimaryButtonPresent: !!btn,
        proofConciergePrimaryButtonText: text(btn?.textContent),
        proofConciergeVisibleDrift: drift ? 'detected' : 'clear',
        proofConciergeVisibleDriftClear: !drift,
        cloneParity: /clone parity|source\/dist parity/i.test(body) ? 'present' : 'unavailable',
        cloneParityClear: !/clone parity[^\n]*(fail|drift|mismatch)|source\/dist parity[^\n]*(false|fail)/i.test(body),
        operatorDiagnosticCopyPresent: /diagnostic|repair|copy/i.test(body),
      };
    });
    mkdirSync(OUT_DIR, { recursive: true });
    const screenshotPath = resolve(OUT_DIR, `browser-proof-${Date.now()}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: true });
    checks.consoleErrorCount = errors.length;
    return { browserAutomationAvailable: true, localBrowserMechanism: 'Playwright Chromium using installed Microsoft Edge channel on Windows when available; no browser download requested', url, generatedAt: stamp(), screenshotPath, consoleErrors: errors, checks };
  } catch (error) {
    return { browserAutomationAvailable: false, automationUnavailable: sanitizeAutomationUnavailable(error.message), url, generatedAt: stamp(), consoleErrors: errors, checks: { runtimeReachable: false, consoleErrorCount: errors.length } };
  } finally { if (browser) await browser.close(); }
}

function printSinglePacket(result) {
  const packet = buildBrowserProofPacket(result);
  process.stdout.write(`${packet}\n`);
  const out = resolve(OUT_DIR, 'browser-proof-checklist-packet.txt');
  try {
    mkdirSync(OUT_DIR, { recursive: true });
    writeFileSync(out, packet);
    console.error(`[stephanos:browser-proof] packet written: ${out}`);
  } catch (error) {
    console.error(`[stephanos:browser-proof] packet file write unavailable: ${sanitizeAutomationUnavailable(error?.message || error)}`);
  }
  return evaluateBrowserProofResult(result).accepted ? 0 : 1;
}

async function main() {
  try {
    const result = await collectWithBrowser(process.argv[2] || DEFAULT_URL);
    process.exit(printSinglePacket(result));
  } catch (error) {
    const result = {
      browserAutomationAvailable: false,
      automationUnavailable: sanitizeAutomationUnavailable(error?.message || error),
      url: process.argv[2] || DEFAULT_URL,
      generatedAt: stamp(),
      checks: { runtimeReachable: false },
    };
    process.exit(printSinglePacket(result));
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
const modulePath = fileURLToPath(import.meta.url);
if (invokedPath === modulePath) main();
