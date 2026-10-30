import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from '../../../stephanos-ui/node_modules/vite/dist/node/index.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const uiModules = path.resolve(root, '../../../stephanos-ui/node_modules');
export default defineConfig({
  root,
  esbuild: { jsx: 'automatic' },
  resolve: { alias: [
    { find: '../state/aiStore', replacement: path.join(root, 'store.jsx') },
    { find: /^react-dom(\/.*)?$/, replacement: `${uiModules.replaceAll('\\', '/')}/react-dom$1` },
    { find: /^react(\/.*)?$/, replacement: `${uiModules.replaceAll('\\', '/')}/react$1` },
  ] },
  server: { host: '127.0.0.1', port: 5184, strictPort: true, fs: { allow: [path.resolve(root, '../../..')] } },
});
