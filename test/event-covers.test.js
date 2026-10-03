import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  archiveEventCover, detectImageExtension, extractPostCoverUrl, extractShareCoverUrl,
  hasValidLocalCover, normalizeCoverSourceUrl, readPublicResource
} from '../scripts/event-covers.js';
import { updateEventCovers } from '../scripts/update-covers.js';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jBz0AAAAASUVORK5CYII=', 'base64');
const SOURCE = 'https://upload-bbs.miyoushe.com/cover.png';
const lookupImpl = async () => [{ address: '8.8.8.8', family: 4 }];
const quietLogger = { log() {}, warn() {} };
const imageResponse = () => new Response(PNG, { headers: { 'content-type': 'image/png' } });
const newsResponse = (id = '456', cover = SOURCE) => new Response(JSON.stringify({ retcode: 0,
  data: { list: [{ iInfoId: Number(id), sTitle: '活动公告', sContent: `<p>活动说明</p><img src="${cover}">`,
    dtStartTime: '2026-09-28 08:00:00' }] } }));

test('a failed known image source can recover from the official news API', async t => {
  const outputDir = await temporaryDirectory(t);
  const stale = 'https://fastcdn.mihoyo.com/stale.png';
  const event = { id: 'sr-91', gameKey: 'sr', sourceNewsId: '456', coverSourceUrl: stale };
  const calls = [];
  const result = await updateEventCovers({ events: [event], outputDir, lookupImpl,
    maxAttempts: 1, logger: quietLogger, fetchImpl: async url => {
      calls.push(url);
      if (url === stale) return new Response('gone', { status: 404 });
      if (url === SOURCE) return imageResponse();
      assert.match(url, /getContent/);
      return newsResponse();
    } });
  assert.equal(calls.length, 3);
  assert.equal(result.summary.archived, 1);
  assert.equal(result.events[0].coverSourceUrl, SOURCE);
});

test('official news covers use the news ID namespace and never historical post IDs', async t => {
  const outputDir = await temporaryDirectory(t);
  const event = { id: 'sr-80', gameKey: 'sr', sourceNewsId: '456', sourcePostId: '123',
    url: 'https://act.mihoyo.com/activity', title: '保留' };
  const calls = [];
  const result = await updateEventCovers({ events: [event], outputDir, lookupImpl,
    maxAttempts: 1, logger: quietLogger, fetchImpl: async url => {
      calls.push(url);
      if (url === SOURCE) return imageResponse();
      const parsed = new URL(url);
      assert.match(parsed.pathname, /getContent$/);
      assert.equal(parsed.searchParams.get('iInfoId'), '456');
      assert.ok(!parsed.hostname.includes('miyoushe'));
      return newsResponse();
    } });
  assert.equal(calls.length, 2);
  assert.equal(result.summary.archived, 1);
  assert.equal(result.summary.newsRequests, 1);
  assert.deepEqual(result.events[0], { ...event, coverUrl: '/images/covers/sr-80.png', coverSourceUrl: SOURCE });
});

test('official news cache distinguishes games and reuses duplicate IDs', async t => {
  const outputDir = await temporaryDirectory(t);
  const events = [
    { id: 'ys-81', gameKey: 'ys', sourceNewsId: '456' },
    { id: 'ys-82', gameKey: 'ys', sourceNewsId: '456' },
    { id: 'sr-81', gameKey: 'sr', sourceNewsId: '456' }
  ];
  const apiCalls = [];
  const result = await updateEventCovers({ events, outputDir, lookupImpl, logger: quietLogger,
    fetchImpl: async url => {
      if (url === SOURCE) return imageResponse();
      apiCalls.push(new URL(url));
      return newsResponse();
    } });
  assert.equal(result.summary.archived, 3);
  assert.equal(result.summary.newsRequests, 2);
  assert.notEqual(apiCalls[0].pathname, apiCalls[1].pathname);
});

