import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchActivityTime, extractActivityI18nConfigs } from '../scripts/activity-time-sources.js';

const lookupImpl = async () => [{ address: '8.8.8.8', family: 4 }];
const event = (path, extra = {}) => ({ url: `https://act.mihoyo.com${path}`, gameKey: 'ys', date: '2026.09.28', ...extra });
const settings = fetchImpl => ({ fetchImpl, lookupImpl });
const json = data => new Response(JSON.stringify({ retcode: 0, data }));
const act = { act_id: 'e123', post_start_time: '2026-09-28 11:00:00', post_end_time: '2026-10-18 23:59:59',
  start_time: '2026-09-28 11:00:00', end_time: '2026-10-30 20:00:00', act_award_start_time: '2026-10-19 00:00:00' };

test('contribution uses submission period and verifies activity ID and request headers', async () => {
  const result = await fetchActivityTime(event('/ys/event/doujin-collection/index.html?id=e123&act_id=e123'), settings(async (url, init) => {
    assert.equal(url, 'https://api-takumi.mihoyo.com/event/contributionv2/actInfo');
    assert.equal(init.headers['x-rpc-act_id'], 'e123');
    assert.equal(init.headers.Cookie, undefined);
    assert.equal(init.method, undefined);
    return json({ act });
  }));
  assert.equal(result.status, 'ok');
  assert.equal(result.endAt, '2026-10-18T23:59:59+08:00');
  assert.equal(result.timeStages[0].endAt, '2026-10-30T20:00:00+08:00');
  assert.deepEqual(result.timeStages[1], { name: '评奖', startAt: '2026-10-19T00:00:00+08:00' });
  const wrong = await fetchActivityTime(event('/bbs/event/doujin-collect/index.html?id=e123'), settings(async () => json({ act: { ...act, act_id: 'e999' } })));
  assert.equal(wrong.status, 'failed');
  assert.equal(wrong.startAt, undefined);
});

test('contribution rejects inverted or zero dates and retains a valid partial', async () => {
  const result = await fetchActivityTime(event('/bbs/event/doujin-collect/index.html?id=e123'), settings(async () => json({ act: {
    ...act, post_start_time: '0000-00-00 00:00:00', post_end_time: '2026-10-18 23:59:59'
  } })));
  assert.equal(result.status, 'partial');
  assert.equal(result.startAt, undefined);
  assert.equal(result.endAt, '2026-10-18T23:59:59+08:00');
  const inverted = await fetchActivityTime(event('/bbs/event/doujin-collect/index.html?id=e123'), settings(async () => json({ act: {
    ...act, post_start_time: '2026-10-19 00:00:00'
  } })));
  assert.equal(inverted.startAt, undefined);
  assert.equal(inverted.endAt, undefined);
});

test('draw rules use only activity section and never request logged-in index', async () => {
  const result = await fetchActivityTime(event('/bbs/event/bbs-event-ccl/index.html?id=e123'), settings(async url => {
    assert.match(url, /\/skinV2\?act_id=e123$/);
    return json({ rule: '<p>活动时间：</p><p>2026/5/22 12:00-2026/5/24 23:59</p><p>奖池时间：2026/1/1-2026/12/31</p>' });
  }));
  assert.equal(result.status, 'ok');
  assert.equal(result.endAt, '2026-05-24T23:59+08:00');
});

test('live source adds a stage without replacing the participation window', async () => {
  const result = await fetchActivityTime(event('/bbs/event/live/index.html?act_id=e123'), settings(async () => json({ live: {
    start: '2026-09-28 20:00:00', end: '2026-09-28 21:00:00'
  } })));
  assert.equal(result.status, 'partial');
  assert.equal(result.startAt, undefined);
  assert.equal(result.timeStages[0].name, '直播');
});

test('sign-in bonus must match archived phase, and no bonus means recurring service', async () => {
  const item = event('/bbs/event/signin/bh3/index.html?act_id=e123', { gameKey: 'bh3', startDate: '2023.06.20' });
  const data = { has_extra_award: true, short_extra_award: { start_time: '2026-09-28 00:00:00', end_time: '2026-10-28 23:59:59' } };
  assert.equal((await fetchActivityTime(item, settings(async () => json(data)))).startAt, undefined);
  const matching = await fetchActivityTime({ ...item, startDate: '2026.09.28' }, settings(async () => json(data)));
  assert.equal(matching.status, 'ok');
  const recurring = await fetchActivityTime(item, settings(async () => json({ has_extra_award: false })));
  assert.equal(recurring.status, 'permanent');
  assert.equal(recurring.endAt, undefined);
});

