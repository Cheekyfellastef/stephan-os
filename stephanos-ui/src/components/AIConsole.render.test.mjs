import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs/promises';
import { importBundledModule, srcRoot } from '../test/renderHarness.mjs';

function createBaseStore(overrides = {}) {
  return {
    isBusy: false,
    provider: 'ollama',
    providerHealth: {},
    apiStatus: {
      state: 'ready',
      label: 'Backend reachable',
      detail: 'Diagnostics synced.',
      frontendOrigin: 'http://localhost:5173',
    },
    runtimeStatusModel: undefined,
    uiLayout: {
      commandDeck: true,
    },
    getActiveProviderConfig: () => ({ baseURL: '', model: 'llama3' }),
    setUiDiagnostics: () => {},
    togglePanel: () => {},
    lastExecutionMetadata: {
      chat_context_pack_status: 'active',
      chat_context_response_mode: 'merge-decision',
      chat_context_relevant_canon_count: 2,
      chat_context_ui_reality_status: 'OK',
      chat_context_mission_state: 'draft',
      chat_context_next_action: 'Collect merge proof before deciding',
      chat_context_provider_ids_used: 'uiReality|proofState|canonRules',
      chat_context_provider_registry_status: 'active',
      chat_context_provider_warning_count: 1,
    },
    ...overrides,
  };
}

const storeModulePath = path.join(srcRoot, 'test/mockAIStore.js');
const aliases = {
  '../state/aiStore': storeModulePath,
};

test('AIConsole renders mission console shell with internal message region and anchored input region', async () => {
  const { renderAIConsole } = await importBundledModule(
    path.join(srcRoot, 'test/renderAIConsoleEntry.jsx'),
    aliases,
    'ai-console-render',
  );
  globalThis.__STEPHANOS_TEST_AI_STORE__ = createBaseStore();

  const rendered = renderAIConsole();
  assert.match(rendered, /mission-console-shell/);
  assert.match(rendered, /data-testid="command-deck-root"/);
  assert.match(rendered, /data-testid="command-deck-body"/);
  assert.match(rendered, /data-testid="command-deck-answer-history"/);
  assert.match(rendered, /output-panel ai-console-messages/);
  assert.match(rendered, /command-form mission-console-input/);
  assert.match(rendered, /mission-console__input-row/);
  assert.match(rendered, /mission-console__action-row/);
  assert.match(rendered, /mission-console__safety-row/);
  assert.match(rendered, /Context Used/);
});

