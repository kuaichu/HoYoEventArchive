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

test('public filters expose an accessible version select and clear action', () => {
  assert.match(html, /<label[^>]*for="versionFilter"[^>]*>版本筛选<\/label>/);
  assert.match(html, /<select[^>]*id="versionFilter"[^>]*disabled/);
  assert.match(html, /<button[^>]*id="clearFiltersBtn"[^>]*>[^<]*(?:<[^>]+>[^<]*<\/[^>]+>[^<]*)*清除筛选/);
});

test('route-replayed tab and layout toggles expose assistive selected state', () => {
  assert.match(html, /data-subtab="all"[^>]*aria-pressed="true"/);
  assert.match(html, /id="viewGrid"[^>]*aria-pressed="true"/);
  assert.match(html, /id="viewList"[^>]*aria-pressed="false"/);
});
