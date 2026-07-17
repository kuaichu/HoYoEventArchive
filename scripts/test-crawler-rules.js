import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  canonicalizeEventUrl,
  classifyEventType,
  getAnnouncementDate,
  isEventCandidateUrl,
  isPermanentResourceUrl,
  resolveEventUrl,
  selectEventTitle
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

assert.equal(isEventCandidateUrl('https://act.mihoyo.com/zzz/event/example/index.html'), true);
assert.equal(isEventCandidateUrl('https://mhyurl.cn/ufdx1aofg'), true);
assert.equal(isEventCandidateUrl('https://example.com/not-an-event'), false);

const finalZzzUrl = 'https://act.mihoyo.com/zzz/event/e20260717reserve-pvy5cf/index.html';
const redirectRequests = [];
const resolvedZzzUrl = await resolveEventUrl('https://mhyurl.cn/ufdx1aofg', async (url, options) => {
  redirectRequests.push({ url, options });
  if (url === 'https://mhyurl.cn/ufdx1aofg') {
    return {
      ok: false,
      status: 302,
      headers: { get: name => name.toLowerCase() === 'location' ? finalZzzUrl : null }
    };
  }
  return { ok: true, status: 200, headers: { get: () => null }, url };
});
assert.equal(resolvedZzzUrl, finalZzzUrl);
assert.equal(redirectRequests.length, 2);
assert.equal(redirectRequests[0].options.method, 'GET');
assert.equal(redirectRequests[0].options.redirect, 'manual');

let untrustedFetchCount = 0;
const rejectedRedirect = await resolveEventUrl('https://mhyurl.cn/untrusted', async () => {
  untrustedFetchCount++;
  return {
    ok: false,
    status: 302,
    headers: { get: () => 'https://example.com/phishing' }
  };
});
assert.equal(rejectedRedirect, null);
assert.equal(untrustedFetchCount, 1, 'Untrusted redirect targets must not be fetched');

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
assert.equal(classifyEventType('「恣锐锋镞」洛恩绘画征集活动开启'), '其他活动');

assert.equal(
  selectEventTitle('「月之七」版本活动祈愿预告第二期', '原神版本页'),
  '「月之七」版本活动祈愿预告第二期'
);
assert.equal(
  selectEventTitle('【有奖活动】洛恩绘画征集活动开启', '《原神》社区征集活动'),
  '【有奖活动】洛恩绘画征集活动开启'
);
assert.equal(
  selectEventTitle('公告标题', '早安，罗斯凯利法', '更长的分享标题'),
  '早安，罗斯凯利法'
);

const events = JSON.parse(fs.readFileSync(new URL('../src/events.json', import.meta.url), 'utf8'));
const ids = events.map(event => event.id);
assert.equal(new Set(ids).size, ids.length, 'Event IDs must be unique');

const canonicalUrls = events.map(event => canonicalizeEventUrl(event.url));
assert.equal(
  new Set(canonicalUrls).size,
  canonicalUrls.length,
  'Canonical event URLs must be unique'
);

console.log('Crawler rules passed.');
