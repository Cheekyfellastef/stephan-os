#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import {
  buildFixedBattleBridgeBootstrapEncodedCommand,
  validateBattleBridgeTailscaleBootstrapReceipt,
  validateGitHubEventFile,
} from '../shared/agents/battleBridgeTailscaleBootstrapPipeV1.mjs';

function text(value) {
  return String(value ?? '').trim();
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exitCode = 2;
}

const [mode, ...args] = process.argv.slice(2);

if (mode === 'validate-event') {
  const [eventPath, currentMainHead] = args;
  if (!eventPath || !/^[0-9a-f]{40}$/i.test(text(currentMainHead))) {
    fail('validate-event requires event path and exact current main head.');
  } else {
    try {
      const result = validateGitHubEventFile(eventPath, { currentMainHead: text(currentMainHead).toLowerCase() });
      if (!result.ok) fail(result.blocker || 'TAILSCALE_BOOTSTRAP_EVENT_BLOCKED');
      else process.stdout.write(`${JSON.stringify(result)}\n`);
    } catch (error) {
      fail(`TAILSCALE_BOOTSTRAP_EVENT_INVALID:${error?.message || String(error)}`);
    }
  }
} else if (mode === 'encoded-command') {
  const [expectedHead] = args;
  try {
    process.stdout.write(`${buildFixedBattleBridgeBootstrapEncodedCommand(text(expectedHead).toLowerCase())}\n`);
  } catch (error) {
    fail(`TAILSCALE_BOOTSTRAP_COMMAND_BUILD_FAILED:${error?.message || String(error)}`);
  }
} else if (mode === 'validate-receipt') {
  const [expectedHead, receiptPath] = args;
  if (!receiptPath) fail('validate-receipt requires exact expected head and receipt path.');
  else {
    try {
      const lines = readFileSync(receiptPath, 'utf8').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
      let receipt = null;
      for (let index = lines.length - 1; index >= 0; index -= 1) {
        try {
          const parsed = JSON.parse(lines[index]);
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) { receipt = parsed; break; }
        } catch {}
      }
      if (!receipt || !validateBattleBridgeTailscaleBootstrapReceipt(receipt, text(expectedHead).toLowerCase())) {
        fail('TAILSCALE_BOOTSTRAP_RECEIPT_INVALID');
      } else {
        process.stdout.write(`${JSON.stringify(receipt)}\n`);
      }
    } catch (error) {
      fail(`TAILSCALE_BOOTSTRAP_RECEIPT_READ_FAILED:${error?.message || String(error)}`);
    }
  }
} else {
  fail('Usage: battle-bridge-tailscale-bootstrap-pipe.mjs validate-event|encoded-command|validate-receipt ...');
}
