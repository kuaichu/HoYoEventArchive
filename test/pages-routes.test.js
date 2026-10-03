import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';

test('the archive deploys as a static public app without an admin entry or authentication function', async () => {
  for (const path of ['admin.html', 'functions/_middleware.js', 'public/_routes.json']) {
    await assert.rejects(access(new URL(`../${path}`, import.meta.url)), { code: 'ENOENT' });
  }
  const config = await readFile(new URL('../vite.config.js', import.meta.url), 'utf8');
  assert.doesNotMatch(config, /admin/);
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  assert.doesNotMatch(html, /href=["']\/admin(?:[./"'])/);
});
