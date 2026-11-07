import { createHash } from 'node:crypto';
import { access, copyFile, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

export const STARFIELD_VR_PROVIDER_CACHE_SCHEMA = 'stephanos.starfield-vr-provider-cache.v1';
export const STARFIELD_VR_PROVIDER_SLOT_RECEIPT_SCHEMA = 'stephanos.starfield-vr-provider-slot-receipt.v1';
export const STARFIELD_VR_PROVIDER_SLOT_READY = 'STARFIELD_VR_PROVIDER_SLOT_READY';
export const STARFIELD_VR_PROVIDER_SLOT_DRY_RUN = 'STARFIELD_VR_PROVIDER_SLOT_DRY_RUN';

const ALLOWED_PROVIDERS = new Set(['vorpx', 'mutar-openxr']);
const ROLE_TARGETS = Object.freeze({
  'injection-proxy': 'dxgi.dll',
  'openxr-loader': 'openxr_loader.dll',
});
const SHA256 = /^[a-f0-9]{64}$/i;

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalized(value) {
  const resolved = path.resolve(value);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function inside(root, candidate) {
  const base = normalized(root);
  const child = normalized(candidate);
  return child === base || child.startsWith(base + path.sep);
}

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function sha256File(filePath) {
  const bytes = await readFile(filePath);
  return createHash('sha256').update(bytes).digest('hex');
}

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(value, null, 2) + '\n', 'utf8');
}

export async function buildProviderSlotPlan({ manifestPath, provider }) {
  requireCondition(ALLOWED_PROVIDERS.has(provider), 'provider-not-allowlisted');
  const manifest = await readJson(manifestPath);
  requireCondition(manifest?.schemaVersion === STARFIELD_VR_PROVIDER_CACHE_SCHEMA, 'provider-cache-schema-invalid');

  const workspaceVrRoot = path.dirname(path.resolve(manifestPath));
  const providerRoot = path.join(workspaceVrRoot, 'providers');
  const gameRoot = path.resolve(text(manifest.gameRoot));
  const liveSlotPath = path.resolve(text(manifest.liveSlotPath));
  const gameExecutablePath = path.resolve(text(manifest.gameExecutablePath));
  const gameExecutableSha256 = text(manifest.gameExecutableSha256).toLowerCase();
  requireCondition(normalized(gameExecutablePath) === normalized(path.join(gameRoot, 'Starfield.exe')), 'game-executable-path-not-fixed');
  requireCondition(SHA256.test(gameExecutableSha256), 'game-executable-hash-invalid');
  requireCondition(await exists(gameExecutablePath), 'game-executable-missing');
  requireCondition(await sha256File(gameExecutablePath) === gameExecutableSha256, 'game-executable-hash-mismatch');
  requireCondition(normalized(liveSlotPath) === normalized(path.join(gameRoot, 'dxgi.dll')), 'live-slot-path-not-fixed');

  const providerSpec = manifest?.providers?.[provider];
  requireCondition(providerSpec && typeof providerSpec === 'object', 'provider-not-in-cache');
  requireCondition(Array.isArray(providerSpec.files) && providerSpec.files.length > 0, 'provider-cache-files-missing');

  const seenRoles = new Set();
  const entries = [];
  for (const file of providerSpec.files) {
    const role = text(file?.role);
    const targetName = ROLE_TARGETS[role];
    requireCondition(Boolean(targetName), 'provider-file-role-not-allowlisted:' + role);
    requireCondition(!seenRoles.has(role), 'provider-file-role-duplicate:' + role);
    seenRoles.add(role);

    const sourcePath = path.resolve(text(file?.path));
    const expectedHash = text(file?.sha256).toLowerCase();
    requireCondition(inside(providerRoot, sourcePath), 'provider-source-outside-cache:' + role);
    requireCondition(SHA256.test(expectedHash), 'provider-source-hash-invalid:' + role);
    requireCondition(await exists(sourcePath), 'provider-source-missing:' + role);

    const sourceHash = await sha256File(sourcePath);
    requireCondition(sourceHash === expectedHash, 'provider-source-hash-mismatch:' + role);

    const targetPath = path.join(gameRoot, targetName);
    const targetHash = await exists(targetPath) ? await sha256File(targetPath) : '';
    entries.push(Object.freeze({
      role,
      sourcePath,
      targetPath,
      expectedHash,
      sourceHash,
      currentHash: targetHash,
      needsChange: targetHash !== expectedHash,
    }));
  }

  requireCondition(seenRoles.has('injection-proxy'), 'provider-injection-proxy-missing');
  if (provider === 'vorpx') {
    requireCondition(seenRoles.size === 1, 'vorpx-provider-files-not-closed');
  }
  if (provider === 'mutar-openxr') {
    requireCondition(seenRoles.has('openxr-loader'), 'mutar-openxr-loader-missing');
    requireCondition(seenRoles.size === 2, 'mutar-provider-files-not-closed');
  }

  return Object.freeze({
    manifestPath: path.resolve(manifestPath),
    workspaceVrRoot,
    providerRoot,
    gameRoot,
    gameExecutablePath,
    gameExecutableSha256,
    liveSlotPath,
    provider,
    providerVersion: text(providerSpec.version),
    providerStatus: text(providerSpec.status),
    entries: Object.freeze(entries),
  });
}

