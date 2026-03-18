import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const packageJsonPath = fileURLToPath(new URL('./package.json', import.meta.url));
const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));

export default defineConfig({
  plugins: [react()],
  // Source of truth: the live Stephanos UI is authored in stephanos-ui/src and built into apps/stephanos/dist.
  // Relative asset URLs are required because the production app is launched from /apps/stephanos/dist/index.html,
  // including when the repository is hosted from the GitHub Pages subpath /stephan-os/.
  base: './',
  define: {
    __STEPHANOS_UI_VERSION__: JSON.stringify(packageJson.version),
    __STEPHANOS_UI_SOURCE__: JSON.stringify('stephanos-ui/src'),
    __STEPHANOS_UI_BUILD_TARGET__: JSON.stringify('apps/stephanos/dist'),
  },
  build: {
    outDir: '../apps/stephanos/dist',
    emptyOutDir: true,
  },
});
