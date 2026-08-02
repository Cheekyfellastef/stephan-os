from pathlib import Path


def replace_once(path: Path, old: str, new: str, label: str) -> None:
    text = path.read_text(encoding='utf-8')
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected exactly one match, found {count}')
    path.write_text(text.replace(old, new, 1), encoding='utf-8')


main_path = Path('apps/music-tile/main.js')
replace_once(
    main_path,
    """async function forgetConversationTeaching(teachingId) {
  if (!beginMusicMemoryMutation()) return;
  const operationGeneration = musicOperationGeneration;
""",
    """async function forgetConversationTeaching(teachingId) {
  if (!beginMusicMemoryMutation()) return;
  const confirmedConversationState = musicConversationState;
  const isConfirmedConversationCurrent = () => musicConversationState === confirmedConversationState;
  const operationGeneration = musicOperationGeneration;
""",
    'forget revision capture',
)
replace_once(
    main_path,
    """    if (!teaching) {
      if (synchronization.changed) {
        musicConversationState.answer = 'That teaching was already forgotten on another device. The current Taste DNA projection is now refreshed.';
        musicConversationState.mode = 'forgotten';
        renderTasteDNA();
        renderCandidates();
        renderMusicIntelligenceCentre();
        renderMusicConversation();
      }
      return;
    }
""",
    """    if (!teaching) {
      if (synchronization.changed) {
        if (isConfirmedConversationCurrent()) {
          musicConversationState.answer = 'That teaching was already forgotten on another device. The current Taste DNA projection is now refreshed.';
          musicConversationState.mode = 'forgotten';
        }
        renderTasteDNA();
        renderCandidates();
        renderMusicIntelligenceCentre();
        if (isConfirmedConversationCurrent()) renderMusicConversation();
      }
      return;
    }
""",
    'forget already-removed branch',
)
replace_once(
    main_path,
    """    if (teaching.memoryPersisted && synchronization.authorityConfirmed !== true) {
      musicConversationState.answer = `I could not safely forget “${teaching.trait}” because the shared teaching index could not be confirmed. Nothing was changed.`;
      musicConversationState.mode = 'forget blocked';
      renderMusicConversation();
      return;
    }
""",
    """    if (teaching.memoryPersisted && synchronization.authorityConfirmed !== true) {
      if (isConfirmedConversationCurrent()) {
        musicConversationState.answer = `I could not safely forget “${teaching.trait}” because the shared teaching index could not be confirmed. Nothing was changed.`;
        musicConversationState.mode = 'forget blocked';
        renderMusicConversation();
      }
      return;
    }
""",
    'forget authority-blocked branch',
)
replace_once(
    main_path,
    """      if (revocation?.revoked !== true) {
        musicConversationState.answer = `I could not safely forget “${teaching.trait}” because its durable memory record was not revoked. Nothing was changed.`;
        musicConversationState.mode = 'forget blocked';
        renderMusicConversation();
        emitPresenceEvent({ kind: 'conversation_teaching_forget_blocked', severity: 'warning', summary: 'Music teaching forget blocked', impact: 'Durable memory revocation failed; local Taste DNA was left unchanged.' });
        return;
      }
""",
    """      if (revocation?.revoked !== true) {
        if (isConfirmedConversationCurrent()) {
          musicConversationState.answer = `I could not safely forget “${teaching.trait}” because its durable memory record was not revoked. Nothing was changed.`;
          musicConversationState.mode = 'forget blocked';
          renderMusicConversation();
        }
        emitPresenceEvent({ kind: 'conversation_teaching_forget_blocked', severity: 'warning', summary: 'Music teaching forget blocked', impact: 'Durable memory revocation failed; local Taste DNA was left unchanged.' });
        return;
      }
""",
    'forget revocation-blocked branch',
)
replace_once(
    main_path,
    """    state.candidates = rankCandidatesByTaste(state.candidates, buildTasteWeightsForState());
    musicConversationState.answer = `Forgotten: “${teaching.trait}”. Only that teaching's Taste DNA contribution was removed.`;
    musicConversationState.mode = 'forgotten';
    saveState();
    renderTasteDNA();
    renderCandidates();
    renderMusicIntelligenceCentre();
    renderMusicConversation();
""",
    """    state.candidates = rankCandidatesByTaste(state.candidates, buildTasteWeightsForState());
    const confirmedConversationIsCurrent = isConfirmedConversationCurrent();
    if (confirmedConversationIsCurrent) {
      musicConversationState.answer = `Forgotten: “${teaching.trait}”. Only that teaching's Taste DNA contribution was removed.`;
      musicConversationState.mode = 'forgotten';
    }
    saveState();
    renderTasteDNA();
    renderCandidates();
    renderMusicIntelligenceCentre();
    if (confirmedConversationIsCurrent) renderMusicConversation({ scrollToFinalAnswer: true });
""",
    'forget success branch',
)
replace_once(
    main_path,
    """async function resetAll() {
""",
    """function restoreInvalidatedMusicOperationControls({ conversationStatus = '' } = {}) {
  if (intelligenceUi.nativeSearchButton) intelligenceUi.nativeSearchButton.disabled = false;
  if (ui.buildImmersionSessionBtn) ui.buildImmersionSessionBtn.disabled = false;
  if (intelligenceUi.surpriseBtn) {
    intelligenceUi.surpriseBtn.disabled = false;
    intelligenceUi.surpriseBtn.classList.remove('is-loading');
    const title = intelligenceUi.surpriseBtn.querySelector('strong');
    const subtitle = intelligenceUi.surpriseBtn.querySelector('small');
    if (title) title.textContent = 'Surprise Me';
    if (subtitle) subtitle.textContent = 'Start my journey';
  }
  setMusicConversationBusy(false, conversationStatus);
}
async function resetAll() {
""",
    'reset control restoration helper',
)
replace_once(
    main_path,
    """      ui.status.textContent = 'Reset blocked: durable music memory could not be safely revoked.';
      renderMusicConversation();
""",
    """      ui.status.textContent = 'Reset blocked: durable music memory could not be safely revoked.';
      restoreInvalidatedMusicOperationControls({ conversationStatus: 'Reset blocked · controls restored.' });
      renderMusicConversation();
""",
    'blocked reset restores controls',
)
replace_once(
    main_path,
    """    if (intelligenceUi.nativeSearchButton) intelligenceUi.nativeSearchButton.disabled = false;
    if (ui.buildImmersionSessionBtn) ui.buildImmersionSessionBtn.disabled = false;
    if (intelligenceUi.surpriseBtn) {
      intelligenceUi.surpriseBtn.disabled = false;
      intelligenceUi.surpriseBtn.classList.remove('is-loading');
      const title = intelligenceUi.surpriseBtn.querySelector('strong');
      const subtitle = intelligenceUi.surpriseBtn.querySelector('small');
      if (title) title.textContent = 'Surprise Me';
      if (subtitle) subtitle.textContent = 'Start my journey';
    }
    setMusicConversationBusy(false);
""",
    """    restoreInvalidatedMusicOperationControls();
""",
    'successful reset uses shared control restoration',
)

