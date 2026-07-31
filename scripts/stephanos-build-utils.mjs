import {
  closeSync,
  existsSync,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
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
  if (isStephanosDebugEnabled()) {
    console.log(`[stephanos debug] Reading filesystem path: ${normalizedPath}`);
  }
  return readFileSync(normalizedPath, options);
}

export function isStephanosDebugEnabled({
  argv = process.argv.slice(2),
  env = process.env,
} = {}) {
  const hasDebugFlag = Array.isArray(argv) && argv.includes('--debug');
  const debugEnv = String(env?.STEPHANOS_DEBUG || '').trim();
  return hasDebugFlag || debugEnv === '1';
}

const buildUtilsDir = path.dirname(fileURLToPath(import.meta.url));

export const repoRoot = resolveFsPath(buildUtilsDir, '..');
export const stephanosUiRoot = resolveFsPath(repoRoot, 'stephanos-ui');
export const stephanosUiSrcRoot = resolveFsPath(stephanosUiRoot, 'src');
export const sharedRuntimeRoot = resolveFsPath(repoRoot, 'shared', 'runtime');
export const sharedAiRoot = resolveFsPath(repoRoot, 'shared', 'ai');
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

export const STEPHANOS_DIST_MANIFEST_SCHEMA_VERSION = 'stephanos.dist-runtime-manifest.v1';
export const STEPHANOS_DIST_MANIFEST_MAX_FILES = 256;
export const STEPHANOS_DIST_MANIFEST_MAX_FILE_BYTES = 32 * 1024 * 1024;
export const STEPHANOS_DIST_MANIFEST_MAX_TOTAL_BYTES = 128 * 1024 * 1024;

const FINGERPRINT_INPUTS = [
  'stephanos-ui/index.html',
  'stephanos-ui/package.json',
  'stephanos-ui/package-lock.json',
  'stephanos-ui/vite.config.js',
  'package.json',
];

const FINGERPRINT_SOURCE_TREES = [
  'stephanos-ui/src',
  'shared',
  'apps/music-tile',
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

function asciiPathCompare(left, right) {
  return left < right ? -1 : (left > right ? 1 : 0);
}

function distManifestError(code, detail = '') {
  const error = new Error(detail ? `${code}:${detail}` : code);
  error.code = code;
  return error;
}

function assertBoundedPositiveInteger(value, fallback, code) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) {
    if (value == null) return fallback;
    throw distManifestError(code);
  }
  return number;
}

function normalizeDistAssetReference(reference = '') {
  const value = String(reference || '');
  if (!/^\.\/[A-Za-z0-9_][A-Za-z0-9._/-]*$/.test(value)) {
    throw distManifestError('STEPHANOS_DIST_ASSET_REFERENCE_INVALID', value.slice(0, 160));
  }
  const relativePath = value.slice(2);
  const segments = relativePath.split('/');
  if (
    !relativePath
    || segments.some((segment) => !segment || segment === '.' || segment === '..')
  ) {
    throw distManifestError('STEPHANOS_DIST_ASSET_REFERENCE_INVALID', value.slice(0, 160));
  }
  return relativePath;
}

