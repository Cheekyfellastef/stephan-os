#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import {
  buildBattleBridgeTailscalePrerequisiteReceipt,
  buildBattleBridgeTailscalePrerequisiteSettingsProof,
  buildFixedBattleBridgePrerequisiteProbeEncodedCommand,
  validateGitHubPrerequisiteEventFile,
} from '../shared/agents/battleBridgeTailscalePrerequisiteProofV1.mjs';

function text(value) {
  return String(value ?? '').trim();
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exitCode = 2;
}

function readLastJsonObject(path) {
  const lines = readFileSync(path, 'utf8').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      const parsed = JSON.parse(lines[index]);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    } catch {}
  }
  return null;
}

const [mode, ...args] = process.argv.slice(2);

if (mode === 'validate-event') {
  const [eventPath, currentMainHead] = args;
  if (!eventPath || !/^[0-9a-f]{40}$/i.test(text(currentMainHead))) {
    fail('validate-event requires event path and exact current main head.');
  } else {
    try {
      const result = validateGitHubPrerequisiteEventFile(eventPath, { currentMainHead: text(currentMainHead).toLowerCase() });
      if (!result.ok) fail(result.blocker || 'TAILSCALE_BOOTSTRAP_PREREQUISITE_EVENT_BLOCKED');
      else process.stdout.write(`${JSON.stringify(result)}\n`);
    } catch (error) {
      fail(`TAILSCALE_BOOTSTRAP_PREREQUISITE_EVENT_INVALID:${error?.message || String(error)}`);
    }
  }
} else if (mode === 'settings-proof') {
  const [expectedHead] = args;
  try {
    const proof = buildBattleBridgeTailscalePrerequisiteSettingsProof(text(expectedHead).toLowerCase(), {
      tsOauthClientId: process.env.TS_CLIENT_ID,
      tsAudience: process.env.TS_AUDIENCE_VALUE,
      sshPrivateKey: process.env.SSH_PRIVATE_KEY,
      sshKnownHosts: process.env.SSH_KNOWN_HOSTS,
      bootstrapHost: process.env.BOOTSTRAP_HOST,
      bootstrapUser: process.env.BOOTSTRAP_USER,
    });
    process.stdout.write(`${JSON.stringify(proof)}\n`);
  } catch (error) {
    fail(`TAILSCALE_BOOTSTRAP_PREREQUISITE_SETTINGS_PROOF_FAILED:${error?.message || String(error)}`);
  }
} else if (mode === 'encoded-command') {
  const [expectedHead] = args;
  try {
    process.stdout.write(`${buildFixedBattleBridgePrerequisiteProbeEncodedCommand(text(expectedHead).toLowerCase())}\n`);
  } catch (error) {
    fail(`TAILSCALE_BOOTSTRAP_PREREQUISITE_COMMAND_BUILD_FAILED:${error?.message || String(error)}`);
  }
} else if (mode === 'validate-receipt') {
  const [expectedHead, settingsPath, remoteReceiptPath] = args;
  if (!settingsPath || !remoteReceiptPath) fail('validate-receipt requires exact expected head, settings proof path and remote receipt path.');
  else {
    try {
      const settingsProof = readLastJsonObject(settingsPath);
      const remoteReceipt = readLastJsonObject(remoteReceiptPath);
      const receipt = buildBattleBridgeTailscalePrerequisiteReceipt(settingsProof, remoteReceipt, text(expectedHead).toLowerCase());
      if (!receipt.ok) fail(receipt.blocker || 'TAILSCALE_BOOTSTRAP_PREREQUISITE_RECEIPT_INVALID');
      else process.stdout.write(`${JSON.stringify(receipt)}\n`);
    } catch (error) {
      fail(`TAILSCALE_BOOTSTRAP_PREREQUISITE_RECEIPT_READ_FAILED:${error?.message || String(error)}`);
    }
  }
} else {
  fail('Usage: battle-bridge-tailscale-prerequisite-proof.mjs validate-event|settings-proof|encoded-command|validate-receipt ...');
}
