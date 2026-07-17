import { defineConfig } from 'vite';
import { resolve } from 'path';

const screenshotVersion = process.env.GITHUB_SHA || process.env.CF_PAGES_COMMIT_SHA || '';

export default defineConfig({
  define: {
    __SCREENSHOT_VERSION__: JSON.stringify(screenshotVersion)
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        admin: resolve(__dirname, 'admin.html')
      }
    }
  }
});
