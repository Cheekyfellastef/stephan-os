import { queryStephanosAI } from '../../shared/ai/stephanosClient.mjs';
import { requestStephanosBackend } from '../../shared/runtime/backendClient.mjs';

const agents = [
  { id:'everyone', label:'Everyone', icon:'◎', subtitle:'Stephanos AI · whole project', kind:'agent' },
  { id:'sovereign-commander', label:'Sovereign Commander', icon:'♛', subtitle:'Battle Bridge · guarded command', kind:'agent' },
  { id:'flywheel', label:'Flywheel', icon:'◉', subtitle:'Learning · uplift · improvement', kind:'agent' },
  { id:'openclaw-local', label:'OpenClaw Local', icon:'⬡', subtitle:'Stephanos-scoped local worker', kind:'agent' },
  { id:'openclaw-standalone', label:'OpenClaw Standalone', icon:'◇', subtitle:'Whole-PC guarded worker', kind:'agent' },
  { id:'vr-agent', label:'VR Agent', icon:'◫', subtitle:'VR research · telemetry · spatial', kind:'agent' },
  { id:'builders', label:'Builders', icon:'⚒', subtitle:'Build fabric · lanes · proof', kind:'agent' },
  { id:'controllers', label:'Controllers', icon:'≡', subtitle:'Mission loops · orchestration', kind:'agent' },
  { id:'research', label:'Research', icon:'⌕', subtitle:'Evidence · synthesis · discovery', kind:'agent' },
  { id:'battle-bridge', label:'Battle Bridge', icon:'⌾', subtitle:'Runtime · telemetry · machine truth', kind:'agent' },
];

const groups = [
  { id:'vr-team', label:'VR Team', icon:'◫', subtitle:'VR Agent + telemetry + builders', kind:'group' },
  { id:'builder-team', label:'Builders', icon:'⚒', subtitle:'Build and proof lanes', kind:'group' },
  { id:'controller-team', label:'Controllers', icon:'≡', subtitle:'Controllers and mission fabric', kind:'group' },
];

// One shared canonical conversation, independent of which agent is addressed.
const canonicalHistory = [];
const PENDING_KEY = 'stephanos.ai.pending-turn.v1';
let pendingDraft = null;
let selected = agents[0];
let busy = false;

const $ = (id) => document.getElementById(id);
const agentList = $('agentList');
const groupList = $('groupList');
const messages = $('messages');
const prompt = $('prompt');
const composer = $('composer');
const sendButton = $('sendButton');
const bridgeStatus = $('bridgeStatus');
const memoryStatus = $('memoryStatus');
const reloadThread = $('reloadThread');
const releaseDraft = $('releaseDraft');

function readPendingDraft() {
  try {
    const value = JSON.parse(localStorage.getItem(PENDING_KEY) || 'null');
    if (value && typeof value.text === 'string' && typeof value.turnId === 'string'
      && (value.turnId === '' || /^[a-z0-9._:-]{1,128}$/i.test(value.turnId)) && value.text.length <= 6000) return value;
  } catch { /* Storage might be disabled on a private browser. */ }
  return null;
}

function writePendingDraft(value) {
  pendingDraft = value;
  if (releaseDraft) releaseDraft.hidden = !value;
  try {
    if (value) localStorage.setItem(PENDING_KEY, JSON.stringify(value));
    else localStorage.removeItem(PENDING_KEY);
  } catch {
    memoryStatus.textContent = 'Device draft storage unavailable';
    memoryStatus.dataset.state = 'unavailable';
  }
}

