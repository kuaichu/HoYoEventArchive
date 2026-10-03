import test from 'node:test';
import assert from 'node:assert/strict';
import {
  NEWS_SOURCES, extractAnnouncementLinks, normalizeOfficialNews,
  fetchOfficialNews, fetchOfficialNewsDetail
} from '../scripts/official-news.js';

const activity = 'https://act.mihoyo.com/sr/event/example/index.html';
const cover = 'https://fastcdn.mihoyo.com/cover.png';
const lookupImpl = async () => [{ address: '8.8.8.8', family: 4 }];
const settings = { lookupImpl, retryDelayMs: 0 };
const record = (id = 123, overrides = {}) => ({ iInfoId: id, sTitle: '网页活动公告',
  sContent: `<p>正文</p><a href="${activity}?a=1&amp;b=2">参与活动</a>`,
  sExt: JSON.stringify({ 'news-poster': [{ name: 'cover.png', url: cover }] }),
  dtStartTime: '2026-09-28 08:00:00', dtEndTime: '2099-01-01 00:00:00', ...overrides });
const response = (list, iTotal = list.length) => new Response(JSON.stringify({ retcode: 0, data: { list, iTotal } }));

test('official news preserves full HTML, China publication date, and distinct source identity', () => {
  const item = record();
  const normalized = normalizeOfficialNews('sr', item);
  assert.equal(normalized.post.subject, item.sTitle);
  assert.equal(normalized.post.content, item.sContent);
  assert.equal(normalized.post.created_at, Date.parse('2026-09-28T00:00:00Z') / 1000);
  assert.deepEqual(normalized.news_meta, { start_at_sec: normalized.post.created_at });
  assert.equal(normalized.post.cover, cover);
  assert.equal(normalized.sourceNewsId, '123');
  assert.equal(normalized.sourceNewsUrl, 'https://sr.mihoyo.com/news/123');
  assert.equal(normalized.sourceKind, 'official-news');
  assert.equal(normalized.post.post_id, undefined);
  assert.equal(normalized.sourcePostId, undefined);
  assert.equal(normalized.news_meta.end_at_sec, undefined);
  assert.deepEqual(normalized.links, [`${activity}?a=1&b=2`]);
  assert.equal(normalizeOfficialNews('ys', item).sourceNewsUrl, 'https://ys.mihoyo.com/main/news/detail/123');
  assert.equal(normalizeOfficialNews('bh3', item).sourceNewsUrl, 'https://bh3.mihoyo.com/news/693/123');
});

test('HTML attributes decode entities and ignore script, style, comment and unrelated links', () => {
  const short = 'https://mhyurl.cn/example';
  assert.deepEqual(extractAnnouncementLinks(`
    <!-- <a href="${activity}?comment"> -->
    <SCRIPT>const x = '<a href="${activity}?script">';</SCRIPT>
    <style>/* <a href="${activity}?style"> */</style>
    <a data-href="${activity}?wrong" href='${activity}?a=1&#38;b=2'>活动</a>
    <a href=${short}>短链</a><a href="${short}">重复</a>
    <a href="&#104;ttps://act.mihoyo.com/ys/event/another/index.html">实体</a>
    <a href="/event/relative"><a href="javascript:alert(1)">
    <a href="https://example.com/event"><a href="https://act.mihoyo.com/common/help">
    <a href="https://user:secret@act.mihoyo.com/sr/event/example/index.html">
  `), [`${activity}?a=1&b=2`, short, 'https://act.mihoyo.com/ys/event/another/index.html']);
  assert.deepEqual(normalizeOfficialNews('sr', record(123, { sContent: '', sUrl: short })).links, [short]);
  assert.deepEqual(extractAnnouncementLinks(`<script>const broken = '<a href="${activity}">';`), []);
});

