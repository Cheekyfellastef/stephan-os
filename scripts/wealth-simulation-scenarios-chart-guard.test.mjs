import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const SCENARIO_OVERLAY_CSS = 'apps/wealth-simulation-scenarios/scenario-overlay.css';

test('scenario overlay chart wrapper does not force auto height', () => {
  const css = readFileSync(SCENARIO_OVERLAY_CSS, 'utf8');
  assert.doesNotMatch(
    css,
    /\.scenario-sim-app__chart-wrapper\s*\{[^}]*height:\s*auto\s*!important;/s,
    'chart wrapper must not force auto height; Recharts needs measurable container height',
  );
});

test('scenario overlay establishes chart min-height guardrails', () => {
  const css = readFileSync(SCENARIO_OVERLAY_CSS, 'utf8');
  assert.match(css, /\.scenario-sim-app__chart-wrapper\s*\{[^}]*min-height:/s);
  assert.match(css, /\.scenario-sim-app__chart-shell\s+\.recharts-responsive-container\s*\{[^}]*min-height:/s);
});
