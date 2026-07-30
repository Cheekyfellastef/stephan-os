import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_URL = process.env.STEPHANOS_BROWSER_PROOF_URL || 'http://127.0.0.1:4173/apps/stephanos/dist/index.html';
const DEFAULT_OUT_DIR = resolve(process.cwd(), 'tmp/browser-proof');
const EXACT_GIT_HEAD = /^[0-9a-f]{40}$/;

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

function normalizeGitHead(value = '') {
  const match = String(value || '').trim().toLowerCase().match(/\b[0-9a-f]{40}\b/);
  return match?.[0] || '';
}

export function parseBrowserProofArguments(argv = []) {
  let url = DEFAULT_URL;
  let expectedHead = '';
  let positionalUrlSeen = false;
  let writeArtifacts = true;
  let machineJson = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = String(argv[index] || '');
    if (argument === '--expected-head') {
      expectedHead = String(argv[index + 1] || '').trim().toLowerCase();
      index += 1;
      if (!EXACT_GIT_HEAD.test(expectedHead)) {
        return { ok: false, url, expectedHead, blocker: 'EXPECTED_HEAD_INVALID' };
      }
    } else if (argument === '--url') {
      url = String(argv[index + 1] || '').trim();
      index += 1;
      if (!url) return { ok: false, url: DEFAULT_URL, expectedHead, blocker: 'RUNTIME_URL_INVALID' };
    } else if (argument === '--no-artifacts') {
      writeArtifacts = false;
    } else if (argument === '--machine-json') {
      machineJson = true;
    } else if (!argument.startsWith('-') && !positionalUrlSeen) {
      url = argument;
      positionalUrlSeen = true;
    } else {
      return { ok: false, url, expectedHead, blocker: 'BROWSER_PROOF_ARGUMENT_INVALID' };
    }
  }
  return { ok: true, url, expectedHead, writeArtifacts, machineJson };
}

export function evaluateBrowserProofResult(result = {}, { expectedHead = '' } = {}) {
  const checks = result.checks || {};
  const blocking = [];
  const normalizedExpectedHead = String(expectedHead || '').trim().toLowerCase();
  const runtimeSourceHead = normalizeGitHead(checks.runtimeSourceHead || checks.footerGitCommit);
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
  let expectedHeadMatch = null;
  if (normalizedExpectedHead) {
    expectedHeadMatch = EXACT_GIT_HEAD.test(normalizedExpectedHead) && runtimeSourceHead === normalizedExpectedHead;
    if (!EXACT_GIT_HEAD.test(normalizedExpectedHead)) {
      blocking.push('approved expected head is invalid');
    } else if (!runtimeSourceHead) {
      blocking.push('served runtime Git Commit is not a full 40-character SHA');
    } else if (!expectedHeadMatch) {
      blocking.push(`served runtime Git Commit ${runtimeSourceHead} does not match expected head ${normalizedExpectedHead}`);
    }
  }
  const observed = result.browserAutomationAvailable === true && !result.automationUnavailable && checks.runtimeReachable === true;
  const accepted = observed && (normalizedExpectedHead ? expectedHeadMatch === true : true);
  return {
    accepted,
    observed,
    mergeReady: observed && blocking.length === 0,
    blocking,
    expectedHead: normalizedExpectedHead,
    runtimeSourceHead,
    expectedHeadMatch,
  };
}

function listSection(title, items = []) {
  return items.length ? [title, ...items.map((item) => `- ${item}`)] : [title, '- none'];
}

function consoleErrorSummary(errors = []) {
  return errors.slice(0, 5).map((item) => String(item || '').split('\n')[0].slice(0, 220)).filter(Boolean);
}

