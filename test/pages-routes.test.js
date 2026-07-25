import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('Cloudflare Pages Functions are limited to the admin namespace', async () => {
  const config = JSON.parse(await readFile(new URL('../public/_routes.json', import.meta.url)));
  assert.equal(config.version, 1);
  assert.deepEqual(new Set(config.include), new Set([
    '/admin',
    '/admin/*',
    '/admin.html',
    '/admin.html/*'
  ]));
  assert.deepEqual(config.exclude, []);
  for (const publicPath of [
    '/', '/events', '/games/ys', '/timeline', '/reports', '/returns', '/expired', '/favorites', '/about'
  ]) {
    assert.equal(config.include.some(route => publicPath.startsWith(route.replace('/*', '/'))), false);
  }
});