export function getStephanosDistRuntimeAssetReferences(indexHtml = '') {
  const references = [];
  const seen = new Set();
  const tags = String(indexHtml || '').match(/<(?:script|link)\b[^>]*>/gi) || [];
  for (const tag of tags) {
    const attributes = [
      ...tag.matchAll(/\b(?:src|href)\s*=\s*(["'])([^"']*)\1/gi),
    ].map((match) => match[2]);
    if (/\b(?:src|href)\s*=/i.test(tag) && attributes.length !== 1) {
      throw distManifestError('STEPHANOS_DIST_ASSET_REFERENCE_INVALID');
    }
    if (attributes.length === 0) continue;
    const relativePath = normalizeDistAssetReference(attributes[0]);
    if (seen.has(relativePath)) {
      throw distManifestError('STEPHANOS_DIST_ASSET_REFERENCE_DUPLICATE', relativePath);
    }
    seen.add(relativePath);
    references.push(relativePath);
  }
  return Object.freeze(references.sort(asciiPathCompare));
}

function readRegularFileForDistManifest(filePath, {
  distRoot,
  maxFileBytes,
  remainingBytes,
} = {}) {
  const normalizedDistRoot = resolveFsPath(distRoot);
  const normalizedFilePath = resolveFsPath(filePath);
  const relativePath = path.relative(normalizedDistRoot, normalizedFilePath);
  if (
    !relativePath
    || relativePath.startsWith(`..${path.sep}`)
    || relativePath === '..'
    || path.isAbsolute(relativePath)
  ) {
    throw distManifestError('STEPHANOS_DIST_MANIFEST_PATH_ESCAPE');
  }
  let rootInfo;
  try {
    rootInfo = lstatSync(normalizedDistRoot);
  } catch {
    throw distManifestError('STEPHANOS_DIST_MANIFEST_ROOT_UNREADABLE');
  }
  if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory()) {
    throw distManifestError('STEPHANOS_DIST_MANIFEST_ROOT_NOT_REGULAR');
  }
  let currentDirectory = normalizedDistRoot;
  for (const segment of relativePath.split(path.sep).slice(0, -1)) {
    currentDirectory = path.join(currentDirectory, segment);
    let directoryInfo;
    try {
      directoryInfo = lstatSync(currentDirectory);
    } catch {
      throw distManifestError('STEPHANOS_DIST_MANIFEST_FILE_UNREADABLE');
    }
    if (directoryInfo.isSymbolicLink() || !directoryInfo.isDirectory()) {
      throw distManifestError('STEPHANOS_DIST_MANIFEST_PATH_NOT_REGULAR');
    }
  }
  let canonicalDistRoot;
  let canonicalFilePath;
  try {
    canonicalDistRoot = path.normalize(realpathSync(normalizedDistRoot));
    canonicalFilePath = path.normalize(realpathSync(normalizedFilePath));
  } catch {
    throw distManifestError('STEPHANOS_DIST_MANIFEST_FILE_UNREADABLE');
  }
  const canonicalRelativePath = path.relative(canonicalDistRoot, canonicalFilePath);
  if (
    !canonicalRelativePath
    || canonicalRelativePath.startsWith(`..${path.sep}`)
    || canonicalRelativePath === '..'
    || path.isAbsolute(canonicalRelativePath)
  ) {
    throw distManifestError('STEPHANOS_DIST_MANIFEST_PATH_ESCAPE');
  }

  let pathInfo;
  try {
    pathInfo = lstatSync(normalizedFilePath);
  } catch {
    throw distManifestError('STEPHANOS_DIST_MANIFEST_FILE_UNREADABLE');
  }
  if (pathInfo.isSymbolicLink() || !pathInfo.isFile()) {
    throw distManifestError('STEPHANOS_DIST_MANIFEST_FILE_NOT_REGULAR');
  }
  if (pathInfo.size > maxFileBytes || pathInfo.size > remainingBytes) {
    throw distManifestError('STEPHANOS_DIST_MANIFEST_FILE_TOO_LARGE');
  }

  let descriptor;
  try {
    descriptor = openSync(normalizedFilePath, 'r');
    const openedInfo = fstatSync(descriptor);
    const openedCanonicalPath = path.normalize(realpathSync(normalizedFilePath));
    if (
      !openedInfo.isFile()
      || openedInfo.size !== pathInfo.size
      || openedCanonicalPath !== canonicalFilePath
      || (
        pathInfo.ino
        && openedInfo.ino
        && pathInfo.ino !== 0
        && openedInfo.ino !== 0
        && (
          pathInfo.ino !== openedInfo.ino
          || pathInfo.dev !== openedInfo.dev
        )
      )
    ) {
      throw distManifestError('STEPHANOS_DIST_MANIFEST_FILE_CHANGED');
    }
    const bytes = readFileSync(descriptor);
    const afterInfo = fstatSync(descriptor);
    const afterCanonicalPath = path.normalize(realpathSync(normalizedFilePath));
    if (
      bytes.length !== openedInfo.size
      || afterInfo.size !== openedInfo.size
      || afterCanonicalPath !== canonicalFilePath
      || (
        openedInfo.ino
        && afterInfo.ino
        && (
          openedInfo.ino !== afterInfo.ino
          || openedInfo.dev !== afterInfo.dev
        )
      )
    ) {
      throw distManifestError('STEPHANOS_DIST_MANIFEST_FILE_CHANGED');
    }
    return bytes;
  } catch (error) {
    if (error?.code?.startsWith?.('STEPHANOS_DIST_')) throw error;
    throw distManifestError('STEPHANOS_DIST_MANIFEST_FILE_UNREADABLE');
  } finally {
    if (descriptor !== undefined) {
      try { closeSync(descriptor); } catch {}
    }
  }
}

export function computeStephanosDistManifestFingerprint(entries = []) {
  if (!Array.isArray(entries) || entries.length === 0) {
    throw distManifestError('STEPHANOS_DIST_MANIFEST_EMPTY');
  }
  const hash = createHash('sha256');
  hash.update(`${STEPHANOS_DIST_MANIFEST_SCHEMA_VERSION}\n`);
  const seen = new Set();
  const ordered = [...entries].sort((left, right) => asciiPathCompare(
    String(left?.path || ''),
    String(right?.path || ''),
  ));
  for (const entry of ordered) {
    const entryPath = String(entry?.path || '');
    const size = Number(entry?.size);
    const sha256 = String(entry?.sha256 || '').toLowerCase();
    if (
      !/^[A-Za-z0-9_][A-Za-z0-9._/-]*$/.test(entryPath)
      || entryPath.split('/').some((segment) => !segment || segment === '.' || segment === '..')
      || !Number.isSafeInteger(size)
      || size < 0
      || !/^[0-9a-f]{64}$/.test(sha256)
    ) {
      throw distManifestError('STEPHANOS_DIST_MANIFEST_ENTRY_INVALID');
    }
    if (seen.has(entryPath)) {
      throw distManifestError('STEPHANOS_DIST_MANIFEST_ENTRY_DUPLICATE', entryPath);
    }
    seen.add(entryPath);
    hash.update(`FILE:${entryPath}\nSIZE:${size}\nSHA256:${sha256}\n`);
  }
  return hash.digest('hex');
}

function listStephanosDistManifestFiles(distRoot, {
  maxFiles,
} = {}) {
  const files = [];
  const walk = (directoryPath, relativeDirectory = '') => {
    let directoryInfo;
    try {
      directoryInfo = lstatSync(directoryPath);
    } catch {
      throw distManifestError('STEPHANOS_DIST_MANIFEST_ROOT_UNREADABLE');
    }
    if (directoryInfo.isSymbolicLink() || !directoryInfo.isDirectory()) {
      throw distManifestError('STEPHANOS_DIST_MANIFEST_PATH_NOT_REGULAR');
    }
    let children;
    try {
      children = readdirSync(directoryPath, { withFileTypes: true })
        .sort((left, right) => asciiPathCompare(left.name, right.name));
    } catch {
      throw distManifestError('STEPHANOS_DIST_MANIFEST_ROOT_UNREADABLE');
    }
    for (const child of children) {
      const childRelativePath = relativeDirectory
        ? `${relativeDirectory}/${child.name}`
        : child.name;
      const childPath = path.join(directoryPath, child.name);
      const childInfo = lstatSync(childPath);
      if (childInfo.isSymbolicLink()) {
        throw distManifestError(
          'STEPHANOS_DIST_MANIFEST_PATH_NOT_REGULAR',
          childRelativePath,
        );
      }
      if (childInfo.isDirectory()) {
        walk(childPath, childRelativePath);
        continue;
      }
      if (!childInfo.isFile()) {
        throw distManifestError(
          'STEPHANOS_DIST_MANIFEST_FILE_NOT_REGULAR',
          childRelativePath,
        );
      }
      files.push(childRelativePath);
      if (files.length > maxFiles) {
        throw distManifestError('STEPHANOS_DIST_MANIFEST_TOO_MANY_FILES');
      }
    }
  };
  walk(distRoot);
  return Object.freeze(files.sort(asciiPathCompare));
}

function resolveTrustedStephanosDistRoot(rootDir) {
  const lexicalRoot = resolveFsPath(rootDir);
  let canonicalRoot;
  try {
    canonicalRoot = path.normalize(realpathSync(lexicalRoot));
  } catch {
    throw distManifestError('STEPHANOS_DIST_MANIFEST_ROOT_UNREADABLE');
  }
  let currentPath = lexicalRoot;
  for (const segment of ['apps', 'stephanos', 'dist']) {
    currentPath = path.join(currentPath, segment);
    let info;
    try {
      info = lstatSync(currentPath);
    } catch {
      throw distManifestError('STEPHANOS_DIST_MANIFEST_ROOT_UNREADABLE');
    }
    if (info.isSymbolicLink() || !info.isDirectory()) {
      throw distManifestError('STEPHANOS_DIST_MANIFEST_ROOT_NOT_REGULAR');
    }
  }
  const canonicalDistRoot = path.normalize(realpathSync(currentPath));
  const expectedCanonicalDistRoot = path.normalize(path.join(
    canonicalRoot,
    'apps',
    'stephanos',
    'dist',
  ));
  if (canonicalDistRoot !== expectedCanonicalDistRoot) {
    throw distManifestError('STEPHANOS_DIST_MANIFEST_PATH_ESCAPE');
  }
  return path.normalize(currentPath);
}

export function createStephanosDistManifest({
  rootDir = repoRoot,
  maxFiles = STEPHANOS_DIST_MANIFEST_MAX_FILES,
  maxFileBytes = STEPHANOS_DIST_MANIFEST_MAX_FILE_BYTES,
  maxTotalBytes = STEPHANOS_DIST_MANIFEST_MAX_TOTAL_BYTES,
} = {}) {
  const fingerprintRepoRoot = resolveFsPath(rootDir);
  const distRoot = resolveTrustedStephanosDistRoot(fingerprintRepoRoot);
  const boundedMaxFiles = assertBoundedPositiveInteger(
    maxFiles,
    STEPHANOS_DIST_MANIFEST_MAX_FILES,
    'STEPHANOS_DIST_MANIFEST_MAX_FILES_INVALID',
  );
  const boundedMaxFileBytes = assertBoundedPositiveInteger(
    maxFileBytes,
    STEPHANOS_DIST_MANIFEST_MAX_FILE_BYTES,
    'STEPHANOS_DIST_MANIFEST_MAX_FILE_BYTES_INVALID',
  );
  const boundedMaxTotalBytes = assertBoundedPositiveInteger(
    maxTotalBytes,
    STEPHANOS_DIST_MANIFEST_MAX_TOTAL_BYTES,
    'STEPHANOS_DIST_MANIFEST_MAX_TOTAL_BYTES_INVALID',
  );

  const relativePaths = listStephanosDistManifestFiles(distRoot, {
    maxFiles: boundedMaxFiles,
  });
  if (
    !relativePaths.includes('index.html')
    || !relativePaths.includes('stephanos-build.json')
  ) {
    throw distManifestError('STEPHANOS_DIST_MANIFEST_REQUIRED_FILE_MISSING');
  }
  const indexBytes = readRegularFileForDistManifest(
    resolveFsPath(distRoot, 'index.html'),
    {
      distRoot,
      maxFileBytes: boundedMaxFileBytes,
      remainingBytes: boundedMaxTotalBytes,
    },
  );
  let runtimeAssetPaths;
  try {
    runtimeAssetPaths = getStephanosDistRuntimeAssetReferences(indexBytes.toString('utf8'));
  } catch (error) {
    if (error?.code?.startsWith?.('STEPHANOS_DIST_')) throw error;
    throw distManifestError('STEPHANOS_DIST_ASSET_REFERENCE_INVALID');
  }
  const knownPaths = new Set(relativePaths);
  for (const runtimeAssetPath of runtimeAssetPaths) {
    if (!knownPaths.has(runtimeAssetPath)) {
      throw distManifestError(
        'STEPHANOS_DIST_MANIFEST_REQUIRED_FILE_MISSING',
        runtimeAssetPath,
      );
    }
  }

  let totalBytes = indexBytes.length;
  const entries = [Object.freeze({
    path: 'index.html',
    size: indexBytes.length,
    sha256: createHash('sha256').update(indexBytes).digest('hex'),
  })];
  for (const relativePath of relativePaths.filter((item) => item !== 'index.html')) {
    const absolutePath = resolveFsPath(distRoot, ...relativePath.split('/'));
    const relativeCheck = path.relative(distRoot, absolutePath).replace(/\\/g, '/');
    if (
      relativeCheck !== relativePath
      || relativeCheck.startsWith('../')
      || path.isAbsolute(relativeCheck)
    ) {
      throw distManifestError('STEPHANOS_DIST_MANIFEST_PATH_ESCAPE', relativePath);
    }
    const bytes = readRegularFileForDistManifest(absolutePath, {
      distRoot,
      maxFileBytes: boundedMaxFileBytes,
      remainingBytes: boundedMaxTotalBytes - totalBytes,
    });
    totalBytes += bytes.length;
    if (totalBytes > boundedMaxTotalBytes) {
      throw distManifestError('STEPHANOS_DIST_MANIFEST_TOTAL_TOO_LARGE');
    }
    entries.push(Object.freeze({
      path: relativePath,
      size: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    }));
  }
  const fingerprint = computeStephanosDistManifestFingerprint(entries);
  return Object.freeze({
    schemaVersion: STEPHANOS_DIST_MANIFEST_SCHEMA_VERSION,
    fingerprint,
    fileCount: entries.length,
    totalBytes,
    entries: Object.freeze(entries),
  });
}

export function computeStephanosDistFingerprint({ rootDir = repoRoot, ...limits } = {}) {
  return createStephanosDistManifest({ rootDir, ...limits }).fingerprint;
}

export function getStephanosFingerprintSourceFiles(rootDir = repoRoot) {
  const fingerprintRepoRoot = resolveFsPath(rootDir);
  return [
    ...FINGERPRINT_INPUTS.map((filePath) => resolveFsPath(fingerprintRepoRoot, filePath)),
    ...FINGERPRINT_SOURCE_TREES.flatMap((treePath) => (
      walkFiles(resolveFsPath(fingerprintRepoRoot, treePath))
    )),
  ].sort((left, right) => left.localeCompare(right));
}

export function getGitCommit() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return 'git-unavailable';
  }
}