test('missing or failed news sources preserve covers without requesting posts or activity pages', async () => {
  const event = { id: 'ys-83', gameKey: 'ys', sourcePostId: '123', url: 'https://act.mihoyo.com/activity' };
  let calls = 0;
  const missing = await updateEventCovers({ events: [event], lookupImpl, logger: quietLogger,
    fetchImpl: async () => { calls++; throw new Error('No official news ID'); } });
  assert.equal(calls, 0);
  assert.equal(missing.summary.missing, 1);
  const withNews = { ...event, sourceNewsId: '456' };
  const failed = await updateEventCovers({ events: [withNews], lookupImpl, maxAttempts: 1, logger: quietLogger,
    fetchImpl: async url => { calls++; assert.match(url, /getContent/); return new Response('Unavailable', { status: 503 }); } });
  assert.equal(calls, 1);
  assert.equal(failed.summary.failed, 1);
  assert.equal(failed.summary.newsFailures, 1);
  assert.equal(failed.summary.allRequestsFailed, true);
  assert.deepEqual(failed.events, [withNews]);
});

test('working known image sources avoid APIs and total failures preserve the event', async t => {
  const outputDir = await temporaryDirectory(t);
  const event = { id: 'sr-84', gameKey: 'sr', sourceNewsId: '456', sourcePostId: '123', coverSourceUrl: SOURCE };
  const result = await updateEventCovers({ events: [event], outputDir, lookupImpl, maxAttempts: 1,
    logger: quietLogger, fetchImpl: async url => { assert.equal(url, SOURCE); return imageResponse(); } });
  assert.equal(result.summary.archived, 1);
  assert.equal(result.summary.newsRequests, 0);
  const failed = await updateEventCovers({ events: [{ ...event, id: 'sr-85' }], outputDir, lookupImpl,
    maxAttempts: 1, logger: quietLogger, fetchImpl: async url => {
      assert.ok(url === SOURCE || new URL(url).pathname.endsWith('/getContent'));
      return new Response('Missing', { status: 404 });
    } });
  assert.equal(failed.summary.failed, 1);
  assert.equal(failed.summary.newsRequests, 1);
  assert.deepEqual(failed.events, [{ ...event, id: 'sr-85' }]);
});

test('force refresh prefers official news and can retain a known image when its API fails', async t => {
  const outputDir = await temporaryDirectory(t);
  const oldSource = `${SOURCE}?old`;
  const event = { id: 'sr-86', gameKey: 'sr', sourceNewsId: '456',
    coverUrl: '/images/covers/sr-86.png', coverSourceUrl: oldSource };
  await fs.writeFile(path.join(outputDir, 'sr-86.png'), PNG);
  const refreshed = await updateEventCovers({ events: [event], force: true, outputDir, lookupImpl,
    logger: quietLogger, maxAttempts: 1, fetchImpl: async url => {
      if (url === SOURCE) return imageResponse();
      assert.match(url, /getContent/); return newsResponse();
    } });
  assert.equal(refreshed.events[0].coverSourceUrl, SOURCE);
  const fallback = await updateEventCovers({ events: [event], force: true, outputDir, lookupImpl,
    logger: quietLogger, maxAttempts: 1, fetchImpl: async url => {
      if (url === oldSource) return imageResponse();
      assert.match(url, /getContent/); return new Response('Unavailable', { status: 503 });
    } });
  assert.equal(fallback.summary.archived, 1);
  assert.equal(fallback.summary.newsFailures, 1);
  assert.equal(fallback.summary.allRequestsFailed, false);
  assert.equal(fallback.events[0].coverSourceUrl, oldSource);
});

test('corrupt covers repair from official news and disk writes preserve unrelated fields', async t => {
  const outputDir = await temporaryDirectory(t);
  const eventsPath = path.join(outputDir, 'events.json');
  const event = { id: 'sr-87', title: '标题', gameKey: 'sr', sourceNewsId: '456',
    coverUrl: '/images/covers/sr-87.png', custom: { x: 1 } };
  await fs.writeFile(eventsPath, JSON.stringify([event]));
  await fs.writeFile(path.join(outputDir, 'sr-87.png'), 'broken');
  const result = await updateEventCovers({ eventsPath, outputDir, lookupImpl, logger: quietLogger,
    fetchImpl: async url => url === SOURCE ? imageResponse() : newsResponse() });
  assert.equal(result.summary.archived, 1);
  const saved = JSON.parse(await fs.readFile(eventsPath, 'utf8'));
  assert.deepEqual(Object.keys(saved[0]), [...Object.keys(event), 'coverSourceUrl']);
  assert.deepEqual(saved[0].custom, event.custom);
  assert.deepEqual(await fs.readFile(path.join(outputDir, 'sr-87.png')), PNG);
});

