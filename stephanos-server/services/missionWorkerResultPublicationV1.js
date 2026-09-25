import { randomUUID } from 'node:crypto';
import { link, mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';

export const MISSION_WORKER_RESULT_PUBLICATION_SCHEMA =
  'stephanos.mission-worker-result-publication.v1';

function text(value) {
  return String(value ?? '').trim();
}

function payloadBytes(result) {
  return Buffer.from(`${JSON.stringify(result, null, 2)}\n`, 'utf8');
}

async function writeFsyncedTemp(resultPath, payload) {
  const directory = dirname(resultPath);
  await mkdir(directory, { recursive: true });
  const tempPath = resolve(
    directory,
    `.${basename(resultPath)}.${process.pid}.${randomUUID()}.tmp`,
  );
  const handle = await open(tempPath, 'wx', 0o600);
  try {
    await handle.writeFile(payload);
    await handle.sync();
  } finally {
    await handle.close();
  }
  return tempPath;
}

export async function publishMissionWorkerResultAtomicallyV1(
  resultPath,
  result,
  options = {},
) {
  const targetPath = resolve(text(resultPath));
  const payload = payloadBytes(result);
  const tempPath = await writeFsyncedTemp(targetPath, payload);
  try {
    try {
      await link(tempPath, targetPath);
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      let existingBytes;
      try {
        existingBytes = await readFile(targetPath);
      } catch {
        return Object.freeze({
          ok: false,
          published: false,
          reason: 'MISSION_WORKER_RESULT_EXISTING_READ_FAILED',
          resultPath: targetPath,
        });
      }
      if (existingBytes.equals(payload)) {
        return Object.freeze({
          ok: true,
          published: false,
          idempotent: true,
          reason: 'MISSION_WORKER_RESULT_ALREADY_PUBLISHED',
          resultPath: targetPath,
          existing: result,
        });
      }
      let existing;
      try {
        existing = JSON.parse(existingBytes.toString('utf8'));
      } catch {
        return Object.freeze({
          ok: false,
          published: false,
          reason: 'MISSION_WORKER_RESULT_EXISTING_INVALID',
          resultPath: targetPath,
          existingBytes,
        });
      }
      if (
        typeof options.acceptExisting === 'function'
        && options.acceptExisting(existing, result) === true
      ) {
        return Object.freeze({
          ok: true,
          published: false,
          idempotent: true,
          reason: 'MISSION_WORKER_RESULT_EXISTING_ACCEPTED',
          resultPath: targetPath,
          existing,
        });
      }
      return Object.freeze({
        ok: false,
        published: false,
        reason: 'MISSION_WORKER_RESULT_EXISTING_CONFLICT',
        resultPath: targetPath,
        existing,
      });
    }

    const readback = await readFile(targetPath);
    if (!readback.equals(payload)) {
      return Object.freeze({
        ok: false,
        published: true,
        reason: 'MISSION_WORKER_RESULT_READBACK_MISMATCH',
        resultPath: targetPath,
      });
    }
    return Object.freeze({
      ok: true,
      published: true,
      idempotent: false,
      reason: 'MISSION_WORKER_RESULT_PUBLISHED',
      resultPath: targetPath,
    });
  } finally {
    await unlink(tempPath).catch(() => {});
  }
}

export async function quarantineInvalidMissionWorkerResultV1(
  resultPath,
  expectedExistingBytes,
) {
  const targetPath = resolve(text(resultPath));
  let current;
  try {
    current = await readFile(targetPath);
  } catch (error) {
    return Object.freeze({
      ok: false,
      reason: error?.code === 'ENOENT'
        ? 'MISSION_WORKER_RESULT_QUARANTINE_MISSING'
        : 'MISSION_WORKER_RESULT_QUARANTINE_READ_FAILED',
    });
  }
  const expected = Buffer.isBuffer(expectedExistingBytes)
    ? expectedExistingBytes
    : Buffer.from(expectedExistingBytes || '');
  if (!expected.length || !current.equals(expected)) {
    return Object.freeze({
      ok: false,
      reason: 'MISSION_WORKER_RESULT_QUARANTINE_IDENTITY_CHANGED',
    });
  }
  const quarantinePath = `${targetPath}.invalid-${process.pid}-${randomUUID()}`;
  try {
    await rename(targetPath, quarantinePath);
  } catch (error) {
    return Object.freeze({
      ok: false,
      reason: error?.code === 'ENOENT'
        ? 'MISSION_WORKER_RESULT_QUARANTINE_RACE'
        : 'MISSION_WORKER_RESULT_QUARANTINE_FAILED',
    });
  }
  return Object.freeze({
    ok: true,
    reason: 'MISSION_WORKER_RESULT_QUARANTINED',
    resultPath: targetPath,
    quarantinePath,
  });
}
