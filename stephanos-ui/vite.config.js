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
  buildTarget: process.env.STEPHANOS_BUILD_TARGET || 'apps/stephanos/dist',
  runtimeMarker: process.env.STEPHANOS_BUILD_RUNTIME_MARKER || 'stephanos-ui/runtime::dist-synced-v1',
  gitCommit: process.env.STEPHANOS_BUILD_GIT_COMMIT || 'git-unavailable',
  buildTimestamp: process.env.STEPHANOS_BUILD_TIMESTAMP || new Date().toISOString(),
};

const generatedAssetBanner = [
  '/* GENERATED FILE: Stephanos dist asset. */',
  '/* Do not edit manually. Source lives in stephanos-ui/src/** and is published via npm run build. */',
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
            attrs: { name: 'stephanos-build-target', content: metadata.buildTarget },
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
            tag: 'script',
            injectTo: 'head',
            attrs: { id: 'stephanos-build-metadata', type: 'application/json' },
            children: metadataJson,
          },
        ],
      };
    },
    generateBundle(_options, bundle) {
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
    __STEPHANOS_UI_VERSION__: JSON.stringify(buildMetadata.version),
    __STEPHANOS_UI_SOURCE__: JSON.stringify(buildMetadata.sourceIdentifier),
    __STEPHANOS_UI_BUILD_TARGET__: JSON.stringify(buildMetadata.buildTarget),
    __STEPHANOS_UI_BUILD_METADATA__: JSON.stringify(buildMetadata),
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