test('dry run and ID limits discover official images without writing assets or fields', async t => {
  const outputDir = await temporaryDirectory(t);
  const events = ['sr-88', 'sr-89', 'sr-90'].map(id => ({ id, gameKey: 'sr', sourceNewsId: '456' }));
  let calls = 0;
  const result = await updateEventCovers({ events, ids: ['sr-89', 'sr-90'], limit: 1, dryRun: true,
    outputDir, lookupImpl, logger: quietLogger, fetchImpl: async url => {
      calls++; assert.match(url, /getContent/); return newsResponse();
    } });
  assert.equal(calls, 1);
  assert.equal(result.summary.proposed, 1);
  assert.deepEqual(result.events, events);
  assert.deepEqual(await fs.readdir(outputDir), []);
});

test('complete PNGs with official trailing watermarks remain valid', () => {
  assert.equal(detectImageExtension(Buffer.concat([PNG, Buffer.from('mi_yiwen.yang')])), 'png');
  assert.equal(detectImageExtension(PNG.subarray(0, PNG.length - 3)), null);
  const broken = Buffer.from(PNG);
  broken.writeUInt32BE(0xffffffff, 8);
  assert.equal(detectImageExtension(broken), null);
});

test('agreement pages cannot acquire unrelated announcement artwork during backfills', async () => {
  const event = { id: 'ys-34', title: '千星奇域创作者中心服务协议',
    url: 'https://act.mihoyo.com/miliastra_wonderland/agreement?id=156266',
    gameKey: 'ys', sourceNewsId: '456', sourcePostId: '123', coverSourceUrl: SOURCE };
  const result = await updateEventCovers({ events: [event], force: true,
    logger: quietLogger, fetchImpl: async () => { throw new Error('A linked agreement must not fetch activity covers'); } });
  assert.deepEqual(result.events, [event]);
  assert.equal(result.summary.skipped, 1);
  assert.equal(result.summary.requests, 0);
});
async function temporaryDirectory(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'hoyo-covers-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}

test('announcement covers follow post cover, top-level cover, image, structured-content priority', () => {
  const a = `${SOURCE}?a`, b = `${SOURCE}?b`, c = `${SOURCE}?c`;
  assert.equal(extractPostCoverUrl({ post: { cover: a, images: [c] }, cover: { url: b } }), a);
  assert.equal(extractPostCoverUrl({ post: { cover: 'javascript:bad', images: [{ image_url: c }] }, cover: { url: b } }), b);
  assert.equal(extractPostCoverUrl({ post: { images: [{ image_url: c }] } }), c);
  assert.equal(extractPostCoverUrl({ post: { structured_content: JSON.stringify([
    { insert: { image: 'https://example.com/other.png' } }, { insert: { image: { url: a } } }
  ]) } }), a);
  assert.equal(extractPostCoverUrl({ post: { structured_content: '{broken' } }), null);
  assert.equal(extractPostCoverUrl({ post: { structured_content: { ops: 'malformed' } } }), null);
  assert.equal(extractPostCoverUrl({}), null);
});

test('share metadata accepts attribute order, relative paths, entities and prefers OpenGraph', () => {
  const html = `<meta content='https://example.com/twitter.png' name='twitter:image'>
    <meta content="../cover.png?a=1&amp;b=2" data-x='1' property="og:image">`;
  assert.equal(extractShareCoverUrl(html, 'https://act.mihoyo.com/event/index.html'),
    'https://act.mihoyo.com/cover.png?a=1&b=2');
  assert.equal(extractShareCoverUrl('<meta name="twitter:image" content="//fastcdn.mihoyo.com/share.webp">',
    'https://act.mihoyo.com/'), 'https://fastcdn.mihoyo.com/share.webp');
  assert.equal(extractShareCoverUrl('<meta property="og:image" content="http://localhost/x">', SOURCE), null);
  assert.equal(extractShareCoverUrl('<meta property="og:image" content="https://sr.mihoyo.com/favicon-mi.ico">', SOURCE), null);
  assert.equal(extractShareCoverUrl('<meta property="og:image" content="/favicon.png"><meta name="twitter:image" content="/activity.png">', SOURCE),
    'https://upload-bbs.miyoushe.com/activity.png');
});

test('unsafe protocols, credentials and local addresses are rejected', () => {
  for (const url of ['file:///image.png', 'data:image/png;base64,x', 'ftp://mihoyo.com/x',
    'https://user:secret@mihoyo.com/x', 'http://localhost/x', 'http://127.1/x',
    'http://10.0.0.1/x', 'http://172.16.0.1/x', 'http://192.168.1.2/x',
    'http://169.254.169.254/x', 'http://[::1]/x', 'http://[::ffff:127.0.0.1]/x']) {
    assert.equal(normalizeCoverSourceUrl(url), null, url);
  }
  assert.equal(normalizeCoverSourceUrl('https://example.com/cooperation.png'), 'https://example.com/cooperation.png');
});

test('DNS private addresses and redirect-to-private destinations never reach fetch', async () => {
  let calls = 0;
  await assert.rejects(readPublicResource(SOURCE, {
    lookupImpl: async () => [{ address: '10.0.0.2' }], fetchImpl: async () => { calls++; }
  }), /private network/);
  assert.equal(calls, 0);
  await assert.rejects(readPublicResource(SOURCE, {
    lookupImpl, fetchImpl: async () => { calls++; return new Response(null, { status: 302, headers: { location: 'http://localhost/secret' } }); }
  }), /Unsafe redirect/);
  assert.equal(calls, 1);
});

test('archive writes a validated image with a local URL and preserves every other field', async t => {
  const outputDir = await temporaryDirectory(t);
  const event = { id: 'sr-123', title: '活动', screenshot: '/screenshots/sr-123.png', tags: ['test'] };
  const archived = await archiveEventCover(event, SOURCE, { outputDir, lookupImpl, fetchImpl: async () => imageResponse() });
  assert.deepEqual(archived, { ...event, coverUrl: '/images/covers/sr-123.png', coverSourceUrl: SOURCE });
  assert.deepEqual(await fs.readFile(path.join(outputDir, 'sr-123.png')), PNG);
  assert.equal(await hasValidLocalCover(archived, { outputDir }), true);
  assert.equal(event.coverUrl, undefined);
  let calls = 0;
  await archiveEventCover(archived, SOURCE, { outputDir, lookupImpl, fetchImpl: async () => { calls++; } });
  assert.equal(calls, 0);
});

test('HTML, mismatched type, truncation, oversize and timed-out downloads preserve an older image', async t => {
  const outputDir = await temporaryDirectory(t);
  const target = path.join(outputDir, 'ys-1.png');
  await fs.writeFile(target, PNG);
  const event = { id: 'ys-1', coverUrl: '/images/covers/ys-1.png', coverSourceUrl: `${SOURCE}?old` };
  for (const options of [
    { fetchImpl: async () => new Response('<html>Error</html>', { headers: { 'content-type': 'text/html' } }) },
    { fetchImpl: async () => new Response(PNG, { headers: { 'content-type': 'image/jpeg' } }) },
    { fetchImpl: async () => new Response(PNG.subarray(0, 30), { headers: { 'content-type': 'image/png' } }) },
    { fetchImpl: async () => imageResponse(), maxBytes: 10 },
    { fetchImpl: async () => new Promise(() => {}), timeoutMs: 15 }
  ]) {
    await assert.rejects(archiveEventCover(event, SOURCE, { outputDir, lookupImpl, ...options }));
    assert.deepEqual(await fs.readFile(target), PNG);
  }
  assert.deepEqual(await fs.readdir(outputDir), ['ys-1.png']);
});

test('invalid ids cannot escape cover output directory', async t => {
  const outputDir = await temporaryDirectory(t);
  await assert.rejects(archiveEventCover({ id: '../outside' }, SOURCE, { outputDir, lookupImpl }), /Invalid event id/);
});

test('only supported PNG/JPEG/WebP signatures pass image detection', () => {
  assert.equal(detectImageExtension(PNG), 'png');
  assert.equal(detectImageExtension(Buffer.from('<html>some error page</html>')), null);
  assert.equal(detectImageExtension(PNG.subarray(0, 30)), null);
  const jpeg = Buffer.alloc(24); jpeg.set([255, 216, 255]); jpeg.set([255, 217], 22);
  assert.equal(detectImageExtension(jpeg), 'jpg');
  const webp = Buffer.alloc(24); webp.write('RIFF'); webp.writeUInt32LE(16, 4); webp.write('WEBPVP8 ', 8);
  assert.equal(detectImageExtension(webp), 'webp');
  webp.writeUInt32LE(100, 4);
  assert.equal(detectImageExtension(webp), null);
});

test('valid existing local covers skip all source requests', async t => {
  const outputDir = await temporaryDirectory(t);
  await fs.writeFile(path.join(outputDir, 'zzz-1.png'), PNG);
  const event = { id: 'zzz-1', gameKey: 'zzz', sourceNewsId: '456', coverUrl: '/images/covers/zzz-1.png' };
  const result = await updateEventCovers({ events: [event], outputDir, logger: quietLogger,
    fetchImpl: () => { throw new Error('should never fetch'); } });
  assert.equal(result.summary.skipped, 1);
  assert.deepEqual(result.events, [event]);
});

test('oversized official uploads use one bounded OSS thumbnail and retain the original source URL', async t => {
  const outputDir = await temporaryDirectory(t);
  const jpeg = Buffer.alloc(24); jpeg.set([255, 216, 255]); jpeg.set([255, 217], 22);
  const calls = [];
  const source = `${SOURCE}?existing=value`;
  const event = { id: 'ys-70', screenshot: '/screenshots/ys-70.png' };
  const result = await archiveEventCover(event, source, { outputDir, lookupImpl, maxBytes: 50,
    fetchImpl: async url => {
      calls.push(url);
      if (url === source) return new Response(PNG, { headers: { 'content-type': 'image/png', 'content-length': '1000' } });
      const resized = new URL(url);
      assert.equal(resized.searchParams.get('existing'), 'value');
      assert.equal(resized.searchParams.get('x-oss-process'), 'image/resize,w_1600/quality,q_85/format,jpg');
      return new Response(jpeg, { headers: { 'content-type': 'image/jpeg' } });
    } });
  assert.equal(calls.length, 2);
  assert.equal(calls.filter(url => url === source).length, 1);
  assert.equal(result.coverSourceUrl, source);
  assert.equal(result.coverUrl, '/images/covers/ys-70.jpg');
  assert.equal(result.screenshot, event.screenshot);
  assert.deepEqual(await fs.readFile(path.join(outputDir, 'ys-70.jpg')), jpeg);
});

test('other hosts cannot trigger OSS transformation when exceeding the size limit', async t => {
  const outputDir = await temporaryDirectory(t);
  for (const source of ['https://example.com/cover.png', 'https://fastcdn.mihoyo.com/cover.png',
    'https://upload-bbs.miyoushe.com.example.com/cover.png']) {
    const calls = [];
    await assert.rejects(archiveEventCover({ id: 'ys-71' }, source, { outputDir, lookupImpl, maxBytes: 20,
      fetchImpl: async url => { calls.push(url); return imageResponse(); } }), /size limit/);
    assert.deepEqual(calls, [source]);
  }
  assert.deepEqual(await fs.readdir(outputDir), []);
});

test('failed or oversized official thumbnails preserve the old file and never re-read the original', async t => {
  const outputDir = await temporaryDirectory(t);
  const target = path.join(outputDir, 'ys-72.png');
  await fs.writeFile(target, PNG);
  const event = { id: 'ys-72', coverUrl: '/images/covers/ys-72.png', coverSourceUrl: `${SOURCE}?old` };
  for (const thumbnailResponse of [
    () => new Response('Not found', { status: 404 }),
    () => imageResponse(),
    () => new Response('<html>Error</html>', { headers: { 'content-type': 'text/html' } })
  ]) {
    const calls = [];
    await assert.rejects(archiveEventCover(event, SOURCE, { outputDir, lookupImpl, maxBytes: 50,
      fetchImpl: async url => {
        calls.push(url);
        return url === SOURCE ? imageResponse() : thumbnailResponse();
      } }));
    assert.equal(calls.length, 2);
    assert.equal(calls.filter(url => url === SOURCE).length, 1);
    assert.deepEqual(await fs.readFile(target), PNG);
  }
  assert.deepEqual(await fs.readdir(outputDir), ['ys-72.png']);
});
