import { test, expect } from '@playwright/test';

const APP_PATH = '/apps/stephanos/dist/index.html';
const BAD_SOURCE_PACK_OUTPUT = `As a language model, ask away or say next.
<your response>`;

test('Mission Console Source Pack judgment publishes failed result into Support Snapshot', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto(APP_PATH);

  await expect(page.getByTestId('pane-agent-mission-console')).toBeVisible();
  const sourcePackText = page.getByTestId('builder-workbench-openclaw-source-pack-text');
  const sourcePackOutput = page.getByTestId('builder-workbench-openclaw-source-pack-output');
  await expect(sourcePackText).toBeVisible();
  await expect(sourcePackOutput).toBeVisible();

  await sourcePackText.fill(BAD_SOURCE_PACK_OUTPUT);
  await sourcePackOutput.fill(BAD_SOURCE_PACK_OUTPUT);
  await page.getByRole('button', { name: 'Run Source Pack Intake Judgment' }).click();

  await expect(page.getByText(/Runner status:\s*failed/i)).toBeVisible();
  await expect(page.getByText(/Runner render blocker:\s*none/i)).toBeVisible();
  await expect(page.getByText(/Controls mounted count:\s*2/i)).toBeVisible();

  await expect.poll(async () => {
    await page.getByRole('button', { name: 'Copy Support Snapshot' }).click();
    return page.evaluate(() => navigator.clipboard.readText());
  }, { timeout: 10_000 }).toContain('OpenClaw Source Pack Runner Status: failed');

  const supportSnapshot = await page.evaluate(() => navigator.clipboard.readText());
  expect(supportSnapshot).toContain('OpenClaw Source Pack Result Present: yes');
  expect(supportSnapshot).toContain('OpenClaw Source Pack Template Leakage Detected: yes');
  expect(supportSnapshot).toContain('OpenClaw Source Pack Asks For Next Detected: yes');
  expect(supportSnapshot).toContain('OpenClaw Source Pack Trusted For Canon: no');
  expect(supportSnapshot).toContain('OpenClaw Source Pack Trusted For Research: no');
  expect(supportSnapshot).toMatch(/OpenClaw Source Pack Text DOM Value Length: [1-9]\d*/);
  expect(supportSnapshot).toMatch(/OpenClaw Source Pack Output DOM Value Length: [1-9]\d*/);
  expect(supportSnapshot).toContain('OpenClaw Source Pack Output OnChange Fired: yes');
  expect(supportSnapshot).toContain('OpenClaw Source Pack Judgment Button Clicked: yes');
  expect(supportSnapshot).toContain('OpenClaw Source Pack Judgment Read Source: visible-ref-or-mirror');
  expect(supportSnapshot).toContain('OpenClaw Source Pack Projection Written: yes');
  expect(supportSnapshot).toContain('OpenClaw Source Pack Projection Source: source-pack-runner-judged');
  expect(supportSnapshot).toContain('OpenClaw Source Pack Text Textarea Mounted: yes');
  expect(supportSnapshot).toContain('OpenClaw Source Pack Output Textarea Mounted: yes');
  expect(supportSnapshot).toContain('OpenClaw Source Pack Runner Render Blocker: none');
  expect(supportSnapshot).toContain('OpenClaw Source Pack Controls Mounted Count: 2');

  await page.screenshot({ path: '/tmp/stephanos-source-pack-runner-support-snapshot-proof.png', fullPage: true });
});
