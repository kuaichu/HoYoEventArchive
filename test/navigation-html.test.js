import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');

test('every primary navigation item exposes its canonical href', () => {
  const expected = new Map([
    ['home', '/'],
    ['library', '/events'],
    ['timeline', '/timeline'],
    ['reports', '/reports'],
    ['reflow', '/returns'],
    ['expired', '/expired'],
    ['about', '/about']
  ]);

  for (const [tab, href] of expected) {
    assert.match(
      html,
      new RegExp(`<a[^>]*class="[^"]*nav-item[^"]*"[^>]*data-tab="${tab}"[^>]*href="${href.replace('/', '\\/')}"`)
    );
  }
});

test('game portals and atomic archive actions expose real route links', () => {
  for (const gameKey of ['ys', 'sr', 'zzz', 'bh3']) {
    assert.match(
      html,
      new RegExp(`<a[^>]*class="[^"]*portal-card[^"]*"[^>]*data-game="${gameKey}"[^>]*href="\\/games\\/${gameKey}"`)
    );
  }
  assert.match(html, /<a[^>]*id="backToHomeBtn"[^>]*href="\/"/);
  assert.match(html, /<a[^>]*id="recentMoreBtn"[^>]*href="\/events"/);
  assert.match(
    html,
    /<a[^>]*class="[^"]*control-tab[^"]*"[^>]*data-subtab="favorites"[^>]*href="\/favorites"[^>]*data-route-link/
  );
});
