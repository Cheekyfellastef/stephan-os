import { basename, join, resolve } from 'node:path';
import { readMissionOperations } from './missionOperationsService.js';

function text(value = '') {
  return String(value || '').trim();
}

function publicReceiptPath(value = '') {
  const normalized = text(value).replace(/\\/g, '/');
  const leaf = basename(normalized);
  return leaf ? `receipt://${leaf}` : '';
}

function publicApproval(approval = {}) {
  return {
    approvalId: text(approval.approvalId),
    kind: text(approval.kind),
    status: text(approval.status),
    approvalRequired: approval.status === 'pending',
    requestedAt: text(approval.requestedAt),
    decidedAt: text(approval.decidedAt),
  };
}

function sanitizePublicText(value = '') {
  const raw = text(value);
  if (!raw || raw.startsWith('receipt://') || raw.startsWith('/api/')) return raw;
  return raw
    .replace(/[A-Za-z]:\\[^\s|,;)]+/g, 'redacted-local-path')
    .replace(/(^|[\s|,;(])\/(?:Users|home|tmp|workspace|var|private|mnt)\/[^\s|,;)]+/g, '$1redacted-local-path')
    .replace(/(^|[\s|,;(])\.{1,2}\/[^\s|,;)]+/g, '$1redacted-local-path')
    .replace(/(^|[\s|,;(])~\/[^\s|,;)]+/g, '$1redacted-local-path');
}

function sanitizePublicValue(value, key = '') {
  const normalizedKey = String(key || '').toLowerCase();
  if (typeof value === 'string') {
    if (/worktree/.test(normalizedKey)) return value === 'configured-isolated-worktree' ? value : (value ? 'configured-isolated-worktree' : '');
    if (/workspace|filesystem|receiptstore|storeroot|runtimepath/.test(normalizedKey)) return value ? 'redacted-local-path' : '';
    if (/^(directory|dir)$/.test(normalizedKey)) return value === 'configured-external-receipt-directory' ? value : (value ? 'configured-external-receipt-directory' : '');
    if (/(receiptpath|receipt_path|path)$/.test(normalizedKey)) return publicReceiptPath(value) || 'redacted-local-path';
    return sanitizePublicText(value);
  }
  if (Array.isArray(value)) return value.map((item) => sanitizePublicValue(item, key));
  if (value && typeof value === 'object') {
    const sanitized = {};
    for (const [childKey, childValue] of Object.entries(value)) {
      sanitized[childKey] = sanitizePublicValue(childValue, childKey);
    }
    return sanitized;
  }
  return value;
}

export function resolvePublicMissionOperationsDirectory(env = process.env) {
  const configured = text(env.STEPHANOS_MISSION_OPERATIONS_DIR || env.STEPHANOS_GITHUB_AUTH_RECEIPT_DIR);
  if (configured) return resolve(configured);
  const userProfile = text(env.USERPROFILE);
  return userProfile
    ? resolve(join(
      userProfile,
      'Documents',
      'OpenClaw-Standalone',
      'mission-runner',
      'proof',
      'mission-operations',
    ))
    : '';
}

export async function readPublicMissionOperations(options = {}) {
  const env = options.env || process.env;
  const directory = options.directory || resolvePublicMissionOperationsDirectory(env);
  const feed = await readMissionOperations({ ...options, env, directory });
  const publicFeed = {
    ...feed,
    directory: feed.directory ? 'configured-external-receipt-directory' : '',
    missions: (feed.missions || []).map((mission) => ({
      ...mission,
      git: {
        ...mission.git,
        worktreePath: mission.git?.worktreePath ? 'configured-isolated-worktree' : '',
      },
      approvals: (mission.approvals || []).map(publicApproval),
      receipts: (mission.receipts || []).map((receipt) => ({
        ...receipt,
        path: publicReceiptPath(receipt.path),
      })),
    })),
  };
  return sanitizePublicValue(publicFeed);
}
