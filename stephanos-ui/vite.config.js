import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const packageJsonPath = fileURLToPath(new URL('./package.json', import.meta.url));
const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));

const buildMetadata = {
  appName: 'Stephanos UI',
  version: process.env.STEPHANOS_BUILD_VERSION || packageJson.version,
  sourceIdentifier: process.env.STEPHANOS_BUILD_SOURCE_IDENTIFIER || 'stephanos-ui/src',
  sourceFingerprint: process.env.STEPHANOS_BUILD_SOURCE_FINGERPRINT || 'fingerprint-unavailable',
  buildTarget: process.env.STEPHANOS_BUILD_TARGET || 'apps/stephanos/dist',
  buildTargetIdentifier: process.env.STEPHANOS_BUILD_TARGET_IDENTIFIER || 'apps/stephanos/dist',
  runtimeId: process.env.STEPHANOS_BUILD_RUNTIME_ID || 'live-vite-shell',
  runtimeMarker: process.env.STEPHANOS_BUILD_RUNTIME_MARKER || 'stephanos-ui/runtime::dist-synced-v2',
  gitCommit: process.env.STEPHANOS_BUILD_GIT_COMMIT || 'git-unavailable',
  buildTimestamp: process.env.STEPHANOS_BUILD_TIMESTAMP || new Date().toISOString(),
  sourceTruth: process.env.STEPHANOS_BUILD_SOURCE_TRUTH || 'sourceFingerprint',
};

const generatedAssetBanner = [
  '/* GENERATED FILE: Stephanos dist asset. */',
  '/* Do not edit manually. Live source lives in stephanos-ui/src/** and is rebuilt with npm run stephanos:build. */',
].join('\n');

function stephanosBuildMetadataPlugin(metadata) {
  const metadataJson = JSON.stringify(metadata);

  return {
    name: 'stephanos-build-metadata',
    transformIndexHtml(html) {
      return {
        html,
        tags: [
          {
            tag: 'meta',
            injectTo: 'head',
            attrs: { name: 'stephanos-build-version', content: metadata.version },
          },
          {
            tag: 'meta',
            injectTo: 'head',
            attrs: { name: 'stephanos-build-source', content: metadata.sourceIdentifier },
          },
          {
            tag: 'meta',
            injectTo: 'head',
            attrs: { name: 'stephanos-build-source-fingerprint', content: metadata.sourceFingerprint },
          },
          {
            tag: 'meta',
            injectTo: 'head',
            attrs: { name: 'stephanos-build-target', content: metadata.buildTarget },
          },
          {
            tag: 'meta',
            injectTo: 'head',
            attrs: { name: 'stephanos-build-target-identifier', content: metadata.buildTargetIdentifier },
          },
          {
            tag: 'meta',
            injectTo: 'head',
            attrs: { name: 'stephanos-build-runtime-id', content: metadata.runtimeId },
          },
          {
            tag: 'meta',
            injectTo: 'head',
            attrs: { name: 'stephanos-build-runtime-marker', content: metadata.runtimeMarker },
          },
          {
            tag: 'meta',
            injectTo: 'head',
            attrs: { name: 'stephanos-build-git-commit', content: metadata.gitCommit },
          },
          {
            tag: 'meta',
            injectTo: 'head',
            attrs: { name: 'stephanos-build-timestamp', content: metadata.buildTimestamp },
          },
          {
            tag: 'meta',
            injectTo: 'head',
            attrs: { name: 'stephanos-build-source-truth', content: metadata.sourceTruth },
          },
          {
            tag: 'script',
            injectTo: 'head',
            attrs: { id: 'stephanos-build-metadata', type: 'application/json' },
            children: metadataJson,
          },
        ],
      };
    },
    generateBundle(_options, bundle) {
      bundle['stephanos-build.json'] = {
        type: 'asset',
        fileName: 'stephanos-build.json',
        source: `${JSON.stringify(metadata, null, 2)}\n`,
      };

      for (const chunk of Object.values(bundle)) {
        if (chunk.type === 'asset' && chunk.fileName.endsWith('.css')) {
          const cssSource = String(chunk.source);
          if (!cssSource.startsWith(generatedAssetBanner)) {
            chunk.source = `${generatedAssetBanner}\n${cssSource}`;
          }
        }
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), stephanosBuildMetadataPlugin(buildMetadata)],
  // Source of truth: the live Stephanos UI is authored in stephanos-ui/src and built into apps/stephanos/dist.
  // Relative asset URLs are required because the production app is launched from /apps/stephanos/dist/index.html,
  // including when the repository is hosted from the GitHub Pages subpath /stephan-os/.
  base: './',
  define: {
    __STEPHANOS_BUILD_TIME__: JSON.stringify(buildMetadata.buildTimestamp),
    __STEPHANOS_UI_VERSION__: JSON.stringify(buildMetadata.version),
    __STEPHANOS_UI_SOURCE__: JSON.stringify(buildMetadata.sourceIdentifier),
    __STEPHANOS_UI_SOURCE_FINGERPRINT__: JSON.stringify(buildMetadata.sourceFingerprint),
    __STEPHANOS_UI_BUILD_TARGET__: JSON.stringify(buildMetadata.buildTarget),
    __STEPHANOS_UI_BUILD_TARGET_IDENTIFIER__: JSON.stringify(buildMetadata.buildTargetIdentifier),
    __STEPHANOS_UI_RUNTIME_ID__: JSON.stringify(buildMetadata.runtimeId),
    __STEPHANOS_UI_SOURCE_TRUTH__: JSON.stringify(buildMetadata.sourceTruth),
    __STEPHANOS_UI_BUILD_METADATA__: JSON.stringify(buildMetadata),
  },
  server: {
    host: true,
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: '../apps/stephanos/dist',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        banner: generatedAssetBanner,
      },
    },
  },
});
