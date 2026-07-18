#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { buildPrEstateLedger, renderPrEstateReport, validatePrEstateLedger } from '../shared/agents/prEstateReconciler.mjs';

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
  const pullRequests = ghJson(['pr', 'list', '--repo', repository, '--state', 'open', '--limit', '1000', '--json', 'number,title,body,url,isDraft,headRefName,headRefOid,baseRefName,createdAt,updatedAt,mergeable,labels']);
  if (!includeCompare) return pullRequests;
  return pullRequests.map((pr) => {
    const base = encodeURIComponent(pr.baseRefName || 'main');
    const head = encodeURIComponent(pr.headRefName);
    try {
      const comparison = ghJson(['api', `repos/${repository}/compare/${base}...${head}`]);
      return {
        ...pr,
        aheadBy: comparison.ahead_by,
        behindBy: comparison.behind_by,
        headContainedInBase: Number(comparison.ahead_by) === 0,
        changedFiles: Array.isArray(comparison.files) ? comparison.files.map((file) => file.filename) : [],
      };
    } catch (error) {
      return { ...pr, compareError: String(error?.message || error) };
    }
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
  const familyDocument = readJson(familiesPath);
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
