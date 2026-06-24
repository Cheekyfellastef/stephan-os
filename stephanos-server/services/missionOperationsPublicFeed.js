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
  return {
    ...feed,
    directory: feed.directory ? 'configured-external-receipt-directory' : '',
    missions: (feed.missions || []).map((mission) => ({
      ...mission,
      git: {
        ...mission.git,
        worktreePath: mission.git?.worktreePath ? 'configured-isolated-worktree' : '',
      },
      receipts: (mission.receipts || []).map((receipt) => ({
        ...receipt,
        path: publicReceiptPath(receipt.path),
      })),
    })),
  };
}