test('business initialization establishes morax, s3, and old default config routes', () => {
  const call = zone => `(0,n.initAppI18n)(Vue,{appId:"m08221019291721",gameBiz:"hk4e_cn"${zone ? `,zone:"${zone}"` : ''}});`;
  assert.match(extractActivityI18nConfigs(call('morax'))[0].url, /^https:\/\/fastcdn\.mihoyo\.com\/mi18n\//);
  assert.match(extractActivityI18nConfigs(call('s3'))[0].url, /^https:\/\/webstatic\.hoyoverse\.com\/admin\/mi18n\//);
  assert.match(extractActivityI18nConfigs(call())[0].url, /^https:\/\/webstatic\.mihoyo\.com\/admin\/mi18n\//);
  assert.deepEqual(extractActivityI18nConfigs('const defaults={appId:"m20260728hy2gymysqo",gameBiz:"hk4e_cn"};'), []);
  assert.deepEqual(extractActivityI18nConfigs(call('morax'), { gameKey: 'sr' }), []);
  const old = '$=function(){var t=K(function t(e,r,n){var i; return H.install(e,{uniqueID:r,mi18nGameBiz:n,appEnv:i});});}; $(Vue,"m08111424221081",game.biz,env,lang);';
  assert.match(extractActivityI18nConfigs(old, { gameKey: 'ys' })[0].url, /hk4e_cn\/m08111424221081\//);
  assert.deepEqual(extractActivityI18nConfigs('$(Vue,"m08111424221081",game.biz,env,lang);', { gameKey: 'ys' }), []);
});

test('static discovery consumes real scripts only, prioritizes bounded entry, and retains minute precision', async () => {
  const seen = [];
  const result = await fetchActivityTime(event('/ys/event/example/index.html'), settings(async (url, init) => {
    seen.push(url);
    if (url.endsWith('.html')) return new Response(`
      <!-- <script src="index_comment.js"></script> -->
      <script>const fake = '<script src="index_fake.js">';</script>
      <script src="https://example.com/index_bad.js"></script>
      <script src="../index_escape.js"></script>
      <script src="vendor_test.js"></script><script src="index_test.js"></script>`);
    if (url.endsWith('index_test.js')) {
      assert.equal(init.headers.Range, 'bytes=0-2097151');
      return new Response('(0,x.initAppI18n)(Vue,{appId:"m20260728hy2gymysqo",gameBiz:g.iG,zone:"morax"});', { status: 206 });
    }
    assert.match(url, /fastcdn\.mihoyo\.com\/mi18n\/hk4e_cn\/m20260728hy2gymysqo\//);
    return new Response(JSON.stringify({ 'rule-content': '活动时间：2026年9月28日11:00至2026年10月18日23:59' }));
  }));
  assert.equal(result.status, 'ok');
  assert.equal(result.startAt, '2026-09-28T11:00+08:00');
  assert.equal(seen.length, 3);
});

test('shared cache includes header identity, caches failed URLs, and enforces request budget', async () => {
  let calls = 0;
  const cache = new Map();
  const item = event('/bbs/event/doujin-collect/index.html?id=e123');
  const options = { ...settings(async () => { calls++; return new Response('unavailable', { status: 503 }); }), cache };
  assert.equal((await fetchActivityTime(item, options)).status, 'failed');
  assert.equal((await fetchActivityTime(item, options)).requests, 0);
  assert.equal(calls, 1);
  const budget = await fetchActivityTime(event('/ys/event/example/index.html'), {
    ...settings(async () => new Response('<script src="index_test.js"></script>')), maxRequests: 1
  });
  assert.equal(budget.requests, 1);
  assert.match(budget.error, /budget/);
});

test('private DNS, private redirects, unsafe URL, invalid JSON, and API auth failure remain unavailable', async () => {
  let calls = 0;
  const fetchImpl = async () => { calls++; return new Response('', { status: 302, headers: { location: 'http://127.0.0.1/x' } }); };
  assert.equal((await fetchActivityTime({ url: 'http://localhost/x' }, settings(fetchImpl))).status, 'failed');
  assert.equal(calls, 0);
  assert.equal((await fetchActivityTime(event('/ys/event/test/index.html'), { fetchImpl, lookupImpl: async () => [{ address: '127.0.0.1' }] })).status, 'failed');
  assert.equal(calls, 0);
  assert.equal((await fetchActivityTime(event('/ys/event/test/index.html'), settings(fetchImpl))).status, 'failed');
  assert.equal(calls, 1);
  const item = event('/bbs/event/live/index.html?act_id=e123');
  assert.equal((await fetchActivityTime(item, settings(async () => new Response('{bad')))).status, 'failed');
  const auth = await fetchActivityTime(item, settings(async () => new Response(JSON.stringify({ retcode: -100, message: 'Please login' }))));
  assert.equal(auth.status, 'missing');
  assert.equal(auth.startAt, undefined);
});

test('source byte budget and hanging requests terminate without claiming activity dates', async () => {
  const item = event('/ys/event/example/index.html');
  const oversized = await fetchActivityTime(item, { ...settings(async () => new Response('x'.repeat(101))), maxBytes: 100 });
  assert.equal(oversized.status, 'failed');
  assert.match(oversized.error, /size limit/);
  const timeout = await fetchActivityTime(item, { ...settings(async () => new Promise(() => {})), timeoutMs: 10 });
  assert.equal(timeout.status, 'failed');
  assert.match(timeout.error, /timed out/);
});

test('explicit official act-path alias discovers primary rule without substituting invite sub-event', async () => {
  const result = await fetchActivityTime(event('/zzz/event/campaign/index.html', { gameKey: 'zzz' }), settings(async url => {
    if (url.endsWith('.html')) return new Response('<script src="/act/zzz/event/campaign/index_test.js"></script>');
    if (url.endsWith('.js')) return new Response('n.initAppI18n(Vue,{appId:"m20240315hy4865c9og",gameBiz:"nap_cn",zone:"morax"});');
    return new Response(JSON.stringify({ invite_rule_content: '活动时间：2024/5/28 12:00:00至2024/7/2 09:59:59', act_rule_content: '活动时间：2024/5/28 12:00:00至2024/7/18 23:59:59' }));
  }));
  assert.equal(result.endAt, '2024-07-18T23:59:59+08:00');
});

test('canonical replacement campaign needs a consistent same-game entry and supporting bundle', async () => {
  const run = html => fetchActivityTime(event('/zzz/event/old/index.html', { gameKey: 'zzz' }), settings(async url => {
    if (url.endsWith('.html')) return new Response(html);
    if (url.endsWith('.js')) return new Response('n.initAppI18n(Vue,{appId:"m20251125hy1eh1xb0g",gameBiz:"nap_cn",zone:"morax"});');
    return new Response(JSON.stringify({ 'rule-tab1-content': '活动时间：2025年12月30日 2.5版本「微光引灯时」上线后至2026年2月6日05:59:59' }));
  }));
  const result = await run('<script src="/zzz/event/new/index_x.js"></script><script src="/zzz/event/new/vendors_x.js"></script>');
  assert.equal(result.status, 'ok');
  assert.equal(result.startDate, '2025.12.30');
  assert.match(result.timeSourceUrl, /m20251125hy1eh1xb0g/);
  for (const html of ['<script src="/zzz/event/new/index_x.js"></script>', '<script src="/ys/event/new/index_x.js"></script><script src="/ys/event/new/vendors_x.js"></script>', '<script src="/zzz/event/new/index_x.js"></script><script src="/zzz/event/other/vendors_x.js"></script>']) {
    const refused = await run(html);
    assert.equal(refused.status, 'missing');
    assert.equal(refused.requests, 1);
  }
});

test('large referenced entry may use bounded tail and config rule description', async () => {
  const seen = [];
  const result = await fetchActivityTime(event('/zzz/event/campaign/index.html', { gameKey: 'zzz' }), settings(async (url, init) => {
    seen.push(init.headers.Range);
    if (url.endsWith('.html')) return new Response('<script src="index_large.js"></script>');
    if (url.endsWith('.js')) return init.headers.Range === 'bytes=0-2097151'
      ? new Response('x'.repeat(2097152), { status: 206 })
      : new Response('n.initAppI18n(Vue,{appId:"m20251014hy2e1kt0jk",gameBiz:"nap_cn",zone:"morax"});', { status: 206 });
    return new Response(JSON.stringify({ rule_desc_1_1: '活动时间：2026/01/30 10:00~2026/02/09 03:59' }));
  }));
  assert.equal(result.status, 'ok');
  assert.equal(result.requests, 4);
  assert.ok(seen.includes('bytes=-2097152'));
  assert.equal(result.endAt, '2026-02-09T03:59+08:00');
});

test('content rule and explicit event_time are trusted fields while unrelated labels remain ignored', async () => {
  const run = data => fetchActivityTime(event('/sr/event/campaign/index.html', { gameKey: 'sr' }), settings(async url => {
    if (url.endsWith('.html')) return new Response('<script src="index_x.js"></script>');
    if (url.endsWith('.js')) return new Response('n.initAppI18n(Vue,{appId:"m20221216hy43jrmiv4",gameBiz:"hkrpg_cn",zone:"s3"});');
    return new Response(JSON.stringify(data));
  }));
  assert.equal((await run({ content_rule: '活动时间：2023/12/30 12:00～2024/1/5 12:00' })).status, 'ok');
  assert.equal((await run({ event_time: '2023/8/30 07:00～10/11 06:00 UTC+8' })).endAt, '2023-10-11T06:00+08:00');
  assert.equal((await run({ some_text: '活动时间：2023/12/30 12:00～2024/1/5 12:00' })).status, 'missing');
  assert.equal((await run({ 'rule-content': '活动时间：4.6版本期间' })).versionPeriod, 'v4.6');
  assert.equal((await run({ content_modal_rule: '活动时间：2023年11月15日7:00～2023年12月27日6:00' })).status, 'ok');
  assert.equal((await run({ 'active-rules-content': '2.活动周期\n（1）作品投稿期：2026年7月10日12:00 至 2026年8月31日23:59。\n（2）作品评审期：2026年9月15日前。' })).endAt, '2026-08-31T23:59+08:00');
  const annual = await run({ sys_rules_content: '活动时间：2026/04/26 12:00-2026/05/07 23:59\n活动介绍：年度数据统计自2025/04/01 00:00至2026/03/31 23:59' });
  assert.equal(annual.startAt, '2026-04-26T12:00+08:00');
});
