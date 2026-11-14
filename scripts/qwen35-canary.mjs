#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import process from 'node:process';
import { classifyQwen35CanaryGovernorV1 } from '../shared/agents/qwen35CanaryGovernorAdmissionV1.mjs';

const BASE_URL = 'http://127.0.0.1:11434';
const MODEL = 'qwen3.5:27b';
const EXPECTED = 'QWEN35_CANARY_OK';
const TIMEOUT_MS = 150_000;
const VR_GOVERNOR_STATE_PATH = resolve(homedir(), 'Documents', 'Stephanos-openclaw-workspace', 'vr', 'vr-resource-governor-current.json');

function readVrResourceGovernorBlock() {
  try {
    return classifyQwen35CanaryGovernorV1(
      JSON.parse(readFileSync(VR_GOVERNOR_STATE_PATH, 'utf8')),
    );
  } catch {
    // Missing, unreadable and malformed governor data are UNKNOWN, never idle.
    return classifyQwen35CanaryGovernorV1(null);
  }
}


function fail(blocker, details = {}) {
  process.stdout.write(`${JSON.stringify({
    schemaVersion: 'stephanos.qwen35-canary.v1',
    ok: false,
    model: MODEL,
    blocker,
    ...details,
  })}\n`);
  process.exitCode = 2;
}

const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
let gamingRevocationBlocker = '';

// The fixed VR governor can revoke consent while the Ollama chat awaits a
// response. A one-time preflight is not a live gaming-preemption contract.
function abortIfGamingRevoked() {
  const current = readVrResourceGovernorBlock();
  if (!current.blocked) return false;
  gamingRevocationBlocker = current.blocker || 'QWEN35_CANARY_GOVERNOR_UNPROVEN';
  controller.abort();
  return true;
}

try {
  const vrBlock = readVrResourceGovernorBlock();
  if (vrBlock.blocked) {
    fail(vrBlock.blocker);
  } else {
  const tagsResponse = await fetch(`${BASE_URL}/api/tags`, { signal: controller.signal });
  if (!tagsResponse.ok) {
    fail('OLLAMA_TAGS_UNAVAILABLE', { status: tagsResponse.status });
  } else {
    const tags = await tagsResponse.json();
    const models = Array.isArray(tags?.models) ? tags.models.map((item) => String(item?.name || '')) : [];
    if (!models.includes(MODEL)) {
      fail('QWEN35_MODEL_NOT_INSTALLED', { availableModels: models });
    } else {
      // A gaming transition can occur while the Ollama catalog is read.
      // Re-check the same fixed local governor before starting the 27B load.
      const beforeInference = readVrResourceGovernorBlock();
      if (beforeInference.blocked) {
        fail(beforeInference.blocker);
      } else {
      // Stop an in-flight request if gaming protection becomes active OR
      // the observer stops supplying fresh proof. This requests cancellation;
      // it does not claim server-side inference or model eviction stopped.
      const governorPoll = setInterval(abortIfGamingRevoked, 1_000);
      governorPoll.unref?.();
      try {
      const startedAt = Date.now();
      const response = await fetch(`${BASE_URL}/api/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          model: MODEL,
          stream: false,
          messages: [{ role: 'user', content: `Reply with exactly: ${EXPECTED}` }],
          options: { temperature: 0 },
        }),
      });
      const elapsedMs = Date.now() - startedAt;
      if (abortIfGamingRevoked()) {
        fail(gamingRevocationBlocker, { elapsedMs });
      } else if (!response.ok) {
        fail('QWEN35_GENERATION_FAILED', { status: response.status, elapsedMs });
      } else {
        const body = await response.json();
        // Even a completed HTTP response cannot certify continued permission.
        // Do not emit GREEN if gaming started during inference or body parsing.
        if (abortIfGamingRevoked()) {
          fail(gamingRevocationBlocker, { elapsedMs });
        } else {
        const content = String(body?.message?.content || '').trim();
        const passed = content === EXPECTED;
        process.stdout.write(`${JSON.stringify({
          schemaVersion: 'stephanos.qwen35-canary.v1',
          ok: passed,
          model: String(body?.model || MODEL),
          expected: EXPECTED,
          response: content,
          elapsedMs,
          finalVerdict: passed ? 'QWEN35_CANARY_GREEN' : 'QWEN35_CANARY_RESPONSE_MISMATCH',
        })}\n`);
        if (!passed) process.exitCode = 3;
        }
      }
      } finally {
        clearInterval(governorPoll);
      }
      }
    }
  }
  }
} catch (error) {
  if (gamingRevocationBlocker) {
    // The observer's proof failed first; a cancellation transport exception
    // must not hide that cause or turn into a model-success report.
    fail(gamingRevocationBlocker);
  } else {
    fail(error?.name === 'AbortError' ? 'QWEN35_CANARY_TIMEOUT' : 'QWEN35_CANARY_ERROR', {
      error: String(error?.message || error),
    });
  }
} finally {
  clearTimeout(timer);
  // A canary cannot evict an unowned shared model; the VR governor owns cleanup.
}
