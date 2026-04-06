import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const thisFilePath = fileURLToPath(import.meta.url);
export const repoRoot = path.resolve(path.dirname(thisFilePath), '../../..');
export const uiRoot = path.join(repoRoot, 'stephanos-ui');
export const srcRoot = path.join(uiRoot, 'src');

const buildDefine = {
  __STEPHANOS_UI_VERSION__: JSON.stringify('test-version'),
  __STEPHANOS_UI_SOURCE__: JSON.stringify('test-source'),
  __STEPHANOS_UI_SOURCE_FINGERPRINT__: JSON.stringify('test-fingerprint'),
  __STEPHANOS_UI_BUILD_TARGET__: JSON.stringify('test-target'),
  __STEPHANOS_UI_BUILD_TARGET_IDENTIFIER__: JSON.stringify('test-target-id'),
  __STEPHANOS_UI_RUNTIME_ID__: JSON.stringify('test-runtime-id'),
  __STEPHANOS_UI_SOURCE_TRUTH__: JSON.stringify('test-source-truth'),
  __STEPHANOS_UI_BUILD_METADATA__: JSON.stringify({
    runtimeMarker: 'test-runtime-marker',
    gitCommit: 'test-commit',
    buildTimestamp: 'test-build-timestamp',
  }),
};

function aliasPlugin(aliases) {
  return {
    name: 'alias-plugin',
    setup(buildContext) {
      buildContext.onResolve({ filter: /.*/ }, (args) => {
        if (aliases[args.path]) {
          return { path: aliases[args.path] };
        }
        return null;
      });
    },
  };
}

export async function importBundledModule(entryPoint, aliases = {}, testLabel = 'render-test') {
  const outfile = path.join(
    os.tmpdir(),
    `stephanos-${testLabel}-${Date.now()}-${Math.random().toString(36).slice(2)}.cjs`,
  );

  const result = await build({
    absWorkingDir: uiRoot,
    entryPoints: [entryPoint],
    bundle: true,
    format: 'cjs',
    platform: 'node',
    outfile,
    define: buildDefine,
    jsx: 'automatic',
    plugins: [aliasPlugin(aliases)],
  });

  if (result.errors.length > 0) {
    throw new Error(`Expected bundle without errors for ${entryPoint}`);
  }

  const imported = await import(pathToFileURL(outfile).href);
  await fs.unlink(outfile).catch(() => {});
  return imported;
}