memory_path = Path('shared/runtime/stephanosMemory.mjs')
replace_once(
    memory_path,
    """  async function refreshAuthority() {
    if (!preferSharedBackend || typeof fetchImpl !== 'function') {
      throw Object.assign(new Error('Shared durable memory backend is unavailable.'), { code: 'durable-memory-authority-unavailable' });
    }
    return enqueueBackendOperation(async () => {
      const response = await rehydrateAuthority({ conflict: false });
      hydrated = true;
      return {
        authorityConfirmed: true,
        source: 'shared-backend',
        resolvedBackendUrl: response.baseUrl,
      };
    });
  }
""",
    """  async function refreshAuthority() {
    if (!preferSharedBackend || typeof fetchImpl !== 'function') {
      throw Object.assign(new Error('Shared durable memory backend is unavailable.'), { code: 'durable-memory-authority-unavailable' });
    }
    return enqueueBackendOperation(async () => {
      const response = await rehydrateAuthority({ conflict: false });
      hydrated = true;
      return {
        authorityConfirmed: true,
        source: 'shared-backend',
        resolvedBackendUrl: response.baseUrl,
        state: normalizeMemoryState(authoritativeState),
      };
    });
  }
""",
    'authority refresh receipt snapshot',
)
replace_once(
    memory_path,
    """  function listRecords(filters = {}) {
    const state = adapter.readState();
""",
    """  function listRecords(filters = {}, memoryState = adapter.readState()) {
    const state = memoryState;
""",
    'list records state parameter',
)
replace_once(
    memory_path,
    """        records: receipt?.authorityConfirmed === true ? listRecords(filters) : [],
""",
    """        records: receipt?.authorityConfirmed === true ? listRecords(filters, receipt.state) : [],
""",
    'durable listing authoritative snapshot',
)

