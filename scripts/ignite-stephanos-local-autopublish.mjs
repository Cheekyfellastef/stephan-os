#!/usr/bin/env node

import { spawnSync } from 'node:child_process';

const child = spawnSync(process.execPath, ['scripts/ignite-stephanos-local.mjs'], {
  cwd: process.cwd(),
  stdio: 'inherit',
  env: {
    ...process.env,
    STEPHANOS_IGNITION_AUTOPUBLISH_DIST: '1',
  },
});

if (child.error) {
  throw child.error;
}

process.exit(child.status ?? 1);