test('AIConsole scroll targeting binds to latest assistant answer pane ref rather than generic latest history item', async () => {
  const source = await fs.readFile(path.join(srcRoot, 'components/AIConsole.jsx'), 'utf8');
  assert.match(source, /latestAssistantAnswerRef/);
  assert.match(source, /scrollContainerEl\.scrollTo\(\{ top: nextScrollTop, behavior: 'auto' \}\)/);
  assert.match(source, /scrollIntoView\?\.\(\{ block: 'nearest', inline: 'nearest', behavior: 'smooth' \}\)/);
  assert.match(source, /data-testid=\{isLatestAssistantAnswer \? 'latest-assistant-answer-pane' : 'assistant-answer-pane'\}/);
  assert.match(source, /data-assistant-answer-id=\{String\(entry.id \|\| ''\)\}/);
  assert.match(source, /data-answer-final=\{entry\?\.stream_finalized === false \? 'false' : 'true'\}/);
  assert.match(source, /data-answer-role=\"assistant\"/);
});

test('Mission console collapsed panel body does not keep reserved height when hidden', async () => {
  const stylesSource = await fs.readFile(path.join(srcRoot, 'styles.css'), 'utf8');
  assert.match(stylesSource, /\.mission-console \.panel-body\[hidden\]\s*\{/);
  assert.match(stylesSource, /\.mission-console \.panel-body\[hidden\][\s\S]*display:\s*none;/m);
  assert.match(stylesSource, /\.mission-console \.panel-body\[hidden\][\s\S]*height:\s*0;/m);
});

test('assistant answer pane keeps text selection enabled for drag-copy operations', async () => {
  const stylesSource = await fs.readFile(path.join(srcRoot, 'styles.css'), 'utf8');
  assert.match(stylesSource, /\.assistant-answer-text\s*\{/);
  assert.match(stylesSource, /\.assistant-answer-text[\s\S]*user-select:\s*text;/m);
});

test('assistant answer pane enforces tall bounded scrolling region so long answers stay inside pane', async () => {
  const stylesSource = await fs.readFile(path.join(srcRoot, 'styles.css'), 'utf8');
  assert.match(stylesSource, /\.assistant-answer-text[\s\S]*min-height:\s*clamp\(8rem,\s*20vh,\s*14rem\);/m);
  assert.match(stylesSource, /\.assistant-answer-text[\s\S]*max-height:\s*min\(60vh,\s*42rem\);/m);
  assert.match(stylesSource, /\.assistant-answer-text[\s\S]*overflow-y:\s*auto;/m);
});


test('AIConsole renders copy buttons for historical and new assistant answer panes', async () => {
  const { renderAIConsole } = await importBundledModule(
    path.join(srcRoot, 'test/renderAIConsoleEntry.jsx'),
    aliases,
    'ai-console-copy-buttons',
  );
  globalThis.__STEPHANOS_TEST_AI_STORE__ = createBaseStore();

  const rendered = renderAIConsole({
    commandHistory: [
      {
        id: 'assistant-older',
        timestamp: '2026-04-05T08:00:00.000Z',
        raw_input: 'Earlier prompt',
        output_text: 'Older answer',
        route: 'assistant',
        response: { type: 'assistant_response', route: 'assistant', debug: { selected_subsystem: 'assistant' } },
        data_payload: { retrieval_truth: { source: 'history' } },
      },
      {
        id: 'tool-1',
        timestamp: '2026-04-05T08:05:00.000Z',
        raw_input: '/status',
        output_text: 'Tool output',
        route: 'status',
        response: { type: 'tool_result', route: 'status' },
      },
      {
        id: 'assistant-new',
        timestamp: '2026-04-05T08:10:00.000Z',
        raw_input: 'Latest prompt',
        output_text: 'Latest answer',
        route: 'assistant',
        response: { type: 'assistant_response', route: 'assistant', debug: { selected_subsystem: 'assistant' } },
      },
    ],
  });

  const answerCopyMatches = rendered.match(/aria-label="Copy answer"/g) || [];
  const debugCopyMatches = rendered.match(/aria-label="Copy debug payload"/g) || [];
  assert.equal(answerCopyMatches.length, 2);
  assert.equal(debugCopyMatches.length, 2);
  assert.match(rendered, /answer-pane-copy-button/);
  assert.match(rendered, /assistant-answer-text/);
});


test('AIConsole exposes Copy Perf Diagnostics control for AI core surface instrumentation', async () => {
  const source = await fs.readFile(path.join(srcRoot, 'components/AIConsole.jsx'), 'utf8');
  assert.match(source, /Copy Perf Diagnostics/);
  assert.match(source, /recordPerfCounter\('render', 'AIConsole'\)/);
  assert.match(source, /ai_core\.autoscroll_run/);
});

test('embedded mission console answer history keeps larger viewport and visible composer', async () => {
  const stylesSource = await fs.readFile(path.join(srcRoot, 'styles.css'), 'utf8');
  assert.match(stylesSource, /\.mission-console \.panel-body[\s\S]*min-height:\s*clamp\(20rem,\s*52vh,\s*36rem\);/m);
  assert.match(stylesSource, /\.mission-console \.panel-body[\s\S]*height:\s*auto;/m);
  assert.match(stylesSource, /\.mission-console \.panel-body[\s\S]*overflow-y:\s*visible;/m);
  assert.match(stylesSource, /\.mission-console-pane__body\.mission-console__history[\s\S]*flex:\s*1\s+1\s+auto;/m);
  assert.match(stylesSource, /\.mission-console-pane__body\.mission-console__history[\s\S]*min-height:\s*clamp\(19\.5rem,\s*50vh,\s*36rem\);/m);
  assert.match(stylesSource, /\.mission-console-pane__body\.mission-console__history[\s\S]*max-height:\s*clamp\(27rem,\s*74vh,\s*52rem\);/m);
  assert.match(stylesSource, /\.mission-console-pane__body\.mission-console__history[\s\S]*overflow-y:\s*auto;/m);
  assert.match(stylesSource, /\.mission-console-input,[\s\S]*\.mission-console__composer[\s\S]*flex-shrink:\s*0;/m);
});




test('AIConsole autoscroll diagnostics capture latest assistant pane targeting and fallback boundaries', async () => {
  const source = await fs.readFile(path.join(srcRoot, 'components/AIConsole.jsx'), 'utf8');
  assert.match(source, /targetKind = latestAssistantAnswerId \? 'latest-assistant-answer-pane' : 'none'/);
  assert.match(source, /method: 'inner-container-scroll\|outer-viewport-reveal'/);
  assert.match(source, /method: 'skipped-no-target-after-raf'/);
  assert.match(source, /aiConsoleAnswerScroll/);
  assert.match(source, /requestReason: 'final-assistant-answer-rendered'/);
  assert.match(source, /skipReason: 'same-answer-signature-already-scrolled'/);
  assert.match(source, /currentSignature/);
  assert.match(source, /effectFiredAt/);
  assert.match(source, /commandDeckComposerFound: 'no'/);
  assert.match(source, /latestAssistantAnswerDomFound: 'no'/);
  assert.match(source, /latestAnswerCardClientHeight/);
  assert.match(source, /answerViewportClientHeight/);
  assert.match(source, /answerViewportFitsLatestAnswer/);
  assert.match(source, /answerViewportFitVerdict/);
  assert.match(source, /long-answer-internal-scroll/);
});

test('latest assistant answer pane provides safe scroll margins', async () => {
  const stylesSource = await fs.readFile(path.join(srcRoot, 'styles.css'), 'utf8');
  assert.match(stylesSource, /\[data-testid="latest-assistant-answer-pane"\]\s*\{/);
  assert.match(stylesSource, /scroll-margin-top:\s*0\.75rem;/);
  assert.match(stylesSource, /scroll-margin-bottom:\s*1\.25rem;/);
});
test('AIConsole context indicator renders active merge-decision state from execution metadata', async () => {
  const { renderAIConsole } = await importBundledModule(
    path.join(srcRoot, 'test/renderAIConsoleEntry.jsx'),
    aliases,
    'ai-console-context-indicator',
  );
  globalThis.__STEPHANOS_TEST_AI_STORE__ = createBaseStore();
  const rendered = renderAIConsole();
  assert.match(rendered, /Context Pack: active/);
  assert.match(rendered, /Response Mode: merge-decision/);
  assert.match(rendered, /Envelope: unavailable/);
  assert.match(rendered, /UI Reality Status: OK/);
  assert.match(rendered, /Next Action: Collect merge proof before deciding/);
  assert.match(rendered, /Providers Used Count: 3/);
  assert.match(rendered, /Provider Registry: active/);
  assert.match(rendered, /Provider Warning Count: 1/);
  assert.match(rendered, /Mission Repair Loop: idle/);
  assert.match(rendered, /Codex Prompt: no/);
  assert.match(rendered, /Approval Required: yes/);
});


test('AIConsole context indicator can render active command envelope compactly', async () => {
  const { renderAIConsole } = await importBundledModule(
    path.join(srcRoot, 'test/renderAIConsoleEntry.jsx'),
    aliases,
    'ai-console-envelope-active',
  );
  globalThis.__STEPHANOS_TEST_AI_STORE__ = createBaseStore({
    lastExecutionMetadata: {
      command_envelope_status: 'active',
      command_envelope_response_mode: 'merge-decision',
      command_envelope_context_providers_used: 'uiReality|runtimeTruth|proofState',
      command_envelope_ui_reality_status: 'OK',
      command_envelope_execution_status: 'ok',
    },
  });
  const rendered = renderAIConsole();
  assert.match(rendered, /Envelope: active/);
  assert.match(rendered, /Response Mode: merge-decision/);
});


test('AIConsole context indicator includes response planner compact fields', async () => {
  const { renderAIConsole } = await importBundledModule(path.join(srcRoot, 'test/renderAIConsoleEntry.jsx'), aliases, 'ai-console-planner-indicator');
  globalThis.__STEPHANOS_TEST_AI_STORE__ = createBaseStore();
  const rendered = renderAIConsole();
  assert.match(rendered, /Response Planner:/);
  assert.match(rendered, /Answer Shape:/);
  assert.match(rendered, /Risk Level:/);
});


test('AIConsole renders codex dispatch prompt copy control and compact status', async () => {
  const { renderAIConsole } = await importBundledModule(path.join(srcRoot, 'test/renderAIConsoleEntry.jsx'), aliases, 'ai-console-codex-dispatch');
  globalThis.__STEPHANOS_TEST_AI_STORE__ = createBaseStore({
    lastExecutionMetadata: {
      command_envelope_codex_dispatch_status: 'ready-for-approval',
      command_envelope_codex_dispatch_packet_id: 'cdp_3',
      command_envelope_codex_dispatch_target_subsystems: 'ui|proof',
      command_envelope_codex_dispatch_approval_required: 'yes',
      codex_dispatch_prompt: 'do work',
    },
  });
  const rendered = renderAIConsole();
  assert.match(rendered, /Codex Dispatch Packet:/);
  assert.match(rendered, /Copy Codex Dispatch Prompt/);
});
