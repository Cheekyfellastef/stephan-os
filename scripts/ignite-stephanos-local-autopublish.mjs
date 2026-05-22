#!/usr/bin/env node

process.env.STEPHANOS_IGNITION_AUTOPUBLISH_DIST = '1';
await import('./ignite-stephanos-local.mjs');
