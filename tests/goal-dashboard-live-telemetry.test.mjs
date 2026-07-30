import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html = readFileSync(new URL('../apps/goal-dashboard/index.html', import.meta.url), 'utf8');
const script = html.match(/<script>([\s\S]*)<\/script>/)?.[1] || '';

function runDashboard({ fetchImpl, hostname = 'localhost', protocol = 'http:', port = '' } = {}) {
  let activeElement = null;
  const telemetry = new Map();
  const grid = {
    _textContent: '',
    children: [],
    attrs: {},
    get textContent() { return this._textContent; },
    set textContent(value) {
      this._textContent = value;
      if (value === '') this.children.length = 0;
    },
    setAttribute(key, value) { this.attrs[key] = value; },
    appendChild(node) { this.children.push(node); },
    contains(node) { return node?.insideGrid === true; },
    querySelectorAll(selector) { return selector === '.goal-card' ? this.children : []; },
  };
  const document = {
    get activeElement() { return activeElement; },
    set activeElement(value) { activeElement = value; },
    getElementById(id) { return id === 'goal-grid' ? grid : null; },
    createElement(tag) {
      return {
        tag,
        className: '',
        attrs: {},
        innerHTML: '',
        setAttribute(key, value) { this.attrs[key] = value; },
        getAttribute(key) { return this.attrs[key] || ''; },
        querySelectorAll(selector) {
          if (selector !== 'a.goal-link') return [];
          const links = [];
          for (const match of String(this.innerHTML).matchAll(/<a class="goal-link" href="([^"]+)"[^>]*>([^<]+)<\/a>/g)) {
            const link = {
              insideGrid: true,
              textContent: match[2],
              getAttribute(key) { return key === 'href' ? match[1] : ''; },
              closest: () => this,
              focus: () => { activeElement = link; },
            };
            links.push(link);
          }
          return links;
        },
      };
    },
    querySelector(selector) {
      const match = String(selector).match(/data-live-telemetry-field="([^"]+)"/);
      if (!match) return null;
      const key = match[1];
      if (!telemetry.has(key)) telemetry.set(key, { textContent: '' });
      return telemetry.get(key);
    },
  };
  const context = {
    document,
    window: {
      location: { hostname, protocol, port },
      fetch: fetchImpl,
      setTimeout: (_fn) => 1,
      clearTimeout: () => {},
    },
    URL,
    AbortController: class { constructor() { this.signal = {}; } abort() {} },
  };
  vm.runInNewContext(script, context);
  return {
    telemetry,
    grid,
    context,
    setActiveElement(value) { activeElement = value; },
    getActiveElement() { return activeElement; },
  };
}