export function computeStephanosSourceFingerprint({ rootDir = repoRoot } = {}) {
  const fingerprintRepoRoot = resolveFsPath(rootDir);
  const hash = createHash('sha256');
  const files = getStephanosFingerprintSourceFiles(fingerprintRepoRoot);

  for (const absolutePath of files) {
    const relPath = path.relative(fingerprintRepoRoot, absolutePath).replace(/\\/g, '/');
    hash.update(`FILE:${relPath}\n`);
    hash.update(readFileSyncWithDebug(absolutePath));
    hash.update('\n');
  }

  return hash.digest('hex');
}

export function createStephanosBuildMetadata() {
  const gitCommit = getGitCommit();
  const buildTimestamp = new Date().toISOString();
  const sourceFingerprint = computeStephanosSourceFingerprint();
  return {
    appName: 'Stephanos UI',
    version: stephanosUiPackage.version,
    sourceIdentifier: 'stephanos-ui/src',
    sourceFingerprint,
    buildTarget: 'apps/stephanos/dist',
    buildTargetIdentifier: 'apps/stephanos/dist',
    runtimeId: 'live-vite-shell',
    runtimeMarker: `antifriction-live-v3::${gitCommit}::${sourceFingerprint.slice(0, 12)}`,
    gitCommit,
    buildTimestamp,
    sourceTruth: 'sourceFingerprint',
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
