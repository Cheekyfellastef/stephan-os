import { readFile, realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';

import { projectVrTeachingIntoSharedWorkspace } from './vrTeachingWorkspaceProjectionV1.mjs';

export const VR_TEACHING_REGISTRY_LOADER_SCHEMA = 'stephanos.vr-teaching-registry-loader.v1';

function text(value) {
  return String(value ?? '').trim();
}

function isWithin(parent, child) {
  const rel = relative(parent, child);
  return rel === '' || (!!rel && !rel.startsWith('..') && !isAbsolute(rel));
}

function safeRegisteredPath(pathValue) {
  const value = text(pathValue).replace(/\\/g, '/');
  if (!value || value.startsWith('/') || /^[a-z]:\//i.test(value)) return '';
  if (value.split('/').some((part) => part === '..' || part === '')) return '';
  return value;
}

async function readRepoJson(repoRoot, relativePath) {
  const safePath = safeRegisteredPath(relativePath);
  if (!safePath) throw new Error('vr-teaching-registered-path-unsafe');
  const [realRoot, realTarget] = await Promise.all([
    realpath(repoRoot),
    realpath(resolve(repoRoot, safePath)),
  ]);
  if (!isWithin(realRoot, realTarget)) throw new Error('vr-teaching-registered-path-escapes-repo');
  return JSON.parse(await readFile(realTarget, 'utf8'));
}

export async function loadRegisteredVrTeachingProjectionV1(options = {}) {
  const repoRoot = resolve(options.repoRoot || process.cwd());
  const updatedAt = text(options.updatedAt || options.timestampUtc) || new Date().toISOString();
  const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.parse(updatedAt);

  const sourceRegistry = options.sourceRegistry || await readRepoJson(repoRoot, 'VR-Research-Lab/knowledge-sources.json');
  const workspaceModel = options.workspaceModel || await readRepoJson(repoRoot, 'VR-Research-Lab/lab-workspace.json');
  const sources = Array.isArray(sourceRegistry?.sources) ? sourceRegistry.sources : [];
  const teachingRecords = [];
  const loadedTeachingPackets = [];

  for (const source of sources) {
    const packetPath = safeRegisteredPath(source?.local_teaching_records);
    if (!packetPath) continue;
    const packet = await readRepoJson(repoRoot, packetPath);
    const sourceId = text(source?.source_id || source?.sourceId);
    if (text(packet?.sourceId) !== sourceId) throw new Error('vr-teaching-packet-source-mismatch:' + sourceId);
    if (!Array.isArray(packet?.records)) throw new Error('vr-teaching-packet-records-required:' + sourceId);
    for (const record of packet.records) {
      if (text(record?.sourceId) !== sourceId) throw new Error('vr-teaching-record-source-mismatch:' + sourceId);
      teachingRecords.push(record);
    }
    loadedTeachingPackets.push(Object.freeze({
      sourceId,
      path: packetPath,
      observedIdentity: text(packet?.observedIdentity),
      recordCount: packet.records.length,
    }));
  }

  const projected = projectVrTeachingIntoSharedWorkspace({
    ...options,
    sourceRegistry,
    workspaceModel,
    teachingRecords,
    updatedAt,
    nowMs,
  });

  return Object.freeze({
    schemaVersion: VR_TEACHING_REGISTRY_LOADER_SCHEMA,
    ...projected,
    loadedTeachingPackets: Object.freeze(loadedTeachingPackets),
    loadedTeachingRecordCount: teachingRecords.length,
  });
}