async function createPendingDraft(text, addressLabel) {
  const requestId = 'stephanos-ai-' + (globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const bytes = new TextEncoder().encode(requestId);
  let turnId = '';
  if (globalThis.crypto?.subtle?.digest) {
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    turnId = 'operator-' + [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 24);
  }
  return { text, addressLabel, requestId, turnId, createdAtUtc: new Date().toISOString() };
}

function showPendingStatus() {
  if (pendingDraft) {
    memoryStatus.dataset.state = 'checking';
    memoryStatus.textContent = 'Unconfirmed turn saved on device';
  }
}


function surfaceKind() {
  if (navigator.maxTouchPoints > 0) return window.innerWidth < 760 ? 'iphone' : 'ipad';
  return 'desktop-browser';
}

// Probe from the actual browser. Backend health is not proof of identical UI assets.
async function probeBackendBridge() {
  $('frontendOrigin').textContent = window.location.host || 'unknown';
  bridgeStatus.dataset.state = 'checking';
  bridgeStatus.textContent = 'Backend · checking';
  try {
    const response = await requestStephanosBackend({
      path: '/api/health',
      timeoutMs: 5000,
      runtimeContext: { surface: surfaceKind(), workspace: 'stephanos-ai' },
    });
    bridgeStatus.dataset.state = 'reachable';
    bridgeStatus.textContent = 'Backend reachable';
    $('backendRoute').textContent = new URL(response.baseUrl).host;
  } catch (error) {
    bridgeStatus.dataset.state = 'unavailable';
    bridgeStatus.textContent = `Backend unavailable (${error?.code || 'network'})`;
    bridgeStatus.title = error?.message || 'Backend route not proven';
    $('backendRoute').textContent = error?.code || 'unreachable';
  }
}


function historyFor(_id) {
  return canonicalHistory;
}

function targetPrompt(text) {
  if (selected.id === 'everyone') return text;
  return `[Stephanos AI addressed target: ${selected.label} (${selected.id})]\n${text}`;
}

function makeButton(item) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'agent-button';
  button.dataset.target = item.id;
  button.innerHTML = `
    <span class="agent-icon">${item.icon}</span>
    <span class="agent-copy"><b>${item.label}</b><small>${item.subtitle}</small></span>
    <span class="status-dot unknown" aria-label="Presence not yet proven"></span>`;
  button.addEventListener('click', () => selectTarget(item, { focus: true }));
  return button;
}

function renderNav() {
  agentList.replaceChildren(...agents.map(makeButton));
  groupList.replaceChildren(...groups.map(makeButton));
  updateNavSelection();
}

function updateNavSelection() {
  document.querySelectorAll('.agent-button').forEach((button) => {
    button.classList.toggle('active', button.dataset.target === selected.id);
  });
}

function selectTarget(item, { focus = false } = {}) {
  selected = item;
  updateNavSelection();
  $('routeLabel').textContent = 'Canonical AI route';
  $('targetTitle').textContent = item.id === 'everyone' ? 'Stephanos AI' : item.label;
  $('targetSubtitle').textContent = item.id === 'everyone'
    ? 'Chat with the whole project, agents, and teams.'
    : `Address ${item.label} through the shared Stephanos conversation route.`;
  $('addressChip').textContent = item.label;
  $('contextTarget').textContent = item.label;
  $('presenceTruth').textContent = item.id === 'everyone' ? 'project conversation route' : 'addressed identity; direct presence unproven';
  prompt.placeholder = item.id === 'everyone' ? 'Message Stephanos AI…' : `Message ${item.label}…`;
  renderMessages({ forceBottom: true });
  // Do not summon the iPad software keyboard on workspace load or agent selection.
  if (focus && window.matchMedia?.('(pointer: fine)')?.matches) prompt.focus();
}

function escapeText(value='') {
  const span = document.createElement('span');
  span.textContent = String(value);
  return span.innerHTML;
}

function renderMessages({ forceBottom = false } = {}) {
  const history = historyFor(selected.id).slice(-64);
  const bottomDistance = messages.scrollHeight - messages.scrollTop - messages.clientHeight;
  const atBottom = forceBottom || bottomDistance < 90 || messages.childElementCount === 0;
  document.body.classList.toggle('has-messages', history.length > 0);
  messages.innerHTML = history.map((entry) => `
    <article class="message ${entry.role}">
      <span class="meta">${entry.role === 'user' ? 'YOU' : escapeText(entry.author || 'STEPHANOS AI')}${entry.routeNote ? ` · ${escapeText(entry.routeNote)}` : ''}</span>
      ${escapeText(entry.text)}
    </article>`).join('');
  if (atBottom) messages.scrollTop = messages.scrollHeight;
}

