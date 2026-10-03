#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import process from 'node:process';

const BASE_URL = 'http://127.0.0.1:11434';
const MODEL = 'qwen3.5:27b';
const EXPECTED = 'QWEN35_CANARY_OK';
const TIMEOUT_MS = 150_000;
const VR_GOVERNOR_STATE_PATH = resolve(homedir(), 'Documents', 'Stephanos-openclaw-workspace', 'vr', 'vr-resource-governor-current.json');

function readVrResourceGovernorBlock() {
  try {
    const state = JSON.parse(readFileSync(VR_GOVERNOR_STATE_PATH, 'utf8'));
    const blocked = state?.schemaVersion === 'stephanos.vr-resource-governor.v1'
      && state?.active === true
      && state?.localModelAllowed === false;
    return {
      blocked,
      phase: String(state?.phase || ''),
      reason: String(state?.reason || ''),
      loadedModelsAfter: Array.isArray(state?.loadedModelsAfter) ? state.loadedModelsAfter : [],
    };
  } catch {
    return { blocked: false, phase: '', reason: '', loadedModelsAfter: [] };
  }
}

async function unloadCanaryModel() {
  const unloadController = new AbortController();
  const unloadTimer = setTimeout(() => unloadController.abort(), 10_000);
  try {
    await fetch(`${BASE_URL}/api/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: unloadController.signal,
      body: JSON.stringify({ model: MODEL, keep_alive: 0 }),
    });
  } catch {
    // Best-effort cleanup. The VR governor remains the fail-closed backstop.
  } finally {
    clearTimeout(unloadTimer);
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

try {
  const vrBlock = readVrResourceGovernorBlock();
  if (vrBlock.blocked) {
    fail('QWEN35_CANARY_BLOCKED_BY_VR_RESOURCE_GOVERNOR', vrBlock);
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
          keep_alive: 0,
        }),
      });
      const elapsedMs = Date.now() - startedAt;
      if (!response.ok) {
        fail('QWEN35_GENERATION_FAILED', { status: response.status, elapsedMs });
      } else {
        const body = await response.json();
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
  }
  }
} catch (error) {
  fail(error?.name === 'AbortError' ? 'QWEN35_CANARY_TIMEOUT' : 'QWEN35_CANARY_ERROR', {
    error: String(error?.message || error),
  });
} finally {
  clearTimeout(timer);
  await unloadCanaryModel();
}