test('standalone Goal Dashboard static fallback remains honest when backend unavailable', async () => {
  const { telemetry, grid } = runDashboard({ fetchImpl: async () => ({ ok: false }) });
  await Promise.resolve();
  assert.equal(telemetry.get('goal-data-source').textContent, 'Seeded / source-controlled · BACKEND_UNAVAILABLE_STATIC_SEED_ONLY');
  assert.equal(telemetry.get('github-state').textContent, 'Not live in browser');
  assert.match(telemetry.get('telemetry-blocker').textContent, /BACKEND_UNAVAILABLE_STATIC_SEED_ONLY/);
  assert.equal(grid.attrs['data-goal-dashboard-source-state'], 'static-seed');
  assert.match(grid.children[0].innerHTML, /badge active">Active/);
});

test('standalone Goal Dashboard renders live telemetry from approved endpoint', async () => {
  const calls = [];
  const { telemetry, grid } = runDashboard({
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return { ok: true, json: async () => ({
        schemaVersion: 'stephanos.live-goal-projection.v1',
        sourceTruth: 'live',
        generatedAt: '2026-07-30T10:00:00.000Z',
        nextOperatorAction: 'Continue one active proof lane.',
        currentAgentStates: { github: { state: 'adapter-provided' }, stephanos: { state: 'backend_reachable' } },
        proofTruth: { local: 'unknown' },
        buildConciergeStatus: { roadmap: { phases: [{ version: 'V1', status: 'landed' }, { version: 'V8', status: 'implemented_guarded' }] }, executionEngine: { status: 'blocked_or_manual', watchedGoalCount: 1, classifiedGoalCount: 1, manualDispatchRequiredCount: 1, enrichedCandidates: [{ candidateId: 'bc-goal-live', classification: 'ui_surface_goal', dispatchReadiness: 'MANUAL_DISPATCH_REQUIRED' }] } },
        missions: [{ mission: { missionId: 'mission-live', title: '<script>alert(1)</script>', state: 'RUNNING', currentPhase: 'proof', nextAction: 'Inspect proof.' }, agent: { label: 'Codex' } }],
        queuedCandidates: [{ candidateId: 'bc-goal-live' }],
        activeProofLane: [{ candidateId: 'bc-goal-live' }],
        blockedCandidates: [{ candidateId: 'bc-goal-blocked' }],
        completedCandidates: [{ candidateId: 'bc-goal-done' }],
        dashboardGoals: {
          schemaVersion: 'stephanos.live-dashboard-goals.v1',
          sourceTruth: 'READ-ONLY RECEIPTS',
          freshnessVerdict: 'RECEIPT_TIMESTAMPS_VISIBLE',
          observedAt: '2026-07-30T10:00:00.000Z',
          totalAvailable: 1,
          displayedCount: 1,
          activePrCount: 0,
          blockedCount: 0,
          readyCount: 0,
          operatorAttentionCount: 0,
          nextAction: 'Inspect proof.',
          cards: [{
            issue: 'mission-live',
            title: '<script>alert(1)</script>',
            status: 'RUNNING',
            sourceTruth: 'READ-ONLY RECEIPT',
            observedAt: '2026-07-30T10:00:00.000Z',
            currentOwner: 'Codex',
            nextOwner: 'Operator',
            operatorNeeded: 'No',
            handoffState: 'proof',
            milestone: 'RECEIPT_BACKED_GOAL',
            proofIndex: 1,
            nextAction: 'Inspect proof.',
          }],
        },
      }) };
    },
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls[0].url, '/api/shared-workspace/dashboard-feed');
  assert.equal(calls[0].options.method, 'GET');
  assert.equal(calls[1].url, '/api/goal-projection/live');
  assert.equal(telemetry.get('goal-data-source').textContent, 'LIVE backend telemetry · /api/goal-projection/live');
  assert.equal(telemetry.get('github-state').textContent, 'adapter-provided');
  assert.equal(telemetry.get('automation-state').textContent, 'backend_reachable');
  assert.equal(telemetry.get('active-goal-queue').textContent, 'bc-goal-live');
  assert.equal(telemetry.get('active-proof-lane').textContent, 'bc-goal-live');
  assert.equal(telemetry.get('blocked-goals').textContent, 'bc-goal-blocked');
  assert.equal(telemetry.get('completed-goals').textContent, 'bc-goal-done');
  assert.match(telemetry.get('build-concierge-v1-v8-status').textContent, /V8:implemented_guarded/);
  assert.match(telemetry.get('build-concierge-v9-execution-engine').textContent, /classified 1/);
  assert.match(telemetry.get('build-concierge-v9-enriched-candidates').textContent, /ui_surface_goal/);
  assert.equal(telemetry.get('next-operator-action').textContent, 'Continue one active proof lane.');
  assert.equal(grid.attrs['data-goal-dashboard-source-state'], 'live-receipts');
  assert.match(script, /function escapeHtml/);
  assert.match(script, /escapeHtml\(goal\.title\)/);
});


test('standalone Goal Dashboard resolves 4173 to backend 8787 shared workspace feed', async () => {
  const calls = [];
  runDashboard({ hostname: '127.0.0.1', protocol: 'http:', port: '4173', fetchImpl: async (url) => { calls.push(url); return { ok: false, json: async () => ({}) }; } });
  await Promise.resolve();
  assert.equal(calls[0], 'http://127.0.0.1:8787/api/shared-workspace/dashboard-feed');
});


test('standalone Goal Dashboard renders ready Shared Workspace feed before static fallback', async () => {
  const { telemetry, grid } = runDashboard({
    fetchImpl: async (url) => url.includes('shared-workspace') ? { ok: true, json: async () => ({
      schemaVersion: 'stephanos.shared-workspace-dashboard-feed.v1',
      state: 'ready',
      reason: 'WORKSPACE_RECORDS_CURRENT_OR_UNKNOWN_BY_GOAL',
      workspaceRoot: '/tmp/shared-workspace-live',
      exactNextAction: 'Review live proof refs.',
      polling: { pollIntervalMs: 15000 },
      projection: {
        sourceTruth: 'CURRENT',
        finalVerdict: 'LANDING_GOAL_DASHBOARD_CURRENT',
        queueDispatcher: { dispatcherState: 'RUNNING', queueDepth: 1, currentJob: 'job-1', capabilityMode: 'automated_dispatch_supported' },
        battleBridgeSupervisor: { overallState: 'CURRENT', services: [{ serviceId: 'publisher-loop', state: 'CURRENT' }] },
        openClawCapabilityLadder: { canRunNow: ['read-only-proof'], needsApproval: ['windows-action'], blocked: [] },
        operatorAttention: { approvals: [], localProofNeeded: [], blockers: [], exactNextAction: 'Review live proof refs.' },
        goals: [{ issue: '#1290', title: 'Shared Agent Workspace', statusTruth: 'CURRENT', proofTruth: 'CURRENT', blockers: [], exactNextAction: 'Continue.' }],
      },
    }) } : { ok: false, json: async () => ({}) },
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(telemetry.get('source-badge').textContent, 'READY');
  assert.match(telemetry.get('goal-data-source').textContent, /READY Shared Agent Workspace feed/);
  assert.equal(telemetry.get('proof-state').textContent, 'CURRENT');
  assert.equal(grid.attrs['data-goal-dashboard-source-state'], 'live-shared-workspace');
});

test('standalone Goal Dashboard prefers canonical live GitHub goal cards and renders their source truth', async () => {
  const { telemetry, grid } = runDashboard({
    fetchImpl: async (url) => url.includes('shared-workspace') ? { ok: false, json: async () => ({}) } : { ok: true, json: async () => ({
      schemaVersion: 'stephanos.live-goal-projection.v1',
      sourceTruth: 'live',
      generatedAt: '2026-07-30T10:00:00.000Z',
      heartbeat: { backendLive: true, projectionSource: 'live-goal-projection-service' },
      currentAgentStates: { github: { state: 'adapter-provided' }, stephanos: { state: 'backend_reachable' } },
      proofTruth: { local: 'unknown' },
      githubTelemetry: { status: 'live', pullRequestCount: 1, workflowCounts: { passed: 1 } },
      dashboardGoals: {
        schemaVersion: 'stephanos.live-dashboard-goals.v1',
        sourceTruth: 'LIVE READ-ONLY GITHUB',
        freshnessVerdict: 'CURRENT_AT_REQUEST',
        observedAt: '2026-07-30T10:00:00.000Z',
        totalAvailable: 1,
        displayedCount: 1,
        activePrCount: 1,
        blockedCount: 0,
        readyCount: 1,
        operatorAttentionCount: 0,
        nextAction: 'Request exact-head review.',
        cards: [{
          issue: '#1622',
          url: 'https://github.com/example/repo/issues/1622',
          title: 'Canonical programme controller',
          status: 'READY FOR REVIEW',
          sourceTruth: 'LIVE READ-ONLY GITHUB',
          observedAt: '2026-07-30T10:00:00.000Z',
          currentOwner: 'Codex / review lane',
          nextOwner: 'Independent reviewer',
          operatorNeeded: 'No',
          handoffState: 'issue #1622 → PR #1623 → passed',
          milestone: 'PR #1623 · abcdef1234',
          proofIndex: 4,
          nextAction: 'Request exact-head review.',
          linkedPr: { number: 1623, url: 'https://github.com/example/repo/pull/1623' },
        }],
      },
    }) },
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(grid.attrs['data-goal-dashboard-source-state'], 'live-github');
  assert.match(grid.children.at(-1).innerHTML, /LIVE READ-ONLY GITHUB/);
  assert.match(grid.children.at(-1).innerHTML, /badge ready">READY FOR REVIEW/);
  assert.equal(telemetry.get('dashboard-visible-count').textContent, '1');
  assert.equal(telemetry.get('dashboard-ready-count').textContent, '1');
  assert.equal(telemetry.get('dashboard-priority-action').textContent, 'Request exact-head review.');
});

test('lower-ranked Shared Workspace polls cannot overwrite a live GitHub projection summary or cards', async () => {
  const { telemetry, grid, context } = runDashboard({ fetchImpl: async () => ({ ok: false, json: async () => ({}) }) });
  await new Promise((resolve) => setImmediate(resolve));
  context.renderLiveMissionOperationsTelemetry({
    schemaVersion: 'stephanos.live-goal-projection.v1',
    sourceTruth: 'live',
    generatedAt: '2026-07-30T10:00:00.000Z',
    currentAgentStates: { github: { state: 'adapter-provided' }, stephanos: { state: 'backend_reachable' } },
    dashboardGoals: {
      sourceTruth: 'LIVE READ-ONLY GITHUB',
      freshnessVerdict: 'CURRENT_AT_REQUEST',
      observedAt: '2026-07-30T10:00:00.000Z',
      totalAvailable: 1,
      displayedCount: 1,
      activePrCount: 1,
      blockedCount: 0,
      readyCount: 1,
      operatorAttentionCount: 0,
      nextAction: 'Keep exact-head review current.',
      cards: [{
        issue: '#1627',
        title: 'Goal Dashboard',
        status: 'READY FOR REVIEW',
        sourceTruth: 'LIVE READ-ONLY GITHUB',
        observedAt: '2026-07-30T10:00:00.000Z',
        currentOwner: 'Codex / review lane',
        nextOwner: 'Independent reviewer',
        operatorNeeded: 'No',
        handoffState: 'exact head',
        milestone: 'PR #1627',
        proofIndex: 4,
        nextAction: 'Keep exact-head review current.',
      }],
    },
  });
  const liveSource = telemetry.get('goal-data-source').textContent;
  const liveCount = telemetry.get('dashboard-visible-count').textContent;
  const liveAction = telemetry.get('dashboard-priority-action').textContent;

  context.renderSharedWorkspaceDashboardFeed({
    schemaVersion: 'stephanos.shared-workspace-dashboard-feed.v1',
    state: 'ready',
    lastRefreshUtc: '2026-07-30T10:00:15.000Z',
    exactNextAction: 'Lower-ranked workspace action.',
    projection: {
      sourceTruth: 'CURRENT',
      goals: [
        { issue: '#1', title: 'Workspace one', statusTruth: 'CURRENT', proofTruth: 'CURRENT', blockers: [], exactNextAction: 'One.' },
        { issue: '#2', title: 'Workspace two', statusTruth: 'CURRENT', proofTruth: 'CURRENT', blockers: [], exactNextAction: 'Two.' },
      ],
    },
  });

  assert.equal(grid.attrs['data-goal-dashboard-source-state'], 'live-github');
  assert.equal(grid.children.length, 1);
  assert.equal(telemetry.get('goal-data-source').textContent, liveSource);
  assert.equal(telemetry.get('dashboard-visible-count').textContent, liveCount);
  assert.equal(telemetry.get('dashboard-priority-action').textContent, liveAction);
  assert.equal(telemetry.get('hero-truth-source').textContent, 'LIVE READ-ONLY GITHUB');
});

test('newer degraded approved telemetry invalidates older live GitHub readiness on the same lane', async () => {
  const { telemetry, grid, context } = runDashboard({ fetchImpl: async () => ({ ok: false, json: async () => ({}) }) });
  await new Promise((resolve) => setImmediate(resolve));
  context.renderLiveMissionOperationsTelemetry({
    schemaVersion: 'stephanos.live-goal-projection.v1',
    sourceTruth: 'live',
    dashboardGoals: {
      sourceTruth: 'LIVE READ-ONLY GITHUB',
      observedAt: '2026-07-30T10:00:00.000Z',
      cards: [{ issue: '#1627', title: 'Previously current', status: 'READY FOR REVIEW', currentOwner: 'Review', nextOwner: 'Operator', operatorNeeded: 'No', handoffState: 'ready', milestone: 'OLD HEAD', proofIndex: 4, nextAction: 'Review.' }],
    },
  });
  assert.match(grid.children[0].innerHTML, /Previously current/);

  context.renderLiveMissionOperationsTelemetry({
    schemaVersion: 'stephanos.live-goal-projection.v1',
    sourceTruth: 'mixed',
    generatedAt: '2026-07-30T10:01:00.000Z',
    dashboardGoals: {
      sourceTruth: 'UNKNOWN',
      freshnessVerdict: 'NO_CURRENT_GOAL_RECORDS',
      observedAt: '2026-07-30T10:01:00.000Z',
      cards: [],
      nextAction: 'Restore complete GitHub truth.',
    },
  });
  assert.equal(grid.attrs['data-goal-dashboard-source-state'], 'live-unknown');
  assert.match(grid.children[0].innerHTML, /NO CURRENT GOAL RECORDS/);
  assert.equal(telemetry.get('hero-truth-source').textContent, 'UNKNOWN');
  assert.equal(telemetry.get('dashboard-priority-action').textContent, 'Restore complete GitHub truth.');
});

test('receipt-backed cards display the durable receipt timestamp instead of the projection poll time', async () => {
  const { grid, context } = runDashboard({ fetchImpl: async () => ({ ok: false, json: async () => ({}) }) });
  await new Promise((resolve) => setImmediate(resolve));
  context.renderLiveMissionOperationsTelemetry({
    schemaVersion: 'stephanos.live-goal-projection.v1',
    sourceTruth: 'mixed',
    generatedAt: '2026-07-30T10:30:00.000Z',
    dashboardGoals: {
      sourceTruth: 'READ-ONLY RECEIPTS',
      observedAt: '2026-07-30T10:30:00.000Z',
      cards: [{
        issue: '#1282',
        title: 'Receipt-backed dashboard goal',
        status: 'QUEUED',
        source: 'mission-operations-receipt',
        sourceTruth: 'READ-ONLY RECEIPT',
        observedAt: '2026-07-30T10:30:00.000Z',
        lastUpdatedAt: '2026-07-30T08:15:00.000Z',
        currentOwner: 'Build Concierge queue',
        nextOwner: 'Canonical dispatcher',
        operatorNeeded: 'No',
        handoffState: 'receipt',
        milestone: 'RECEIPT_BACKED_GOAL',
        proofIndex: 1,
        nextAction: 'Inspect the receipt.',
      }],
    },
  });
  assert.match(grid.children[0].innerHTML, /2026-07-30 08:15:00Z/);
  assert.doesNotMatch(grid.children[0].innerHTML, /2026-07-30 10:30:00Z/);
});

test('goal cards render links for every unsuperseded PR supplied by the projection', async () => {
  const { grid, context } = runDashboard({ fetchImpl: async () => ({ ok: false, json: async () => ({}) }) });
  await new Promise((resolve) => setImmediate(resolve));
  context.renderGoals([{
    issue: '#1650',
    url: 'https://github.com/example/repo/issues/1650',
    title: 'Multi-PR goal',
    status: 'BLOCKED',
    sourceTruth: 'LIVE READ-ONLY GITHUB',
    observedAt: '2026-07-30T10:30:00.000Z',
    currentOwner: 'Codex / review lane',
    nextOwner: 'Independent reviewer',
    operatorNeeded: 'No',
    handoffState: 'two PRs',
    milestone: '2 UNSUPERSEDED PRS',
    proofIndex: 3,
    nextAction: 'Repair the failing lane.',
    linkedPr: { number: 1652, url: 'https://github.com/example/repo/pull/1652' },
    linkedPullRequests: [
      { number: 1651, url: 'https://github.com/example/repo/pull/1651' },
      { number: 1652, url: 'https://github.com/example/repo/pull/1652' },
    ],
  }], 'live-github');
  assert.match(grid.children[0].innerHTML, /Open PR #1651/);
  assert.match(grid.children[0].innerHTML, /Open PR #1652/);
  assert.equal(grid.children[0].querySelectorAll('a.goal-link').length, 3);
});

test('periodic same-lane card refresh restores focus to the matching goal link', async () => {
  const { grid, context, setActiveElement, getActiveElement } = runDashboard({ fetchImpl: async () => ({ ok: false, json: async () => ({}) }) });
  await new Promise((resolve) => setImmediate(resolve));
  const projection = {
    schemaVersion: 'stephanos.live-goal-projection.v1',
    sourceTruth: 'live',
    dashboardGoals: {
      sourceTruth: 'LIVE READ-ONLY GITHUB',
      observedAt: '2026-07-30T10:00:00.000Z',
      cards: [{
        issue: '#1627',
        url: 'https://github.com/example/repo/issues/1627',
        title: 'Goal Dashboard',
        status: 'VERIFYING',
        currentOwner: 'CI',
        nextOwner: 'Review',
        operatorNeeded: 'No',
        handoffState: 'checks',
        milestone: 'HEAD',
        proofIndex: 3,
        nextAction: 'Wait.',
        linkedPr: { number: 1627, url: 'https://github.com/example/repo/pull/1627' },
      }],
    },
  };
  context.renderLiveMissionOperationsTelemetry(projection);
  assert.match(grid.children[0].innerHTML, /goal-link/);
  const renderedLinks = grid.children[0].querySelectorAll('a.goal-link');
  assert.equal(renderedLinks.length, 2);
  const focusedLink = renderedLinks[0];
  setActiveElement(focusedLink);

  context.renderLiveMissionOperationsTelemetry({
    ...projection,
    generatedAt: '2026-07-30T10:00:30.000Z',
    dashboardGoals: {
      ...projection.dashboardGoals,
      observedAt: '2026-07-30T10:00:30.000Z',
      cards: projection.dashboardGoals.cards.map((card) => ({ ...card, status: 'READY FOR REVIEW' })),
    },
  });
  assert.equal(getActiveElement().getAttribute('href'), 'https://github.com/example/repo/issues/1627');
  assert.equal(getActiveElement().textContent, 'Open #1627');
});

test('a failed live refresh lowers precedence so a current Shared Workspace projection can replace stale cards', async () => {
  const { telemetry, grid, context } = runDashboard({ fetchImpl: async () => ({ ok: false, json: async () => ({}) }) });
  await new Promise((resolve) => setImmediate(resolve));
  context.renderLiveMissionOperationsTelemetry({
    schemaVersion: 'stephanos.live-goal-projection.v1',
    sourceTruth: 'live',
    dashboardGoals: {
      sourceTruth: 'LIVE READ-ONLY GITHUB',
      observedAt: '2026-07-30T10:00:00.000Z',
      cards: [{ issue: '#1627', title: 'Last known GitHub card', status: 'VERIFYING', currentOwner: 'CI', nextOwner: 'Review', operatorNeeded: 'No', handoffState: 'checks', milestone: 'HEAD', proofIndex: 3, nextAction: 'Wait.' }],
    },
  });
  context.markLiveTelemetryRefreshFailed();
  assert.equal(telemetry.get('source-badge').textContent, 'STALE');

  context.renderSharedWorkspaceDashboardFeed({
    schemaVersion: 'stephanos.shared-workspace-dashboard-feed.v1',
    state: 'ready',
    lastRefreshUtc: '2026-07-30T10:01:00.000Z',
    exactNextAction: 'Use current workspace truth.',
    projection: {
      sourceTruth: 'CURRENT',
      goals: [{ issue: '#1282', title: 'Current workspace goal', statusTruth: 'CURRENT', proofTruth: 'CURRENT', blockers: [], exactNextAction: 'Continue.' }],
    },
  });
  assert.equal(grid.attrs['data-goal-dashboard-source-state'], 'live-shared-workspace');
  assert.match(grid.children[0].innerHTML, /Current workspace goal/);
  assert.equal(telemetry.get('hero-truth-source').textContent, 'SHARED WORKSPACE FEED');

  context.markLiveTelemetryRefreshFailed();
  assert.equal(telemetry.get('source-badge').textContent, 'READY');
  assert.equal(telemetry.get('hero-truth-source').textContent, 'SHARED WORKSPACE FEED');
  assert.equal(grid.attrs['data-goal-dashboard-source-state'], 'live-shared-workspace');
});

test('a rejected telemetry schema marks the retained live projection stale', async () => {
  const { telemetry, context } = runDashboard({ fetchImpl: async () => ({ ok: false, json: async () => ({}) }) });
  await new Promise((resolve) => setImmediate(resolve));
  context.renderLiveMissionOperationsTelemetry({
    schemaVersion: 'stephanos.live-goal-projection.v1',
    sourceTruth: 'live',
    dashboardGoals: {
      sourceTruth: 'LIVE READ-ONLY GITHUB',
      observedAt: '2026-07-30T10:00:00.000Z',
      cards: [{ issue: '#1627', title: 'Current goal', status: 'VERIFYING', currentOwner: 'CI', nextOwner: 'Review', operatorNeeded: 'No', handoffState: 'checks', milestone: 'HEAD', proofIndex: 3, nextAction: 'Wait.' }],
    },
  });
  assert.equal(telemetry.get('source-badge').textContent, 'LIVE');

  const rendered = context.renderApprovedLiveTelemetryOrMarkFailed({ schemaVersion: 'unsupported.telemetry.v2', truthy: true });
  assert.equal(rendered, false);
  assert.equal(telemetry.get('source-badge').textContent, 'STALE');
  assert.equal(telemetry.get('hero-truth-source').textContent, 'STALE LAST KNOWN');
  assert.match(telemetry.get('goals-context').textContent, /do not treat as current/);
});

test('a supported telemetry schema with a malformed nested dashboard envelope is rejected', async () => {
  const malformedFeeds = [
    { schemaVersion: 'stephanos.live-goal-projection.v1', sourceTruth: 'live', generatedAt: '2026-07-30T10:00:00.000Z' },
    { schemaVersion: 'stephanos.live-goal-projection.v1', sourceTruth: 'live', generatedAt: '2026-07-30T10:00:00.000Z', dashboardGoals: { schemaVersion: 'stephanos.live-dashboard-goals.v1', sourceTruth: 'LIVE READ-ONLY GITHUB', freshnessVerdict: 'CURRENT_AT_REQUEST', observedAt: '2026-07-30T10:00:00.000Z', totalAvailable: 0, displayedCount: 0, activePrCount: 0, blockedCount: 0, readyCount: 0, operatorAttentionCount: 0, nextAction: 'No current goal records.', cards: {} } },
    { schemaVersion: 'stephanos.live-goal-projection.v1', sourceTruth: 'live', generatedAt: '2026-07-30T10:00:00.000Z', dashboardGoals: { schemaVersion: 'stephanos.live-dashboard-goals.v1', sourceTruth: 'LIVE READ-ONLY GITHUB', freshnessVerdict: 'CURRENT_AT_REQUEST', observedAt: '2026-07-30T10:00:00.000Z', totalAvailable: 1, displayedCount: 1, activePrCount: 1, blockedCount: 0, readyCount: 0, operatorAttentionCount: 0, nextAction: 'Inspect malformed card.', cards: [{ issue: '#1627', title: 'Malformed card' }] } },
  ];
  for (const feed of malformedFeeds) {
    const { telemetry, context } = runDashboard({ fetchImpl: async () => ({ ok: false, json: async () => ({}) }) });
    await new Promise((resolve) => setImmediate(resolve));
    context.renderLiveMissionOperationsTelemetry({
      schemaVersion: 'stephanos.live-goal-projection.v1',
      sourceTruth: 'live',
      dashboardGoals: {
        sourceTruth: 'LIVE READ-ONLY GITHUB',
        observedAt: '2026-07-30T10:00:00.000Z',
        cards: [{ issue: '#1627', title: 'Current goal', status: 'VERIFYING', currentOwner: 'CI', nextOwner: 'Review', operatorNeeded: 'No', handoffState: 'checks', milestone: 'HEAD', proofIndex: 3, nextAction: 'Wait.' }],
      },
    });
    assert.equal(telemetry.get('source-badge').textContent, 'LIVE');
    assert.equal(context.renderApprovedLiveTelemetryOrMarkFailed(feed), false);
    assert.equal(telemetry.get('source-badge').textContent, 'STALE');
  }
});

test('standalone Goal Dashboard does not claim live proof without backend data and gates non-local fetches', async () => {
  const calls = [];
  const { telemetry, grid } = runDashboard({ hostname: 'example.com', fetchImpl: async () => { calls.push('called'); return { ok: true }; } });
  await Promise.resolve();
  assert.equal(calls.length, 0);
  assert.equal(telemetry.get('github-state').textContent, 'Not live in browser');
  assert.match(telemetry.get('telemetry-blocker').textContent, /No live GitHub proof, local proof, browser proof/);
  assert.equal(grid.attrs['data-goal-dashboard-source-state'], 'static-seed');
});

test('standalone Goal Dashboard includes professional motion with reduced-motion protection', () => {
  assert.match(html, /@keyframes card-arrive/);
  assert.match(html, /@keyframes rail-reveal/);
  assert.match(html, /@keyframes handoff-pulse/);
  assert.match(html, /@media \(prefers-reduced-motion: reduce\)/);
});