test('game-specific CMS covers precede body images and large bh3 artwork precedes thumbnails', () => {
  for (const [gameKey, key] of [['ys', '720_1'], ['sr', 'news-poster'], ['zzz', 'news-banner'], ['bh3', '697_1']]) {
    const normalized = normalizeOfficialNews(gameKey, record(123, {
      sExt: JSON.stringify({ '697_0': [{ url: `${cover}?thumbnail` }], [key]: [{ url: cover }] }),
      sContent: `<img src="${cover}?body">`
    }));
    assert.equal(normalized.post.cover, cover, gameKey);
  }
  assert.equal(normalizeOfficialNews('sr', record(123, { sExt: '{broken',
    sContent: `<script>'<img src="${cover}?script">'</script><img src="${cover}?a=1&amp;b=2">`
  })).post.cover, `${cover}?a=1&b=2`);
  assert.equal(normalizeOfficialNews('sr', record(123, { sExt: '{}', sContent: '<img src="http://localhost/x">' })).post.cover, null);
});

test('malformed identities, titles, publication dates and content are rejected', () => {
  for (const changes of [{ iInfoId: 0 }, { iInfoId: 'NaN' }, { iInfoId: 1.5 },
    { sTitle: ' ' }, { sTitle: null }, { dtStartTime: '2026-02-30 08:00:00' },
    { dtStartTime: '2026-09-28 24:00:00' }, { dtStartTime: '' }, { sContent: null }]) {
    assert.equal(normalizeOfficialNews('sr', record(123, changes)), null);
  }
  assert.equal(normalizeOfficialNews('unknown', record()), null);
});

test('list requests use each official app and channel with bounded defaults', async () => {
  for (const gameKey of Object.keys(NEWS_SOURCES)) {
    let request;
    const result = await fetchOfficialNews({ gameKey }, async url => { request = new URL(url); return response([]); }, settings);
    assert.deepEqual(result, { posts: [], status: 'ok', error: null });
    assert.equal(request.hostname, NEWS_SOURCES[gameKey].host);
    assert.equal(request.pathname, `/content_v2_user/app/${NEWS_SOURCES[gameKey].appId}/getContentList`);
    assert.equal(request.searchParams.get('iChanId'), String(NEWS_SOURCES[gameKey].channelId));
    assert.equal(request.searchParams.get('iPageSize'), '20');
    assert.equal(request.searchParams.get('sLangKey'), 'zh-cn');
  }
});

test('pagination follows total through short pinned pages and deduplicates IDs', async () => {
  const pages = [];
  const result = await fetchOfficialNews('sr', async url => {
    const page = Number(new URL(url).searchParams.get('iPage'));
    pages.push(page);
    return response(page === 1 ? [record(123)] : [record(123), record(124)], 4);
  }, { ...settings, pageSize: 2 });
  assert.deepEqual(pages, [1, 2]);
  assert.deepEqual(result.posts.map(item => item.sourceNewsId), ['123', '124']);
  assert.equal(result.status, 'ok');
});

test('configured pagination limits are clamped and a requested window finishes successfully', async () => {
  const result = await fetchOfficialNews('sr', async url => {
    assert.equal(new URL(url).searchParams.get('iPageSize'), '100');
    return response([record()], 1000);
  }, { ...settings, pageSize: 999, maxPages: 1 });
  assert.equal(result.status, 'ok');
  assert.equal(result.posts.length, 1);
});

test('invalid records and failed later pages retain valid posts with partial status', async () => {
  const mixed = await fetchOfficialNews('sr', async () => response([record(), record(124, { sTitle: '' })]), settings);
  assert.equal(mixed.status, 'partial');
  assert.equal(mixed.posts.length, 1);
  const malformed = await fetchOfficialNews('sr', async () => response([record(124, { sTitle: '' })]), settings);
  assert.equal(malformed.status, 'failed');
  const later = await fetchOfficialNews('sr', async url => Number(new URL(url).searchParams.get('iPage')) === 1
    ? response([record()], 2) : new Response('{}', { status: 404 }), { ...settings, pageSize: 1 });
  assert.equal(later.status, 'partial');
  assert.equal(later.posts.length, 1);
  assert.match(later.error, /HTTP 404/);
  const empty = await fetchOfficialNews('sr', async () => response([], 1), settings);
  assert.equal(empty.status, 'failed');
});