Path('tests/music-tile-current-head-safety.test.mjs').write_text("""import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const main = await readFile(new URL('../apps/music-tile/main.js', import.meta.url), 'utf8');

function functionSlice(startMarker, endMarker) {
  const start = main.indexOf(startMarker);
  const end = main.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, `${startMarker} must be present and bounded`);
  return main.slice(start, end);
}

test('durable Forget completion cannot replace a newer conversation answer', () => {
  const forgetting = functionSlice(
    'async function forgetConversationTeaching',
    '\\n\\nfunction getJourneySeedArtist',
  );
  assert.match(forgetting, /const confirmedConversationState = musicConversationState/);
  assert.match(forgetting, /const isConfirmedConversationCurrent = \\(\\) => musicConversationState === confirmedConversationState/);
  assert.match(forgetting, /const confirmedConversationIsCurrent = isConfirmedConversationCurrent\\(\\)/);
  assert.match(forgetting, /if \\(confirmedConversationIsCurrent\\) \\{[\\s\\S]*musicConversationState\\.answer = `Forgotten:/);
  assert.match(forgetting, /if \\(isConfirmedConversationCurrent\\(\\)\\) \\{[\\s\\S]*musicConversationState\\.mode = 'forget blocked'/);
  assert.match(forgetting, /if \\(confirmedConversationIsCurrent\\) renderMusicConversation\\(\\{ scrollToFinalAnswer: true \\}\\)/);
});

test('blocked Reset restores every control invalidated by its generation bump', () => {
  const reset = functionSlice(
    'function restoreInvalidatedMusicOperationControls',
    '\\nfunction renderAll',
  );
  assert.match(reset, /nativeSearchButton\\) intelligenceUi\\.nativeSearchButton\\.disabled = false/);
  assert.match(reset, /buildImmersionSessionBtn\\) ui\\.buildImmersionSessionBtn\\.disabled = false/);
  assert.match(reset, /surpriseBtn\\.classList\\.remove\\('is-loading'\\)/);
  assert.match(reset, /setMusicConversationBusy\\(false, conversationStatus\\)/);
  assert.match(reset, /if \\(!revocation\\.ok\\) \\{[\\s\\S]*restoreInvalidatedMusicOperationControls\\(\\{ conversationStatus: 'Reset blocked · controls restored\\.' \\}\\)/);
  assert.match(reset, /musicConversationState = createIdleMusicConversationState\\(\\)[\\s\\S]*restoreInvalidatedMusicOperationControls\\(\\)/);
});
""", encoding='utf-8')

Path('shared/runtime/stephanosMemory.authoritative-listing.test.mjs').write_text("""import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createStephanosMemory,
  createStephanosSharedMemoryAdapter,
} from './stephanosMemory.mjs';

function createStorage(entries = {}) {
  const store = new Map(Object.entries(entries));
  return {
    getItem(key) { return store.has(key) ? store.get(key) : null; },
    setItem(key, value) { store.set(key, String(value)); },
    removeItem(key) { store.delete(key); },
  };
}

function record(summary, source) {
  return {
    schemaVersion: 2,
    type: 'operator.preference',
    source,
    scope: 'runtime',
    summary,
    payload: { value: summary },
    tags: ['explicit-teaching'],
    importance: 'normal',
    retentionHint: 'default',
    createdAt: '2026-08-02T20:00:00.000Z',
    updatedAt: '2026-08-02T20:00:00.000Z',
    surface: 'hosted',
  };
}

test('durable listings exclude pending local intents from authoritative truth', async () => {
  const storage = createStorage();
  const remoteState = {
    schemaVersion: 2,
    updatedAt: '2026-08-02T20:01:00.000Z',
    records: {
      'continuity::remote': record('Remote confirmed preference', 'remote-device'),
    },
  };
  const methods = [];
  const fetchImpl = async (_url, options = {}) => {
    const method = options.method || 'GET';
    methods.push(method);
    if (method === 'PUT') {
      const error = new Error('simulated backend save failure');
      error.code = 'simulated-save-failure';
      throw error;
    }
    return {
      ok: true,
      status: 200,
      async text() {
        return JSON.stringify({ success: true, data: remoteState });
      },
    };
  };
  const adapter = createStephanosSharedMemoryAdapter({
    fetchImpl,
    storage,
    logger: { info() {} },
  });

  adapter.writeState({
    schemaVersion: 2,
    updatedAt: '2026-08-02T20:00:30.000Z',
    records: {
      'continuity::pending-local': record('Pending local preference', 'local-device'),
    },
  });

  const refreshReceipt = await adapter.refreshAuthority();
  assert.equal(refreshReceipt.authorityConfirmed, true);
  assert.deepEqual(Object.keys(refreshReceipt.state.records), ['continuity::remote']);
  assert.deepEqual(
    Object.keys(adapter.readState().records).sort(),
    ['continuity::pending-local', 'continuity::remote'],
  );

  const memory = createStephanosMemory({ adapter, source: 'test', surface: 'hosted' });
  const listing = await memory.listRecordsDurably({ namespace: 'continuity' });

  assert.equal(listing.authorityConfirmed, true);
  assert.deepEqual(listing.records.map((entry) => entry.id), ['remote']);
  assert.equal(Object.hasOwn(listing.receipt, 'state'), false);
  assert.ok(methods.includes('PUT'));
  assert.ok(methods.filter((method) => method === 'GET').length >= 2);
});
""", encoding='utf-8')
