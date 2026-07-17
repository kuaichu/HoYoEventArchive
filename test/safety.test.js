import assert from 'node:assert/strict';
import test from 'node:test';

import {
  escapeHtml,
  isAvailable,
  isFeaturedEvent,
  normalizeBookmarks,
  safeExternalUrl,
  safeScreenshotUrl
} from '../src/event-domain.js';

test('HTML escaping neutralizes text and attribute injection characters', () => {
  assert.equal(
    escapeHtml(`&<>"' <img src=x onerror=alert(1)>`),
    '&amp;&lt;&gt;&quot;&#39; &lt;img src=x onerror=alert(1)&gt;'
  );
});

test('external URLs allow only absolute credential-free HTTP(S)', () => {
  assert.equal(safeExternalUrl('https://act.mihoyo.com/event'), 'https://act.mihoyo.com/event');
  assert.equal(safeExternalUrl('http://example.com/path'), 'http://example.com/path');
  assert.equal(
    safeExternalUrl('https://act.mihoyo.com/ys/event/example/index.html?game_biz=hk4e_cn&mhy_presentation_style=fullscreen&utm_source=bbs'),
    'https://act.mihoyo.com/ys/event/example/index.html'
  );
  assert.equal(safeExternalUrl('javascript:alert(1)'), null);
  assert.equal(safeExternalUrl('data:text/html,test'), null);
  assert.equal(safeExternalUrl('https://user:pass@example.com'), null);
  assert.equal(safeExternalUrl('/relative'), null);
});

test('screenshot paths accept only archive IDs', () => {
  assert.equal(safeScreenshotUrl('ys-12'), '/images/screenshots/ys-12.png');
  assert.equal(
    safeScreenshotUrl('ys-12', 'deploy-2026/07/17'),
    '/images/screenshots/ys-12.png?v=deploy-2026%2F07%2F17'
  );
  assert.equal(safeScreenshotUrl(`ys-1" onerror="alert(1)`), null);
  assert.equal(safeScreenshotUrl('../secret'), null);
});

test('bookmark normalization survives corrupt shapes and removes duplicates', () => {
  assert.deepEqual(normalizeBookmarks(['ys-1', 'ys-1', 3, '', 'sr-1']), ['ys-1', 'sr-1']);
  assert.deepEqual(normalizeBookmarks({ broken: true }), []);
});

test('availability and featured semantics are explicit', () => {
  assert.equal(isAvailable({ status: '可访问' }), true);
  assert.equal(isAvailable({ status: '需登录' }), false);
  assert.equal(isAvailable({ status: '已结束' }), false);
  assert.equal(isFeaturedEvent({ title: '周年庆活动', tags: [] }), true);
  assert.equal(isFeaturedEvent({ title: '普通活动', tags: [] }), false);
});