test('network, 429 and server failures get one retry; retcodes and malformed JSON do not', async () => {
  for (const first of [() => { throw new TypeError('fetch failed'); },
    () => new Response('', { status: 429 }), () => new Response('', { status: 503 })]) {
    let calls = 0;
    const result = await fetchOfficialNews('sr', async () => ++calls === 1 ? first() : response([record()]), settings);
    assert.equal(result.status, 'ok');
    assert.equal(calls, 2);
  }
  for (const body of [JSON.stringify({ retcode: 1034, message: 'verification required' }), '{broken',
    JSON.stringify({ retcode: 0, data: { list: [] } })]) {
    let calls = 0;
    const result = await fetchOfficialNews('sr', async () => { calls++; return new Response(body); }, settings);
    assert.equal(result.status, 'failed');
    assert.equal(calls, 1);
  }
});

test('response byte limits and timeout fail without retrying malformed oversized results', async () => {
  let calls = 0;
  const oversized = await fetchOfficialNews('sr', async () => { calls++; return response([record()]); }, { ...settings, maxBytes: 10 });
  assert.equal(oversized.status, 'failed');
  assert.equal(calls, 1);
  assert.match(oversized.error, /size limit/);
  const timedOut = await fetchOfficialNews('sr', async () => new Promise(() => {}), { ...settings, timeoutMs: 5, maxAttempts: 1 });
  assert.equal(timedOut.status, 'failed');
  assert.match(timedOut.error, /timed out/);
});

test('detail returns a matching normalized record and rejects unrelated or invalid records', async () => {
  const item = await fetchOfficialNewsDetail('sr', '123', { ...settings, fetchImpl: async url => {
    const requested = new URL(url);
    assert.equal(requested.pathname.endsWith('/getContent'), true);
    assert.equal(requested.searchParams.get('iInfoId'), '123');
    return response([record()]);
  } });
  assert.equal(item.sourceNewsId, '123');
  await assert.rejects(fetchOfficialNewsDetail('sr', '123', { ...settings,
    fetchImpl: async () => response([record(124)]) }), /missing or invalid/);
  await assert.rejects(fetchOfficialNewsDetail('sr', '../123', { ...settings,
    fetchImpl: async () => { throw new Error('should not request'); } }), /Invalid/);
});

test('all four detail APIs accept direct data records and strictly match the requested ID', async () => {
  for (const gameKey of Object.keys(NEWS_SOURCES)) {
    const apiRecord = record(123, { sChanId: String(NEWS_SOURCES[gameKey].channelId),
      sIntro: '公告简介', sUrl: '', around: {} });
    const fetchImpl = async () => new Response(JSON.stringify({ retcode: 0, data: apiRecord }));
    const detail = await fetchOfficialNewsDetail(gameKey, '123', { ...settings, fetchImpl });
    assert.equal(detail.sourceNewsId, '123', gameKey);
    assert.equal(detail.post.content, apiRecord.sContent, gameKey);
    await assert.rejects(fetchOfficialNewsDetail(gameKey, '124', { ...settings, fetchImpl }), /missing or invalid/);
  }
  for (const data of [{}, { unexpected: record() }, { list: record() }, [record()]]) {
    await assert.rejects(fetchOfficialNewsDetail('sr', '123', { ...settings,
      fetchImpl: async () => new Response(JSON.stringify({ retcode: 0, data })) }), /invalid/);
  }
});

test('list APIs reject direct detail records rather than treating them as empty pages', async () => {
  const result = await fetchOfficialNews('sr', async () => new Response(JSON.stringify({ retcode: 0, data: record() })), settings);
  assert.equal(result.status, 'failed');
  assert.match(result.error, /invalid list/);
});