async function writeReceipt(plan, payload) {
  const receiptRoot = path.join(plan.workspaceVrRoot, 'provider-slot-receipts');
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 17);
  const receiptPath = path.join(receiptRoot, 'starfield-vr-provider-slot-' + stamp + '.json');
  const currentPath = path.join(plan.workspaceVrRoot, 'starfield-vr-provider-slot-current.json');
  const receipt = {
    schemaVersion: STARFIELD_VR_PROVIDER_SLOT_RECEIPT_SCHEMA,
    writtenAtUtc: new Date().toISOString(),
    provider: plan.provider,
    providerVersion: plan.providerVersion,
    manifestPath: plan.manifestPath,
    gameRoot: plan.gameRoot,
    gameExecutablePath: plan.gameExecutablePath,
    gameExecutableSha256: plan.gameExecutableSha256,
    ...payload,
  };

  await writeJson(currentPath, receipt);

  try {
    await writeJson(receiptPath, receipt);
  } catch {
    // The current receipt is the authoritative durable state. Historical receipt
    // publication is best-effort once the authoritative state is committed.
  }

  return currentPath;
}

async function removeIfPresent(filePath) {
  await rm(filePath, { force: true });
}

export async function applyProviderSlot({ manifestPath, provider, apply = false }) {
  const plan = await buildProviderSlotPlan({ manifestPath, provider });
  const summary = plan.entries.map((entry) => ({
    role: entry.role,
    targetPath: entry.targetPath,
    currentHash: entry.currentHash,
    expectedHash: entry.expectedHash,
    needsChange: entry.needsChange,
  }));

  if (!apply) {
    const receiptPath = await writeReceipt(plan, {
      verdict: STARFIELD_VR_PROVIDER_SLOT_DRY_RUN,
      applied: false,
      changesRequired: summary.filter((entry) => entry.needsChange).length,
      files: summary,
    });
    return Object.freeze({
      ok: true,
      verdict: STARFIELD_VR_PROVIDER_SLOT_DRY_RUN,
      provider,
      applied: false,
      changesRequired: summary.filter((entry) => entry.needsChange).length,
      files: summary,
      receiptPath,
    });
  }

  const changes = plan.entries.filter((entry) => entry.needsChange);
  if (changes.length === 0) {
    const receiptPath = await writeReceipt(plan, {
      verdict: STARFIELD_VR_PROVIDER_SLOT_READY,
      applied: true,
      changed: false,
      files: summary,
    });
    return Object.freeze({
      ok: true,
      verdict: STARFIELD_VR_PROVIDER_SLOT_READY,
      provider,
      applied: true,
      changed: false,
      files: summary,
      receiptPath,
    });
  }

  const staged = [];
  const committed = [];
  try {
    for (const [index, entry] of changes.entries()) {
      const tempPath = entry.targetPath + '.stephanos-next-' + process.pid + '-' + index;
      await removeIfPresent(tempPath);
      await copyFile(entry.sourcePath, tempPath);
      const tempHash = await sha256File(tempPath);
      requireCondition(tempHash === entry.expectedHash, 'provider-staged-hash-mismatch:' + entry.role);
      staged.push({ ...entry, tempPath, backupPath: entry.targetPath + '.stephanos-backup' });
    }

    for (const item of staged) {
      requireCondition(!(await exists(item.backupPath)), 'provider-slot-stale-backup:' + item.role);
      const hadTarget = await exists(item.targetPath);
      if (hadTarget) await rename(item.targetPath, item.backupPath);
      try {
        await rename(item.tempPath, item.targetPath);
      } catch (error) {
        if (hadTarget && await exists(item.backupPath)) {
          await rename(item.backupPath, item.targetPath);
        }
        throw error;
      }
      committed.push({ ...item, hadTarget });
    }

    for (const item of committed) {
      const finalHash = await sha256File(item.targetPath);
      requireCondition(finalHash === item.expectedHash, 'provider-target-hash-mismatch:' + item.role);
    }

    const finalFiles = [];
    for (const entry of plan.entries) {
      finalFiles.push({
        role: entry.role,
        targetPath: entry.targetPath,
        sha256: await sha256File(entry.targetPath),
        expectedHash: entry.expectedHash,
      });
    }

    const receiptPath = await writeReceipt(plan, {
      verdict: STARFIELD_VR_PROVIDER_SLOT_READY,
      applied: true,
      changed: true,
      files: finalFiles,
    });

    for (const item of committed) {
      await removeIfPresent(item.backupPath);
    }

    return Object.freeze({
      ok: true,
      verdict: STARFIELD_VR_PROVIDER_SLOT_READY,
      provider,
      applied: true,
      changed: true,
      files: finalFiles,
      receiptPath,
    });
  } catch (error) {
    for (const item of [...committed].reverse()) {
      try {
        await removeIfPresent(item.targetPath);
        if (item.hadTarget && await exists(item.backupPath)) {
          await rename(item.backupPath, item.targetPath);
        }
      } catch {
        // Preserve the original error. Any rollback failure remains visible through the stale backup.
      }
    }
    for (const item of staged) {
      await removeIfPresent(item.tempPath);
    }
    throw error;
  }
}

function parseArgs(argv) {
  const args = { manifestPath: '', provider: '', apply: false };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--manifest') args.manifestPath = argv[++index] ?? '';
    else if (value === '--provider') args.provider = argv[++index] ?? '';
    else if (value === '--apply') args.apply = true;
    else throw new Error('unsupported-argument:' + value);
  }
  requireCondition(Boolean(text(args.manifestPath)), 'manifest-path-required');
  requireCondition(Boolean(text(args.provider)), 'provider-required');
  return args;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const args = parseArgs(process.argv.slice(2));
    const result = await applyProviderSlot(args);
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  } catch (error) {
    process.stderr.write(JSON.stringify({
      ok: false,
      verdict: 'STARFIELD_VR_PROVIDER_SLOT_BLOCKED',
      error: String(error?.message ?? error),
    }, null, 2) + '\n');
    process.exitCode = 2;
  }
}
