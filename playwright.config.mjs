import { defineConfig } from '@playwright/test';
export default defineConfig({ testDir:'tests/ui-reality', use:{ baseURL:'http://127.0.0.1:4173' }, webServer:{ command:'npm run stephanos:build && npm run stephanos:serve', port:4173, reuseExistingServer:true, timeout:120000 } });
