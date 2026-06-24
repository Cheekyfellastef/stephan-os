import { resolve } from 'node:path';
import { readMissionOperations } from '../stephanos-server/services/missionOperationsService.js';

function finish(payload, exitCode = 0) {
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  process.exit(exitCode);
}

const directory = process.argv[2] ? resolve(process.argv[2]) : '';
const missionId = String(process.argv[3] || '').trim();
if (!directory || !missionId) {
  finish({
    finalVerdict: 'BLOCKED',
    message: 'Usage: node scripts/verify-mission-operations-receipt.mjs <receipt-directory> <mission-id>',
  }, 1);
}

const feed = await readMissionOperations({ directory, now: new Date() });
const mission = feed.missions.find((candidate) => candidate.mission?.missionId === missionId);
const complete = mission?.mission?.state === 'COMPLETE';
const receiptCount = Array.isArray(mission?.receipts) ? mission.receipts.length : 0;
const valid = feed.status === 'ready'
  && Boolean(mission)
  && complete
  && receiptCount > 0
  && mission.mission.finalVerdict === 'OPENCLAW_GITHUB_OPERATION_PASS';

finish({
  schemaVersion: 'stephanos.mission-operations-acceptance.v1',
  missionId,
  feedStatus: feed.status,
  acceptedReceiptCount: feed.acceptedReceiptCount,
  missionFound: Boolean(mission),
  missionState: mission?.mission?.state || '',
  missionVerdict: mission?.mission?.finalVerdict || '',
  receiptCount,
  nextAction: mission?.mission?.nextAction || feed.recommendedNextAction || '',
  finalVerdict: valid
    ? 'STEPHANOS_MISSION_OPERATIONS_ACCEPTANCE_PASS'
    : 'STEPHANOS_MISSION_OPERATIONS_ACCEPTANCE_BLOCKED',
}, valid ? 0 : 1);
