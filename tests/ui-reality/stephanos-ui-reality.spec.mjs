import { test, expect } from '@playwright/test';

const APP_PATH = '/apps/stephanos/dist/index.html';

test('Agent Mission Console outer collapse', async ({ page }) => {
  await page.goto(APP_PATH);
  const pane = page.getByTestId('pane-agent-mission-console');
  await expect(pane).toBeVisible();
  const body = page.getByTestId('pane-agent-mission-console-body');
  await expect(body).toBeVisible();
  await page.getByTestId('pane-agent-mission-console-toggle').click();
  await expect(body).toBeHidden();
  await expect(page.getByTestId('mission-console-inner-command-deck')).toBeHidden();
  await page.getByTestId('pane-agent-mission-console-toggle').click();
  await expect(body).toBeVisible();
});

test('No orphan move controls', async ({ page }) => {
  await page.goto(APP_PATH);
  const reality = await page.evaluate(() => window.__STEPHANOS_UI_REALITY__);
  expect(reality.orphanMoveControlCount).toBe(0);
  const counts = {};
  for (const group of reality.moveControlGroups) {
    expect(group.attached).toBeTruthy();
    counts[group.parentPaneId] = (counts[group.parentPaneId] || 0) + 1;
  }
  Object.values(counts).forEach((count) => expect(count).toBeLessThanOrEqual(1));
});