export function buildBrowserProofPacket(result = {}, options = {}) {
  const verdict = evaluateBrowserProofResult(result, options);
  const repair = result.automationUnavailable || !result.browserAutomationAvailable;
  const header = repair ? 'Browser Proof Repair Packet V1' : 'Browser Proof Checklist V1';
  const status = repair ? 'repair-required' : (verdict.accepted ? 'observed' : 'rejected');
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
    line('- Approved expected Git head', verdict.expectedHead || 'not requested'),
    line('- Browser-observed runtime source head', verdict.runtimeSourceHead || 'unavailable'),
    line('- Browser-observed head matches approved head', verdict.expectedHeadMatch == null ? 'not requested' : (verdict.expectedHeadMatch ? 'yes' : 'no')),
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

export function buildBrowserProofMachineResult(result = {}, options = {}) {
  const verdict = evaluateBrowserProofResult(result, options);
  return Object.freeze({
    schemaVersion: 'stephanos.browser-runtime-exact-head-proof.v1',
    url: String(result.url || DEFAULT_URL),
    observedUrl: String(result.observedUrl || ''),
    accepted: verdict.accepted,
    observed: verdict.observed,
    mergeReady: verdict.mergeReady,
    expectedHead: verdict.expectedHead,
    runtimeSourceHead: verdict.runtimeSourceHead,
    expectedHeadMatch: verdict.expectedHeadMatch,
    blocking: [...verdict.blocking],
  });
}

async function loadPlaywright() {
  try { return await import('playwright'); } catch {}
  try { return await import('@playwright/test'); } catch {}
  return null;
}

async function collectWithBrowser(url = DEFAULT_URL, { writeArtifacts = true } = {}) {
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
    let screenshotPath = '';
    if (writeArtifacts) {
      mkdirSync(DEFAULT_OUT_DIR, { recursive: true });
      screenshotPath = resolve(DEFAULT_OUT_DIR, `browser-proof-${Date.now()}.png`);
      await page.screenshot({ path: screenshotPath, fullPage: true });
    }
    checks.consoleErrorCount = errors.length;
    return {
      browserAutomationAvailable: true,
      localBrowserMechanism: 'Playwright Chromium using installed Microsoft Edge channel on Windows when available; no browser download requested',
      url,
      observedUrl: page.url(),
      generatedAt: stamp(),
      screenshotPath,
      consoleErrors: errors,
      checks,
    };
  } catch (error) {
    return { browserAutomationAvailable: false, automationUnavailable: sanitizeAutomationUnavailable(error.message), url, generatedAt: stamp(), consoleErrors: errors, checks: { runtimeReachable: false, consoleErrorCount: errors.length } };
  } finally { if (browser) await browser.close(); }
}

function printSinglePacket(result, options = {}, { writeArtifacts = true } = {}) {
  const packet = buildBrowserProofPacket(result, options);
  process.stdout.write(`${packet}\n`);
  if (writeArtifacts) {
    const out = resolve(DEFAULT_OUT_DIR, 'browser-proof-checklist-packet.txt');
    try {
      mkdirSync(DEFAULT_OUT_DIR, { recursive: true });
      writeFileSync(out, packet);
      console.error(`[stephanos:browser-proof] packet written: ${out}`);
    } catch (error) {
      console.error(`[stephanos:browser-proof] packet file write unavailable: ${sanitizeAutomationUnavailable(error?.message || error)}`);
    }
  }
  return evaluateBrowserProofResult(result, options).accepted ? 0 : 1;
}

function printMachineResult(result, options = {}) {
  const machineResult = buildBrowserProofMachineResult(result, options);
  process.stdout.write(`${JSON.stringify(machineResult)}\n`);
  return machineResult.accepted ? 0 : 1;
}

async function main() {
  const parsed = parseBrowserProofArguments(process.argv.slice(2));
  if (!parsed.ok) {
    const result = {
      browserAutomationAvailable: false,
      automationUnavailable: parsed.blocker,
      url: parsed.url,
      generatedAt: stamp(),
      checks: { runtimeReachable: false },
    };
    process.exit(parsed.machineJson
      ? printMachineResult(result, { expectedHead: parsed.expectedHead })
      : printSinglePacket(result, { expectedHead: parsed.expectedHead }, { writeArtifacts: parsed.writeArtifacts }));
  }
  try {
    const result = await collectWithBrowser(parsed.url, { writeArtifacts: parsed.writeArtifacts });
    process.exit(parsed.machineJson
      ? printMachineResult(result, { expectedHead: parsed.expectedHead })
      : printSinglePacket(result, { expectedHead: parsed.expectedHead }, { writeArtifacts: parsed.writeArtifacts }));
  } catch (error) {
    const result = {
      browserAutomationAvailable: false,
      automationUnavailable: sanitizeAutomationUnavailable(error?.message || error),
      url: parsed.url,
      generatedAt: stamp(),
      checks: { runtimeReachable: false },
    };
    process.exit(parsed.machineJson
      ? printMachineResult(result, { expectedHead: parsed.expectedHead })
      : printSinglePacket(result, { expectedHead: parsed.expectedHead }, { writeArtifacts: parsed.writeArtifacts }));
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
const modulePath = fileURLToPath(import.meta.url);
if (invokedPath === modulePath) main();
