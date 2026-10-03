import { defineConfig } from 'vite';

const screenshotVersion = process.env.GITHUB_SHA || process.env.CF_PAGES_COMMIT_SHA || '';

export default defineConfig({
  define: {
    __SCREENSHOT_VERSION__: JSON.stringify(screenshotVersion)
  }
});
