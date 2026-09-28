import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { chromium } from '../node_modules/playwright/index.mjs';

const REPO_ROOT = process.cwd();

const LIVE_FEED = {
  schemaVersion: 'stephanos.vr-playtest-live-feed.v1',
  route: '/api/shared-workspace/vr-playtest-feed',
  readOnly: true,
  state: 'ready',
  reason: 'VR_PLAYTEST_EVIDENCE_READY',
  latest: {
    game: 'Starfield',
    sessionId: 'observe-browser-proof',
    telemetry: { sequenceFaultCount: 42 },
    rollback: { state: 'RESTORED' },
    flywheel: { lessonId: 'vr-starfield-aer-observe-browser-proof' },
    labProjections: { starfieldReferenceLab: { nextMode: 'PROTECT' } },
  },
  vrResearchLab: {
    latest: {
      sessionId: 'observe-browser-proof',
      game: 'Starfield',
      route: 'MutaR / OpenXR',
      mode: 'OBSERVE',
      reusableFindings: [
        'AER flight recorder was active during the headset playtest.',
        'Presenter sequencing produced 42 discontinuities.',
      ],
      techniqueCandidate: 'Evidence-gated AER presenter protection is ready for a bounded Protect test.',
      sequenceFaultCount: 42,
      rollback: 'RESTORED',
      protectReady: true,
      provenanceRef: 'workspace:vr/flywheel/evidence/observe-browser-proof',
    },
    history: [],
  },
  starfieldReferenceLab: {
    latest: {
      sessionId: 'observe-browser-proof',
      route: 'MutaR / OpenXR',
      mode: 'OBSERVE',
      findings: [
        'Route: MutaR / OpenXR; stabilizer mode: OBSERVE.',
        'AER sequence faults: 42.',
        'Rollback: RESTORED; next Protect rung: EVIDENCE_READY.',
      ],
      baselineDllSha256: '63db15c370d3b8f15faa292a95d5c3abd4c6571cef0d35a45310d998adfeae41',
      experimentalDllSha256: 'b0046baf0e4487c76d6a7c85c04b338e402f50f7557189e5e46a5b8c0932a76c',
      sequenceFaultCount: 42,
      maxAbsDelta: 3,
      rollback: 'RESTORED',
      nextMode: 'PROTECT',
      provenanceRef: 'workspace:vr/flywheel/evidence/observe-browser-proof',
    },
    history: [],
  },
  flywheel: {
    learningCandidateCount: 1,
    improvementCandidateCount: 1,
    latestLessonId: 'vr-starfield-aer-observe-browser-proof',
    latestProtectReady: true,
  },
};

function contentType(path) {
  switch (extname(path).toLowerCase()) {
    case '.html': return 'text/html; charset=utf-8';
    case '.js':
    case '.mjs': return 'text/javascript; charset=utf-8';
    case '.json': return 'application/json; charset=utf-8';
    case '.css': return 'text/css; charset=utf-8';
    case '.svg': return 'image/svg+xml';
    case '.png': return 'image/png';
    default: return 'application/octet-stream';
  }
}

async function startStaticServer() {
  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url || '/', 'http://127.0.0.1');
      const relative = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
      const filePath = resolve(REPO_ROOT, relative);
      if (filePath !== REPO_ROOT && !filePath.startsWith(REPO_ROOT + sep)) {
        response.writeHead(403).end('blocked');
        return;
      }
      const info = await stat(filePath);
      if (!info.isFile()) throw new Error('not-file');
      const bytes = await readFile(filePath);
      response.writeHead(200, {
        'Content-Type': contentType(filePath),
        'Cache-Control': 'no-store',
      });
      response.end(bytes);
    } catch {
      response.writeHead(404).end('not found');
    }
  });
  await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('browser proof server did not bind');
  return { server, origin: `http://127.0.0.1:${address.port}` };
}

async function withBrowser(t, callback) {
  const { server, origin } = await startStaticServer();
  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      ...(process.platform === 'win32' ? { channel: 'msedge' } : {}),
    });
  } catch (error) {
    server.close();
    if (/Executable doesn't exist|browser executable/i.test(String(error?.message || error))) {
      t.skip('A Playwright-compatible system browser is required for VR Lab browser proof.');
      return;
    }
    throw error;
  }

  try {
    await callback(browser, origin);
  } finally {
    await browser.close();
    await new Promise((resolveClose) => server.close(resolveClose));
  }
}

