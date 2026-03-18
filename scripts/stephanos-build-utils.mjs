import {
  existsSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

function resolveFsPath(...segments) {
  return path.normalize(path.resolve(...segments));
}

function readFileSyncWithDebug(filePath, options) {
  const normalizedPath = path.normalize(filePath);
  console.log(`[stephanos debug] Reading filesystem path: ${normalizedPath}`);
  return readFileSync(normalizedPath, options);
}

const buildUtilsDir = path.dirname(fileURLToPath(import.meta.url));

export const repoRoot = resolveFsPath(buildUtilsDir, '..');
export const stephanosUiRoot = resolveFsPath(repoRoot, 'stephanos-ui');
export const stephanosUiSrcRoot = resolveFsPath(stephanosUiRoot, 'src');
export const stephanosDistRoot = resolveFsPath(repoRoot, 'apps', 'stephanos', 'dist');
export const stephanosDistIndexPath = resolveFsPath(stephanosDistRoot, 'index.html');
export const stephanosDistMetadataPath = resolveFsPath(stephanosDistRoot, 'stephanos-build.json');
export const stephanosUiPackagePath = resolveFsPath(stephanosUiRoot, 'package.json');
export const stephanosUiPackage = JSON.parse(readFileSyncWithDebug(stephanosUiPackagePath, 'utf8'));

export const DIST_WARNING_BANNER = [
  '<!-- GENERATED FILE: apps/stephanos/dist/index.html -->',
  '<!-- Do not edit manually. Live Stephanos UI source lives in stephanos-ui/src/** and must be rebuilt before deploy. -->',
  '<!-- Verify generated runtime integrity with npm run stephanos:verify. -->',
].join('\n');

const FINGERPRINT_INPUTS = [
  'stephanos-ui/index.html',
  'stephanos-ui/package.json',
  'stephanos-ui/vite.config.js',
];

function walkFiles(rootDir) {
  const results = [];
  for (const entry of readdirSync(rootDir, { withFileTypes: true })) {
    const absolutePath = path.normalize(path.join(rootDir, entry.name));
    if (entry.isDirectory()) {
      results.push(...walkFiles(absolutePath));
      continue;
    }

    if (entry.isFile()) {
      results.push(absolutePath);
    }
  }
  return results;
}

export function getGitCommit() {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return 'git-unavailable';
  }
}

export function computeStephanosSourceFingerprint() {
  const hash = createHash('sha256');
  const files = [
    ...FINGERPRINT_INPUTS.map((filePath) => resolveFsPath(repoRoot, filePath)),
    ...walkFiles(stephanosUiSrcRoot),
  ].sort((left, right) => left.localeCompare(right));

  for (const absolutePath of files) {
    const relPath = path.relative(repoRoot, absolutePath).replace(/\\/g, '/');
    hash.update(`FILE:${relPath}\n`);
    hash.update(readFileSyncWithDebug(absolutePath));
    hash.update('\n');
  }

  return hash.digest('hex');
}

export function createStephanosBuildMetadata() {
  return {
    appName: 'Stephanos UI',
    version: stephanosUiPackage.version,
    sourceIdentifier: 'stephanos-ui/src',
    sourceFingerprint: computeStephanosSourceFingerprint(),
    buildTarget: 'apps/stephanos/dist',
    buildTargetIdentifier: 'apps/stephanos/dist',
    runtimeId: 'live-vite-shell',
    runtimeMarker: 'stephanos-ui/runtime::dist-synced-v2',
    gitCommit: getGitCommit(),
    buildTimestamp: new Date().toISOString(),
  };
}

export function cleanStephanosDist() {
  if (existsSync(stephanosDistRoot)) {
    rmSync(stephanosDistRoot, { recursive: true, force: true });
  }
}

export function prependDistBannerIfNeeded() {
  if (!existsSync(stephanosDistIndexPath)) {
    return;
  }

  const html = readFileSyncWithDebug(stephanosDistIndexPath, 'utf8');
  if (!html.startsWith(DIST_WARNING_BANNER)) {
    writeFileSync(stephanosDistIndexPath, `${DIST_WARNING_BANNER}\n${html}`);
  }
}

export function writeStephanosDistMetadata(metadata) {
  writeFileSync(stephanosDistMetadataPath, `${JSON.stringify(metadata, null, 2)}\n`);
}

export function readDistMetadataJson() {
  if (!existsSync(stephanosDistMetadataPath)) {
    return null;
  }

  return JSON.parse(readFileSyncWithDebug(stephanosDistMetadataPath, 'utf8'));
}

export function extractEmbeddedHtmlMetadata(html) {
  const metadataMatch = html.match(/<script id="stephanos-build-metadata" type="application\/json">([\s\S]*?)<\/script>/);
  if (!metadataMatch) {
    return null;
  }

  return JSON.parse(metadataMatch[1]);
}

export function getDistAssetReferences(indexHtml) {
  return [
    ...indexHtml.matchAll(/<(?:script|link)\b[^>]+(?:src|href)=["']([^"']+)["'][^>]*>/g),
  ]
    .map((match) => match[1])
    .filter((assetPath) => /^\.?\//.test(assetPath));
}

export function resolveDistAssetPath(assetPath) {
  return resolveFsPath(path.dirname(stephanosDistIndexPath), assetPath);
}

export function getDistAgeMs() {
  if (!existsSync(stephanosDistMetadataPath)) {
    return null;
  }

  return Date.now() - statSync(stephanosDistMetadataPath).mtimeMs;
}

export function formatDurationMs(durationMs) {
  if (durationMs == null) {
    return 'unknown';
  }

  const seconds = Math.round(durationMs / 1000);
  if (seconds < 60) {
    return `${seconds}s`;
  }

  const minutes = Math.round(seconds / 60);
  return `${minutes}m`;
}