function translateTurn(turn) {
  const participant = turn.senderParticipantId;
  const shownText = participant === 'operator'
    ? String(turn.text || '').replace(/^\[Stephanos AI addressed target: [^\n]+\]\n/, '')
    : turn.text;
  return {
    turnId: turn.turnId,
    role: participant === 'operator' ? 'user' : 'assistant',
    author: participant === 'chatgpt-bridge' ? 'ChatGPT' : participant === 'stephanos' ? 'Stephanos AI' : 'You',
    text: shownText,
  };
}

/** Reload the canonical thread from the Battle Bridge backend, never browser-local chat history. */
async function loadCanonicalThread() {
  memoryStatus.dataset.state = 'checking';
  memoryStatus.textContent = 'Memory · checking';
  try {
    const result = await requestStephanosBackend({
      path: '/api/ai/shared-thread',
      timeoutMs: 10000,
      runtimeContext: { surface: surfaceKind(), workspace: 'stephanos-ai' },
    });
    const data = result.json?.data;
    if (!result.json?.success || !data?.ok || !Array.isArray(data.turns)) {
      throw new Error(data?.classification || 'canonical-thread-unavailable');
    }
    const turns = data.turns;
    canonicalHistory.splice(0, canonicalHistory.length, ...turns.map(translateTurn));
    if (pendingDraft?.turnId && turns.some((turn) =>
      turn.turnId === pendingDraft.turnId && turn.senderParticipantId === 'operator')) {
      writePendingDraft(null);
      prompt.value = '';
      autoGrow();
    }
    memoryStatus.dataset.state = pendingDraft ? 'checking' : 'reachable';
    memoryStatus.textContent = pendingDraft
      ? 'Unconfirmed turn · check before retry'
      : `Memory · ${data.totalRetained || 0} durable turns`;
    $('threadTruth').textContent = data.threadId || 'unknown';
    renderMessages({ forceBottom: canonicalHistory.length > 0 });
    return true;
  } catch (error) {
    memoryStatus.dataset.state = 'unavailable';
    memoryStatus.textContent = 'Memory unavailable · not synced';
    memoryStatus.title = error?.message || 'Cannot recover canonical conversation';
    $('threadTruth').textContent = 'unavailable';
    showPendingStatus();
    return false;
  }
}

function extractReply(result) {
  return result?.output_text
    || result?.data?.output_text
    || result?.response
    || result?.message
    || result?.data?.message
    || 'Stephanos returned a response without displayable text.';
}

function routingTruth(result) {
  return result?.data?.conversation_routing || null;
}

function noteRouteTruth(result) {
  const routing = routingTruth(result);
  $('routerTruth').textContent = routing?.routeState || 'observed via canonical client';
  $('healthDot').classList.remove('unknown');
  $('healthDot').classList.add('live');
  const provider = result?.debug?.actual_provider_used
    || result?.debug?.provider
    || result?.data?.actual_provider_used
    || '';
  $('lastResponse').textContent = provider ? `received · ${provider}` : 'received';
  const contributors = routing?.selectedContributors || [];
  const contributorLabels = contributors.map((entry) => entry.label).filter(Boolean);
  $('presenceTruth').textContent = routing?.directParticipantDispatchProven
    ? 'direct participant dispatch proven'
    : contributorLabels.length > 0
      ? `Stephanos synthesis · ${contributorLabels.join(' + ')}`
      : 'Stephanos direct';
  $('routeLabel').textContent = contributorLabels.length > 0
    ? `Stephanos AI · ${contributorLabels.join(' + ')}`
    : 'Stephanos AI';
  const selectedDot = document.querySelector(`.agent-button[data-target="${selected.id}"] .status-dot`);
  selectedDot?.classList.remove('unknown', 'live', 'routed');
  selectedDot?.classList.add(routing?.directParticipantDispatchProven || selected.id === 'everyone' ? 'live' : 'routed');
}

