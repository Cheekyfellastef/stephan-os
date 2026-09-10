#!/usr/bin/env node
import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';

const LOCAL_SCHEMA = 'stephanos.starfield-vr-local-delivery-observation.v1';
const INSTALL_SCHEMA = 'stephanos.starfield-vr-shortcut-install.v1';
const SHA = /^[0-9a-f]{40}$/i;
const MAX_JSON_BYTES = 64 * 1024;
const home = resolve(process.env.USERPROFILE || homedir());
const repositoryRoot = resolve(home, 'Documents', 'GitHub', 'stephan-os');
const workspaceRoot = resolve(home, 'Documents', 'Stephanos-openclaw-workspace');
const expectedSplash = resolve(repositoryRoot, 'scripts', 'windows', 'launch-starfield-vr-with-splash.ps1');
const installerReceiptPath = resolve(workspaceRoot, 'vr', 'starfield-vr-shortcut-install-current.json');
const outputPath = resolve(workspaceRoot, 'vr', 'starfield-vr-delivery-current.json');

function plainRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) return null;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(descriptors).some((key) => typeof key !== 'string')) return null;
  const out = Object.create(null);
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (descriptor.get || descriptor.set || !Object.hasOwn(descriptor, 'value')) return null;
    out[key] = descriptor.value;
  }
  return out;
}

function readBoundedJson(path) {
  if (!existsSync(path) || !lstatSync(path).isFile()) return { present: false, record: null };
  const bytes = readFileSync(path);
  if (bytes.length === 0 || bytes.length > MAX_JSON_BYTES) return { present: true, record: null };
  try {
    return { present: true, record: plainRecord(JSON.parse(bytes.toString('utf8'))) };
  } catch {
    return { present: true, record: null };
  }
}

function pathWithinHome(path) {
  if (typeof path !== 'string' || !path || !isAbsolute(path)) return false;
  const delta = relative(home, resolve(path));
  return delta === '' || (!delta.startsWith('..') && !isAbsolute(delta));
}

function normalizeWindowsPath(path) {
  return resolve(String(path || '')).toLowerCase();
}

function readGitHead() {
  const gitRoot = resolve(repositoryRoot, '.git');
  if (!existsSync(gitRoot) || !lstatSync(gitRoot).isDirectory()) return '';
  const headPath = join(gitRoot, 'HEAD');
  if (!existsSync(headPath) || !lstatSync(headPath).isFile()) return '';
  const head = readFileSync(headPath, 'utf8').trim();
  if (SHA.test(head)) return head.toLowerCase();
  if (!head.startsWith('ref: refs/heads/')) return '';
  const ref = head.slice(5).trim();
  if (!/^refs\/heads\/[A-Za-z0-9][A-Za-z0-9._/-]{0,239}$/.test(ref) || ref.includes('..')) return '';
  const loosePath = resolve(gitRoot, ...ref.split('/'));
  const delta = relative(gitRoot, loosePath);
  if (delta.startsWith('..') || isAbsolute(delta)) return '';
  if (existsSync(loosePath) && lstatSync(loosePath).isFile()) {
    const sha = readFileSync(loosePath, 'utf8').trim();
    return SHA.test(sha) ? sha.toLowerCase() : '';
  }
  const packedPath = join(gitRoot, 'packed-refs');
  if (!existsSync(packedPath) || !lstatSync(packedPath).isFile()) return '';
  for (const line of readFileSync(packedPath, 'utf8').split(/\r?\n/)) {
    if (!line || line.startsWith('#') || line.startsWith('^')) continue;
    const [sha, name] = line.trim().split(/\s+/, 2);
    if (name === ref && SHA.test(sha)) return sha.toLowerCase();
  }
  return '';
}

const installer = readBoundedJson(installerReceiptPath);
const receipt = installer.record;
const receiptValid = Boolean(receipt
  && receipt.schemaVersion === INSTALL_SCHEMA
  && receipt.shortcutName === 'Starfield VR'
  && receipt.finalVerdict === 'STARFIELD_VR_SHORTCUT_INSTALLED'
  && receipt.created === true
  && typeof receipt.shortcutPath === 'string'
  && pathWithinHome(receipt.shortcutPath)
  && basename(receipt.shortcutPath).toLowerCase() === 'starfield vr.lnk'
  && typeof receipt.splashLauncherScript === 'string'
  && normalizeWindowsPath(receipt.splashLauncherScript) === normalizeWindowsPath(expectedSplash));

const shortcutPath = receiptValid ? resolve(receipt.shortcutPath) : '';
const desktopIconPresent = Boolean(shortcutPath && existsSync(shortcutPath) && lstatSync(shortcutPath).isFile());
const splashWrapperPresent = existsSync(expectedSplash) && lstatSync(expectedSplash).isFile();
const installedSourceHead = readGitHead();

const observation = {
  schemaVersion: LOCAL_SCHEMA,
  observedAtUtc: new Date().toISOString(),
  desktopIconPresent,
  splashWrapperPresent,
  shortcutTargetPath: '',
  shortcutArguments: '',
  shortcutRoutesThroughSplash: Boolean(receiptValid && desktopIconPresent && splashWrapperPresent),
  installerReceiptPresent: installer.present,
  installerReceiptVerdict: receipt && typeof receipt.finalVerdict === 'string' && receipt.finalVerdict.length <= 120
    ? receipt.finalVerdict
    : '',
  installedSourceHead,
};

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(observation, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
process.stdout.write(`${JSON.stringify(observation, null, 2)}\n`);
