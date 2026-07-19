#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
  buildPrEstateLedger,
  renderPrEstateReport,
  requireCapturedHeadSha,
  validatePrEstateLedger,
} from '../shared/agents/prEstateReconciler.mjs';

const MAX_OPEN_PULL_REQUESTS = 1000;

function valueAfter(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : '';
}
function has(name) { return process.argv.includes(name); }
function readJson(path) { return JSON.parse(readFileSync(resolve(path), 'utf8')); }
function gh(args) { return execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 20 * 1024 * 1024 }).trim(); }
function ghJson(args) { return JSON.parse(gh(args)); }

function collectFromGh(repository, includeCompare) {
  if (!repository) throw new Error('--repository owner/name is required with --from-gh');
  const pullRequests = ghJson(['pr', 'list', '--repo', repository, '--state', 'open', '--limit', String(MAX_OPEN_PULL_REQUESTS + 1), '--json', 'number,title,body,url,isDraft,headRefName,headRefOid,baseRefName,createdAt,updatedAt,mergeable,labels'])
    .map((pr) => ({ ...pr, state: 'open' }));
  if (pullRequests.length > MAX_OPEN_PULL_REQUESTS) {
    throw new Error(`open PR estate exceeds ${MAX_OPEN_PULL_REQUESTS} records; refusing truncated collection`);
  }
  if (!includeCompare) return pullRequests;
  return pullRequests.map((pr) => {
    const base = encodeURIComponent(pr.baseRefName || 'main');
    const capturedHeadSha = requireCapturedHeadSha(pr.headRefOid, pr.number ?? 'unknown');
    const head = encodeURIComponent(capturedHeadSha);
    const comparison = ghJson(['api', `repos/${repository}/compare/${base}...${head}`]);
    return {
      ...pr,
      aheadBy: comparison.ahead_by,
      behindBy: comparison.behind_by,
      headContainedInBase: Number(comparison.ahead_by) === 0,
      comparedHeadSha: capturedHeadSha,
      changedFiles: Array.isArray(comparison.files) ? comparison.files.map((file) => file.filename) : [],
    };
  });
}

const repository = valueAfter('--repository') || process.env.GITHUB_REPOSITORY || 'unknown';
const inputPath = valueAfter('--input');
const familiesPath = valueAfter('--families') || 'config/pr-estate-families.v1.json';
const outputPath = valueAfter('--output');
const humanOutputPath = valueAfter('--human-output');
const generatedAt = valueAfter('--timestamp') || new Date().toISOString();

if (!inputPath && !has('--from-gh')) {
  console.error('Usage: node scripts/pr-estate-reconcile.mjs --input snapshot.json [--families config/pr-estate-families.v1.json]');
  console.error('   or: node scripts/pr-estate-reconcile.mjs --from-gh --repository owner/name [--compare]');
  process.exit(2);
}

try {
  const input = inputPath ? readJson(inputPath) : { pullRequests: collectFromGh(repository, has('--compare')) };
  if (!Array.isArray(input) && !Array.isArray(input?.pullRequests)) {
    throw new Error('prepared snapshot must be an array or an object with a pullRequests array');
  }
  const familyDocument = readJson(familiesPath);
  if (!Array.isArray(familyDocument) && !Array.isArray(familyDocument?.families)) {
    throw new Error('family document must be an array or an object with a families array');
  }
  const ledger = buildPrEstateLedger({
    repository,
    generatedAt,
    pullRequests: Array.isArray(input) ? input : input.pullRequests,
    families: Array.isArray(familyDocument) ? familyDocument : familyDocument.families,
  });
  const validation = validatePrEstateLedger(ledger);
  if (!validation.valid) throw new Error(`invalid generated ledger: ${validation.errors.join(', ')}`);
  const json = `${JSON.stringify(ledger, null, 2)}\n`;
  const human = renderPrEstateReport(ledger);
  if (outputPath) { mkdirSync(dirname(resolve(outputPath)), { recursive: true }); writeFileSync(resolve(outputPath), json); }
  if (humanOutputPath) { mkdirSync(dirname(resolve(humanOutputPath)), { recursive: true }); writeFileSync(resolve(humanOutputPath), human); }
  process.stdout.write(has('--human') ? human : json);
  process.exit(ledger.finalVerdict === 'PR_ESTATE_CONTROLLED' ? 0 : 1);
} catch (error) {
  console.error(`PR_ESTATE_RECONCILER_BLOCKED: ${error?.message || error}`);
  process.exit(2);
}
