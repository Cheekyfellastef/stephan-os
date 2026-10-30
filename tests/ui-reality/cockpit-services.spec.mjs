import { test, expect } from '@playwright/test';

const APP = '/apps/stephanos/dist/index.html?surface=cockpit';
const health = { ok: true, service: 'stephanos-server', schemaVersion: 'stephanos.backend-health.v1', backendIdentity: { runtimeId: 'stephanos-battle-bridge-backend' }, default_provider: 'mock' };
async function isolateApi(page, healthy = true) {
  await page.route('**/api/**', async route => {
    if (new URL(route.request().url()).pathname === '/api/health') {
      if (!healthy) return route.abort('connectionfailed');
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(health) });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
}

for (const width of [390, 820, 1280]) {
  test(`Cockpit is one responsive document with independent service and mission proof at ${width}px`, async ({ page }) => {
    await isolateApi(page);
    await page.setViewportSize({ width, height: 900 });
    await page.goto(APP);
    await expect(page.getByTestId('cockpit-backend-health')).toHaveText('healthy');
    await expect(page.getByTestId('cockpit-backend-reachability')).toHaveText('reachable');
    await expect(page.locator('[data-panel-id="cockpitPanel"]')).toHaveCount(1);
    await expect(page.locator('[data-cockpit-block="primary-dashboard"]')).toHaveCount(1);
    await expect(page.locator('iframe')).toHaveCount(0);
    await expect(page.getByTestId('cockpit-service-summary')).toContainText('missing');
    await expect(page.getByTestId('cockpit-ui-monitor')).toHaveText('UI regression checks: PASS');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2)).toBe(true);
    const clippedCards = await page.locator('.cockpit-shell section').evaluateAll(elements => elements.filter(element => {
      const r = element.getBoundingClientRect();
      return r.width > 0 && (r.left < -2 || r.right > document.documentElement.clientWidth + 2);
    }).length);
    expect(clippedCards).toBe(0);
  });
}

test('failed browser transport is unreachable with unknown service health', async ({ page }) => {
  await isolateApi(page, false);
  await page.goto(APP);
  await expect(page.getByTestId('cockpit-backend-reachability')).toHaveText('unreachable');
  await expect(page.getByTestId('cockpit-backend-health')).toHaveText('unknown');
  await expect(page.locator('[data-cockpit-node="backend"]')).not.toHaveClass(/truth-dead/);
});

test('existing UI Reality monitoring detects and clears a duplicate dashboard', async ({ page }) => {
  await isolateApi(page);
  await page.goto(APP);
  await expect(page.getByTestId('cockpit-ui-monitor')).toHaveText('UI regression checks: PASS');
  await page.locator('[data-cockpit-block="primary-dashboard"]').evaluate(element => {
    const duplicate = element.cloneNode(true);
    duplicate.id = 'cockpit-regression-test-duplicate';
    element.after(duplicate);
  });
  await expect(page.getByTestId('cockpit-ui-monitor')).toContainText('COCKPIT_DASHBOARD_CARDINALITY');
  await page.locator('#cockpit-regression-test-duplicate').evaluate(element => element.remove());
  await expect(page.getByTestId('cockpit-ui-monitor')).toHaveText('UI regression checks: PASS');
});
