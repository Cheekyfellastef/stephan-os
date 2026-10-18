#!/usr/bin/env node
// Fixed-profile, read-only Battle Bridge browser proof. The only local writes are evidence files.
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import { collectServedDistFingerprint, launchProofBrowser, loadPlaywright } from './browser-proof-runner.mjs';
import {
  computeStephanosSourceFingerprint,
  createStephanosDistManifest,
  extractEmbeddedHtmlMetadata,
} from './stephanos-build-utils.mjs';

export const SKILL_FORGE_RUNTIME_PROOF_SCHEMA = 'stephanos.sovereign-skill-forge-runtime-proof.v1';
export const SKILL_FORGE_RUNTIME_PROOF_MARKER = 'SOVEREIGN_COMMANDER_SKILL_FORGE_RUNTIME_PROOF_RESULT=';
export const SKILL_FORGE_RUNTIME_PROOF_PROFILE = 'skill-forge-and-command-observatory';
const SHA40 = /^[a-f0-9]{40}$/i;
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const EVIDENCE_ROOT = resolve(ROOT, '.stephanos/local-state-checkpoints/sovereign-ui-proof');
const HOST = 'http://127.0.0.1:4173';
const BACKEND = 'http://127.0.0.1:8787/api/shared-workspace/dashboard-feed?scope=full-history';
const URLS = Object.freeze({
  forge: HOST + '/apps/stephanos/dist/index.html?surface=skill-forge',
  command: HOST + '/apps/stephanos/dist/index.html',
});
const sha = v => String(v ?? '').trim().toLowerCase();
const safeName = stamp => stamp.toISOString().replace(/[:.]/g, '-');
const sha256 = value => createHash('sha256').update(value).digest('hex');
function git(args, { root = ROOT, spawn = spawnSync, platform = process.platform } = {}) {
  const result = spawn(platform === 'win32' ? 'C:\\Program Files\\Git\\cmd\\git.exe' : 'git', args,
    { cwd: root, encoding: 'utf8', windowsHide: true, shell: false, timeout: 15000, maxBuffer: 65536 });
  return result?.status === 0 && !result.error ? sha(result.stdout) : '';
}
function healthHeadMatches(health, head) {
  if (!SHA40.test(head)) return false;
  const published = sha(health?.gitCommit || health?.commit);
  if (published === head || (published.length >= 7 && head.startsWith(published))) return true;
  const marker = sha(health?.runtimeMarker || health?.marker);
  return (marker.match(/[a-f0-9]{7,40}/g) || []).some(token => token === head || head.startsWith(token));
}
async function fixedJson(fetchFn, url, timeoutMs = 10000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchFn(url, { method:'GET', cache:'no-store',
      headers:{ accept:'application/json', 'cache-control':'no-cache' }, signal:controller.signal });
    return { httpStatus: Number(response?.status || 0), json: response?.ok ? await response.json() : null };
  } finally { clearTimeout(timeout); }
}
export function evaluateSkillForgeBrowserObservation(value = {}) {
  const blockers = [];
  if (value.exactHeadProofOk !== true) blockers.push('SKILL_FORGE_EXACT_HEAD_NOT_PROVEN');
  if (!SHA40.test(String(value.servedBuildHead || '')) || value.servedBuildHead !== value.sourceHead) blockers.push('SKILL_FORGE_BUILD_HEAD_MISMATCH');
  if (!/^[a-f0-9]{64}$/i.test(String(value.expectedAssetFingerprint || ''))
    || value.servedAssetFingerprint !== value.expectedAssetFingerprint) blockers.push('SKILL_FORGE_SERVED_ASSET_MISMATCH');
  if (!/^[a-f0-9]{64}$/i.test(String(value.currentSourceFingerprint || ''))
    || value.servedSourceFingerprint !== value.currentSourceFingerprint) blockers.push('SKILL_FORGE_SOURCE_FINGERPRINT_MISMATCH');
  if (value.forgeHttpStatus !== 200) blockers.push('SKILL_FORGE_ROUTE_HTTP_FAILED');
  if (value.commandHttpStatus !== 200) blockers.push('STEPHANOS_COMMAND_ROUTE_HTTP_FAILED');
  if (value.forgeUrl !== URLS.forge) blockers.push('SKILL_FORGE_CANONICAL_URL_MISMATCH');
  if (value.commandUrl !== URLS.command) blockers.push('STEPHANOS_COMMAND_CANONICAL_URL_MISMATCH');
  if (value.forgeTitleVisible !== true) blockers.push('SKILL_FORGE_TITLE_NOT_VISIBLE');
  if (value.forgeConstructionLineVisible !== true) blockers.push('SKILL_FORGE_CONSTRUCTION_LINE_NOT_VISIBLE');
  if (value.forgeLearningViewVisible !== true) blockers.push('SKILL_FORGE_LEARNING_VIEW_NOT_VISIBLE');
  if (value.forgeTransferGateVisible !== true) blockers.push('SKILL_FORGE_TRANSFER_GATE_NOT_VISIBLE');
  if (value.commandObservatoryVisible !== true) blockers.push('STEPHANOS_COMMAND_OBSERVATORY_NOT_VISIBLE');
  if (value.commandNavigationVisible !== true) blockers.push('STEPHANOS_COMMAND_NAVIGATION_NOT_VISIBLE');
  if (value.forgeFeedTruth !== 'REPORTED') blockers.push('SKILL_FORGE_HYDRATION_NOT_READY');
  if (value.backendState !== 'ready') blockers.push('SKILL_FORGE_BACKEND_FEED_NOT_READY');
  if (value.backendHttpStatus !== 200) blockers.push('SKILL_FORGE_BACKEND_HTTP_FAILED');
  if (value.consoleErrorCount !== 0) blockers.push('SKILL_FORGE_BROWSER_CONSOLE_ERRORS');
  if (value.pageErrorCount !== 0) blockers.push('SKILL_FORGE_BROWSER_PAGE_ERRORS');
  return Object.freeze({ accepted: blockers.length === 0, blockers: Object.freeze(blockers) });
}
export async function collectSkillForgeRuntimeProof({
  repoRoot = ROOT, proofRoot = EVIDENCE_ROOT, fetchFn = globalThis.fetch,
  spawnSyncFn = spawnSync, platform = process.platform, now = () => new Date(),
  loadPlaywrightFn = loadPlaywright, launchBrowserFn = launchProofBrowser,
} = {}) {
  const sourceHead = git(['rev-parse','HEAD'], {root:repoRoot, spawn:spawnSyncFn,platform});
  const currentBranch = git(['branch','--show-current'],{root:repoRoot,spawn:spawnSyncFn,platform});
  const remoteHead = git(['rev-parse','refs/remotes/origin/main'],{root:repoRoot,spawn:spawnSyncFn,platform});
  const initial = { schemaVersion:SKILL_FORGE_RUNTIME_PROOF_SCHEMA,
    profile:SKILL_FORGE_RUNTIME_PROOF_PROFILE, sourceHead:SHA40.test(sourceHead)?sourceHead:'',
    exactHeadProofOk:false, ok:false, finalVerdict:'SKILL_FORGE_RUNTIME_PROOF_BLOCKED' };
  if (currentBranch !== 'main' || !SHA40.test(sourceHead)) {
    return Object.freeze({...initial,blocker:'SKILL_FORGE_CANONICAL_MAIN_REQUIRED'});
  }
  if (remoteHead !== sourceHead) return Object.freeze({...initial,blocker:'SKILL_FORGE_REMOTE_MAIN_DRIFT'});
  let health, backend;
  try {
    health = (await fixedJson(fetchFn,HOST+'/__stephanos/health')).json;
    backend = await fixedJson(fetchFn,BACKEND);
  } catch {
    return Object.freeze({...initial,blocker:'SKILL_FORGE_RUNTIME_FEED_UNREACHABLE'});
  }
  if (!healthHeadMatches(health,sourceHead)) {
    return Object.freeze({...initial,blocker:'SKILL_FORGE_SERVED_HEAD_MISMATCH'});
  }
  // Independently bind the canonical local build to the current source tree,
  // then compare exact served bytes to that local build, not merely to any SHA.
  // Neither fetched/served metadata nor a claimant-supplied digest is authority.
  let localBuild, embeddedBuild, currentSourceFingerprint, expectedAssets;
  try {
    currentSourceFingerprint = computeStephanosSourceFingerprint({ rootDir: repoRoot });
    localBuild = JSON.parse(await readFile(resolve(repoRoot, 'apps/stephanos/dist/stephanos-build.json'), 'utf8'));
    embeddedBuild = extractEmbeddedHtmlMetadata(
      await readFile(resolve(repoRoot, 'apps/stephanos/dist/index.html'), 'utf8'),
    );
    expectedAssets = createStephanosDistManifest({ rootDir: repoRoot });
  } catch {
    return Object.freeze({...initial,blocker:'SKILL_FORGE_CANONICAL_BUILD_UNVERIFIED'});
  }
  if (!/^[a-f0-9]{64}$/i.test(currentSourceFingerprint)
    || sha(localBuild?.gitCommit) !== sourceHead
    || sha(localBuild?.sourceFingerprint) !== currentSourceFingerprint
    || sha(embeddedBuild?.gitCommit) !== sourceHead
    || sha(embeddedBuild?.sourceFingerprint) !== currentSourceFingerprint) {
    return Object.freeze({...initial,blocker:'SKILL_FORGE_CANONICAL_SOURCE_DRIFT'});
  }
  let servedBuild, servedAssets;
  try {
    servedBuild = await fixedJson(fetchFn, HOST+'/apps/stephanos/dist/stephanos-build.json');
    servedAssets = await collectServedDistFingerprint(URLS.command, {
      fetchFn, expectedEntries: expectedAssets.entries,
    });
  } catch {
    return Object.freeze({...initial,blocker:'SKILL_FORGE_SERVED_ASSET_PROOF_UNAVAILABLE'});
  }
  if (servedBuild?.httpStatus !== 200
    || sha(servedBuild?.json?.gitCommit) !== sourceHead
    || sha(servedBuild?.json?.sourceFingerprint) !== currentSourceFingerprint) {
    return Object.freeze({...initial,blocker:'SKILL_FORGE_BUILD_HEAD_MISMATCH'});
  }
  if (servedAssets?.ok !== true
    || servedAssets.fingerprint !== expectedAssets.fingerprint
    || servedAssets.fileCount !== expectedAssets.fileCount) {
    return Object.freeze({...initial,blocker:'SKILL_FORGE_SERVED_ASSET_MISMATCH'});
  }
  const playwright = await loadPlaywrightFn();
  if (!playwright?.chromium) return Object.freeze({...initial,exactHeadProofOk:true,blocker:'SKILL_FORGE_PLAYWRIGHT_UNAVAILABLE'});
  let browser;
  const consoleErrors = [], pageErrors = [];
  try {
    browser = await launchBrowserFn(playwright, {platform,headless:true});
    const context = await browser.newContext({serviceWorkers:'block'});
    const views = {};
    for (const [key,url] of Object.entries(URLS)) {
      const page = await context.newPage();
      page.on('console',m => {if (m.type()==='error') consoleErrors.push(key);});
      page.on('pageerror', () => pageErrors.push(key));
      const response = await page.goto(url,{waitUntil:'domcontentloaded',timeout:15000});
      const selector = key==='forge' ? '[data-testid="skill-forge-observatory"]' : '[data-testid="stephanos-command-observatory"]';
      await page.waitForSelector(selector,{state:'visible',timeout:15000});
      if (key==='forge') {
        // Initial UNAVAILABLE is a React placeholder, not a settled observation.
        // Only the actual received + reported hydrated UI can pass this profile.
        await page.waitForFunction(() => {
          const source = document.querySelector('[data-testid="skill-forge-observatory"] .skill-source-pill strong');
          const refresh = document.querySelector('[data-testid="skill-forge-observatory"] .skill-source-pill span');
          return String(source?.textContent || '').trim() === 'REPORTED'
            && String(refresh?.textContent || '').trim() === 'RECEIVED';
        },null,{timeout:15000});
      }
      const observation = await page.evaluate(() => {
        const visible = el => Boolean(el && getComputedStyle(el).display!=='none'
          && getComputedStyle(el).visibility!=='hidden' && el.getBoundingClientRect().width>0
          && el.getBoundingClientRect().height>0);
        const forge = document.querySelector('[data-testid="skill-forge-observatory"]');
        const command = document.querySelector('[data-testid="stephanos-command-observatory"]');
        return {
          forgeTitleVisible:visible(forge?.querySelector('h2')) && forge.querySelector('h2').textContent.includes('Capability Genesis Observatory'),
          forgeConstructionLineVisible:visible(forge?.querySelector('.skill-process')),
          forgeLearningViewVisible:visible(forge?.querySelector('.skill-timeline')),
          forgeTransferGateVisible:visible(forge?.querySelector('.skill-transfer-checks')),
          forgeFeedTruth:String(forge?.querySelector('.skill-source-pill strong')?.textContent||'').trim(),
          commandObservatoryVisible:visible(command),
          commandNavigationVisible:visible(command?.querySelector('.stephanos-ops-links')),
        };
      });
      views[key] = { ...observation, httpStatus:response?.status()||0, url:page.url() };
      await mkdir(proofRoot,{recursive:true});
      const stamp=safeName(now());
      const filename=sourceHead+'-skill-forge-'+key+'-'+stamp+'.png';
      const screenshot=resolve(proofRoot,filename);
      await page.screenshot({path:screenshot,fullPage:true});
      views[key].screenshotPath=relative(repoRoot,screenshot).replaceAll('\\','/');
      views[key].screenshotSha256=sha256(await readFile(screenshot));
      await page.close();
    }
    const observation={
      exactHeadProofOk:true,
      sourceHead,
      servedBuildHead:sha(servedBuild.json.gitCommit),
      servedAssetFingerprint:servedAssets.fingerprint,
      expectedAssetFingerprint:expectedAssets.fingerprint,
      currentSourceFingerprint,
      servedSourceFingerprint:sha(servedBuild.json.sourceFingerprint),
      forgeHttpStatus:views.forge.httpStatus,
      commandHttpStatus:views.command.httpStatus,
      forgeUrl:views.forge.url,
      commandUrl:views.command.url,
      forgeTitleVisible:views.forge.forgeTitleVisible,
      forgeConstructionLineVisible:views.forge.forgeConstructionLineVisible,
      forgeLearningViewVisible:views.forge.forgeLearningViewVisible,
      forgeTransferGateVisible:views.forge.forgeTransferGateVisible,
      forgeFeedTruth:views.forge.forgeFeedTruth,
      commandObservatoryVisible:views.command.commandObservatoryVisible,
      commandNavigationVisible:views.command.commandNavigationVisible,
      backendState:String(backend?.json?.state||'').toLowerCase(),
      backendHttpStatus:backend?.httpStatus||0,
      consoleErrorCount:consoleErrors.length,pageErrorCount:pageErrors.length,
    };
    const evaluation=evaluateSkillForgeBrowserObservation(observation);
    const receipt={
      ...initial,ok:evaluation.accepted,exactHeadProofOk:true,
      finalVerdict:evaluation.accepted?'SKILL_FORGE_RUNTIME_PROOF_PASS':'SKILL_FORGE_RUNTIME_PROOF_BLOCKED',
      generatedAtUtc:now().toISOString(),relatedPr:3046,featureMergeHead:'24924f35a0fd7ded7ed6ab8c71af4298df1d884c',
      sourceHead,remoteHead,servedBuildHead:sha(servedBuild.json.gitCommit),
      servedAssetFingerprint:servedAssets.fingerprint,
      expectedAssetFingerprint:expectedAssets.fingerprint,
      currentSourceFingerprint,
      servedSourceFingerprint:sha(servedBuild.json.sourceFingerprint),
      servedAssetCount:servedAssets.fileCount,
      browserMechanism:'shared-browser-proof-runner-playwright-edge',
      screenshotSha256:sha256(views.forge.screenshotSha256+':'+views.command.screenshotSha256),
      screenshotCaptured:true,views,observation,blockers:evaluation.blockers,
      ...observation,
    };
    receipt.evidenceHash=sha256(JSON.stringify(receipt));
    const receiptFile=resolve(proofRoot,sourceHead+'-skill-forge-'+safeName(now())+'.json');
    await writeFile(receiptFile,JSON.stringify(receipt,null,2)+'\n','utf8');
    return Object.freeze({...receipt,receiptPath:relative(repoRoot,receiptFile).replaceAll('\\','/')});
  } catch(error) {
    const reason=String(error?.message||error||'').slice(0,130);
    return Object.freeze({...initial,exactHeadProofOk:true,blocker:'SKILL_FORGE_BROWSER_PROOF_FAILED',
      browserErrorClass:/Timeout/i.test(reason)?'TIMEOUT':'BROWSER_ERROR',
      consoleErrorCount:consoleErrors.length,pageErrorCount:pageErrors.length});
  } finally { await browser?.close?.(); }
}
if (process.argv[1]===fileURLToPath(import.meta.url)) {
  const result=await collectSkillForgeRuntimeProof();
  process.stdout.write(SKILL_FORGE_RUNTIME_PROOF_MARKER+JSON.stringify(result)+'\n');
  process.exitCode=result.ok?0:2;
}
