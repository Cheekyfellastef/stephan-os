import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const scriptPath = resolve(__dirname, 'ignite-stephanos-local.mjs');

const result = spawnSync(process.execPath, [scriptPath], {
  cwd: process.cwd(),
  stdio: 'inherit',
  env: {
    ...process.env,
    STEPHANOS_IGNITION_AUTOPUBLISH_DIST: '1',
  },
});

if (result.error) {
  console.error(result.error);
  process.exit(1);
}

process.exit(result.status ?? 0);