async function send(text) {
  const clean = String(text || '').trim();
  if (!clean || busy) return;
  if (pendingDraft) {
    memoryStatus.dataset.state = 'unavailable';
    memoryStatus.textContent = 'Previous turn unconfirmed · reload before sending';
    return;
  }
  const activeTarget = selected;
  const wireText = activeTarget.id === 'everyone'
    ? clean : `[Stephanos AI addressed target: ${activeTarget.label} (${activeTarget.id})]\n${clean}`;
  const draft = await createPendingDraft(clean, activeTarget.label);
  writePendingDraft(draft);
  const history = historyFor(activeTarget.id);
  history.push({ role: 'user', text: clean, turnId: draft.turnId });
  renderMessages({ forceBottom: true });
  prompt.value = '';
  autoGrow();
  busy = true;
  sendButton.disabled = true;
  showPendingStatus();
  $('routeLabel').textContent = `Routing to ${activeTarget.label}…`;

  try {
    const result = await queryStephanosAI({
      requestId: draft.requestId,
      messages: [{ role: 'user', content: wireText }],
      context: {
        workspace: 'stephanos-ai',
        addressedTargetId: activeTarget.id,
        addressedTargetLabel: activeTarget.label,
        addressedTargetKind: activeTarget.kind,
      },
      routeMode: 'auto',
      fallbackEnabled: true,
      runtimeContext: {
        surface: surfaceKind(),
        workspace: 'stephanos-ai',
        participantTarget: activeTarget.id,
      },
    });
    if (result.success === false) throw new Error(result.error || result.output_text || 'AI route rejected request');
    const routing = routingTruth(result);
    const contributors = routing?.selectedContributors?.map((entry) => entry.label).filter(Boolean) || [];
    history.push({
      role: 'assistant',
      author: routing?.responder?.label || 'Stephanos AI',
      routeNote: contributors.length > 0 ? `routed through ${contributors.join(' + ')}` : 'not yet verified durable',
      text: extractReply(result),
    });
    noteRouteTruth(result);
  } catch (error) {
    history.push({
      role: 'assistant',
      author: 'Route status',
      text: `Delivery uncertain. Your unsent turn is retained on this device until the canonical thread confirms it. ${error?.message || 'Backend unreachable'}`,
    });
    $('routerTruth').textContent = 'route unavailable';
    $('lastResponse').textContent = 'failed';
  } finally {
    busy = false;
    sendButton.disabled = false;
    if (selected.id === activeTarget.id) renderMessages({ forceBottom: true });
    const recovered = await loadCanonicalThread();
    if (!recovered && pendingDraft) {
      prompt.value = pendingDraft.text;
      autoGrow();
      showPendingStatus();
    }
  }
}

function autoGrow() {
  prompt.style.height = 'auto';
  prompt.style.height = `${Math.min(prompt.scrollHeight, 140)}px`;
}

composer.addEventListener('submit', (event) => {
  event.preventDefault();
  send(prompt.value);
});

prompt.addEventListener('input', autoGrow);
prompt.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    send(prompt.value);
  }
});

document.querySelectorAll('[data-prompt]').forEach((button) => {
  button.addEventListener('click', () => {
    prompt.value = button.dataset.prompt || '';
    autoGrow();
    prompt.focus();
  });
});

renderNav();
selectTarget(selected);
pendingDraft = readPendingDraft();
if (pendingDraft) {
  releaseDraft.hidden = false;
  prompt.value = pendingDraft.text;
  autoGrow();
  showPendingStatus();
}
reloadThread?.addEventListener('click', () => { void loadCanonicalThread(); });
releaseDraft?.addEventListener('click', () => {
  if (!pendingDraft || busy) return;
  const confirmed = window.confirm('The previous turn is not confirmed in the canonical thread. Keep its text in the editor and allow a new send? This could duplicate a turn if Battle Bridge received it.');
  if (!confirmed) return;
  const text = pendingDraft.text;
  writePendingDraft(null);
  prompt.value = text;
  autoGrow();
  memoryStatus.dataset.state = 'unavailable';
  memoryStatus.textContent = 'Draft released · verify before resend';
});
void probeBackendBridge();
void loadCanonicalThread();
