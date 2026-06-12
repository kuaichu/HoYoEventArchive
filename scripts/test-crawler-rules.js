import assert from 'node:assert/strict';
import {
  canonicalizeEventUrl,
  classifyEventType,
  getAnnouncementDate,
  isPermanentResourceUrl
} from './crawler-rules.js';

const permanentResources = [
  'https://webstatic.mihoyo.com/bbs/event/bbs-lineup-hkrpg/index.html#/home',
  'https://act.mihoyo.com/zzz/event/character-builder/index.html#/',
  'https://act.mihoyo.com/sr/event/cultivation-tool/index.html',
  'https://webstatic.mihoyo.com/app/community-game-records/rpg/index.html',
  'https://webstatic.mihoyo.com/sr/app/interactive-map/index.html#/map/682'
];

permanentResources.forEach(url => {
  assert.equal(isPermanentResourceUrl(url), true, `Expected permanent resource: ${url}`);
});

const realActivities = [
  'https://act.mihoyo.com/ys/event/e20260610sports/index.html',
  'https://act.mihoyo.com/puzzle/hkrpg/e20260522example/index.html',
  'https://webstatic.mihoyo.com/ys/event/e20210601blue_post/vert.html?page_sn=abc123'
];

realActivities.forEach(url => {
  assert.equal(isPermanentResourceUrl(url), false, `Expected event page: ${url}`);
});

assert.equal(
  canonicalizeEventUrl('https://example.com/event/index.html?page_sn=abc&utm_source=bbs'),
  'https://example.com/event/index.html?page_sn=abc'
);
assert.notEqual(
  canonicalizeEventUrl('https://example.com/event/index.html?page_sn=abc'),
  canonicalizeEventUrl('https://example.com/event/index.html?page_sn=def')
);
assert.equal(
  canonicalizeEventUrl('https://example.com/event/index.html?utm_source=a'),
  canonicalizeEventUrl('https://example.com/event/index.html?utm_source=b')
);

assert.equal(
  getAnnouncementDate({ post: { created_at: Date.parse('2026-06-10T16:30:00Z') / 1000 } }),
  '2026.06.11'
);
assert.equal(getAnnouncementDate({ post: {} }), null);

assert.equal(classifyEventType('《崩坏3》8.9版本前瞻'), '版本前瞻');
assert.equal(classifyEventType('《原神》版本前瞻特别节目'), '版本前瞻');
assert.equal(classifyEventType('3.0版本前瞻预热'), '版本前瞻');
assert.equal(classifyEventType('浮生孰来 八重神子预热小游戏'), '小游戏');
assert.equal(classifyEventType('群星邀约 预抽卡'), '预约/预抽卡');

console.log('Crawler rules passed.');
