import { basename } from 'node:path';
import { readMissionOperations } from './missionOperationsService.js';

function publicReceiptPath(value = '') {
  const normalized = String(value || '').trim().replace(/\\/g, '/');
  const leaf = basename(normalized);
  return leaf ? `receipt://${leaf}` : '';
}

export async function readPublicMissionOperations(options = {}) {
  const feed = await readMissionOperations(options);
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
