import { createHash } from 'node:crypto';

export const PATCH_COURIER_V1_FORMAT = 'git-diff-base64';
export const PATCH_COURIER_V1_MAX_PATCH_BYTES = 256 * 1024;

export const PATCH_COURIER_V1_ALLOWED_COMMANDS = Object.freeze([
  'node --test shared/agents/patchCourierPacket.test.mjs',
  'npm run openclaw:github:test',
  'npm run stephanos:guard:pr-clean:local',
]);

const REQUIRED_STRING_FIELDS = Object.freeze([
  'repository',
  'issue',
  'pr',
  'baseBranch',
  'targetBranch',
  'expectedRemoteHead',
  'patchSha256',
  'proofCommand',
]);

const REQUIRED_ARRAY_FIELDS = Object.freeze([
  'changedFiles',
  'testsToRun',
  'blockers',
]);

const SAFE_REF_PATTERN = /^[A-Za-z0-9._/-]+$/;
const SAFE_SHA256_PATTERN = /^[a-f0-9]{64}$/;
const SAFE_REMOTE_HEAD_PATTERN = /^[a-f0-9]{40}$/;
const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

export function calculatePatchSha256(patchBase64) {
  return createHash('sha256').update(decodePatchBase64(patchBase64)).digest('hex');
}

export function decodePatchBase64(patchBase64) {
  if (typeof patchBase64 !== 'string' || patchBase64.length === 0 || !BASE64_PATTERN.test(patchBase64)) {
    throw new Error('patch must be non-empty base64');
  }
  return Buffer.from(patchBase64, 'base64');
}

export function validatePatchCourierPacket(packet, options = {}) {
  const blockers = [];
  const maxPatchBytes = options.maxPatchBytes ?? PATCH_COURIER_V1_MAX_PATCH_BYTES;
  const allowedCommands = new Set(options.allowedCommands ?? PATCH_COURIER_V1_ALLOWED_COMMANDS);

  if (!packet || typeof packet !== 'object' || Array.isArray(packet)) {
    return blocked(['packet must be an object']);
  }

  for (const field of REQUIRED_STRING_FIELDS) {
    if (typeof packet[field] !== 'string' || packet[field].trim() === '') {
      blockers.push(`${field} is required`);
    }
  }

  for (const field of REQUIRED_ARRAY_FIELDS) {
    if (!Array.isArray(packet[field])) {
      blockers.push(`${field} must be an array`);
    }
  }

  if (packet.patchFormat !== PATCH_COURIER_V1_FORMAT) {
    blockers.push(`patchFormat must be ${PATCH_COURIER_V1_FORMAT}`);
  }

  if (packet.operatorApprovalRequired !== true) {
    blockers.push('operatorApprovalRequired must be true and cannot be pre-approved by the courier');
  }
  if ('operatorApproved' in packet || 'approvalToken' in packet || 'approvedBy' in packet) {
    blockers.push('operator approval cannot be spoofed inside a patch courier packet');
  }

  if (typeof packet.baseBranch === 'string' && !SAFE_REF_PATTERN.test(packet.baseBranch)) {
    blockers.push('baseBranch contains unsafe characters');
  }
  if (typeof packet.targetBranch === 'string' && !SAFE_REF_PATTERN.test(packet.targetBranch)) {
    blockers.push('targetBranch contains unsafe characters');
  }
  if (typeof packet.expectedRemoteHead === 'string' && !SAFE_REMOTE_HEAD_PATTERN.test(packet.expectedRemoteHead)) {
    blockers.push('expectedRemoteHead must be a 40-character lowercase git sha');
  }
  if (typeof packet.patchSha256 === 'string' && !SAFE_SHA256_PATTERN.test(packet.patchSha256)) {
    blockers.push('patchSha256 must be a lowercase sha256 hex digest');
  }

  const patchBase64 = packet.patch;
  let decodedPatch;
  try {
    decodedPatch = decodePatchBase64(patchBase64);
    if (decodedPatch.byteLength > maxPatchBytes) {
      blockers.push(`patch exceeds max size of ${maxPatchBytes} bytes`);
    }
    if (typeof packet.patchSha256 === 'string' && SAFE_SHA256_PATTERN.test(packet.patchSha256)) {
      const actualSha = calculatePatchSha256(patchBase64);
      if (actualSha !== packet.patchSha256) {
        blockers.push('patchSha256 does not match patch payload');
      }
    }
  } catch (error) {
    blockers.push(error.message);
  }

  if (Array.isArray(packet.changedFiles)) {
    if (packet.changedFiles.length === 0) {
      blockers.push('changedFiles must not be empty');
    }
    for (const filePath of packet.changedFiles) {
      if (!isSafeRepositoryPath(filePath)) {
        blockers.push(`unsafe changedFiles path: ${String(filePath)}`);
      }
    }
  }

  for (const command of commandFields(packet)) {
    if (!allowedCommands.has(command)) {
      blockers.push(`command is not allowlisted: ${command}`);
    }
  }

  if (blockers.length > 0) {
    return blocked(blockers);
  }

  return {
    finalVerdict: 'PATCH_COURIER_PACKET_ACCEPTED',
    blockers: [],
    packet: canonicalPatchCourierPacket(packet),
  };
}

export function canonicalPatchCourierPacket(packet) {
  return {
    repository: packet.repository.trim(),
    issue: packet.issue.trim(),
    pr: packet.pr.trim(),
    baseBranch: packet.baseBranch.trim(),
    targetBranch: packet.targetBranch.trim(),
    expectedRemoteHead: packet.expectedRemoteHead.trim(),
    patchFormat: PATCH_COURIER_V1_FORMAT,
    patch: packet.patch,
    patchSha256: packet.patchSha256.trim(),
    changedFiles: [...packet.changedFiles],
    testsToRun: [...packet.testsToRun],
    proofCommand: packet.proofCommand.trim(),
    blockers: [...packet.blockers],
    operatorApprovalRequired: true,
  };
}

export function isSafeRepositoryPath(filePath) {
  return typeof filePath === 'string'
    && filePath.length > 0
    && filePath.length <= 240
    && !filePath.startsWith('/')
    && !filePath.startsWith('~')
    && !filePath.includes('\\')
    && !filePath.includes('\0')
    && !filePath.split('/').includes('..')
    && !filePath.split('/').includes('node_modules')
    && !filePath.startsWith('apps/stephanos/dist/');
}

function commandFields(packet) {
  const commands = [];
  if (Array.isArray(packet.testsToRun)) {
    commands.push(...packet.testsToRun.filter((command) => typeof command === 'string'));
  }
  if (typeof packet.proofCommand === 'string') {
    commands.push(packet.proofCommand);
  }
  return commands;
}

function blocked(blockers) {
  return {
    finalVerdict: 'BLOCKED',
    blockers: [...new Set(blockers)].sort(),
  };
}