async function preparePage(browser, feed = LIVE_FEED) {
  const page = await browser.newPage();
  const consoleErrors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => consoleErrors.push(String(error?.message || error)));
  await page.route('**/api/shared-workspace/vr-playtest-feed', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(feed),
    });
  });
  return { page, consoleErrors };
}

test('VR Research Lab renders reusable playtest Flywheel evidence in a real browser', async (t) => {
  await withBrowser(t, async (browser, origin) => {
    const { page, consoleErrors } = await preparePage(browser);
    await page.goto(`${origin}/apps/vr-research-lab/index.html`, { waitUntil: 'networkidle' });
    const panel = page.locator('#vr-playtest-flywheel-panel');
    await panel.locator('[data-role="state"]').waitFor({ state: 'visible' });
    await page.waitForFunction(() => document.querySelector('#vr-playtest-flywheel-panel [data-role="state"]')?.textContent === 'LIVE');

    assert.match(await panel.locator('[data-role="summary"]').innerText(), /Starfield \/ OBSERVE/);
    assert.match(await panel.locator('[data-role="summary"]').innerText(), /AER faults 42/);
    assert.match(await panel.locator('[data-role="summary"]').innerText(), /rollback RESTORED/);
    assert.match(await panel.locator('[data-role="method"]').innerText(), /AER presenter protection/);
    assert.equal(consoleErrors.length, 0, consoleErrors.join('\n'));
  });
});

test('Starfield VR Reference Lab renders title-specific Protect readiness in a real browser', async (t) => {
  await withBrowser(t, async (browser, origin) => {
    const { page, consoleErrors } = await preparePage(browser);
    await page.goto(`${origin}/apps/starfield-vr-reference-lab/index.html`, { waitUntil: 'networkidle' });
    const panel = page.locator('#starfield-vr-playtest-flywheel');
    await page.waitForFunction(() => document.querySelector('#starfield-vr-playtest-flywheel [data-role="state"]')?.textContent === 'PROTECT READY');

    assert.equal(await panel.locator('[data-role="state"]').innerText(), 'PROTECT READY');
    assert.match(await panel.locator('[data-role="summary"]').innerText(), /AER faults 42/);
    assert.match(await panel.locator('[data-role="summary"]').innerText(), /next PROTECT/);
    assert.match(await panel.locator('[data-role="provenance"]').innerText(), /Baseline 63db15c370d3/);
    assert.equal(consoleErrors.length, 0, consoleErrors.join('\n'));
  });
});

test('stale Starfield evidence remains visible but cannot advertise Protect readiness', async (t) => {
  const staleFeed = {
    ...LIVE_FEED,
    state: 'stale',
    reason: 'VR_PLAYTEST_EVIDENCE_STALE',
    latest: {
      ...LIVE_FEED.latest,
      freshness: 'stale',
      current: false,
    },
    vrResearchLab: {
      ...LIVE_FEED.vrResearchLab,
      latest: {
        ...LIVE_FEED.vrResearchLab.latest,
        freshness: 'stale',
        current: false,
        protectReady: false,
      },
    },
    starfieldReferenceLab: {
      ...LIVE_FEED.starfieldReferenceLab,
      latest: {
        ...LIVE_FEED.starfieldReferenceLab.latest,
        freshness: 'stale',
        current: false,
        nextMode: 'OBSERVE',
        recordedNextMode: 'PROTECT',
      },
    },
    flywheel: {
      ...LIVE_FEED.flywheel,
      latestProtectReady: false,
    },
  };

  await withBrowser(t, async (browser, origin) => {
    const { page, consoleErrors } = await preparePage(browser, staleFeed);
    await page.goto(`${origin}/apps/starfield-vr-reference-lab/index.html`, { waitUntil: 'networkidle' });
    const panel = page.locator('#starfield-vr-playtest-flywheel');
    await page.waitForFunction(() => document.querySelector('#starfield-vr-playtest-flywheel [data-role="state"]')?.textContent === 'STALE');

    assert.equal(await panel.locator('[data-role="state"]').innerText(), 'STALE');
    assert.doesNotMatch(await panel.locator('[data-role="state"]').innerText(), /PROTECT READY/);
    assert.match(await panel.locator('[data-role="summary"]').innerText(), /next OBSERVE/);
    assert.equal(consoleErrors.length, 0, consoleErrors.join('\n'));
  });
});
