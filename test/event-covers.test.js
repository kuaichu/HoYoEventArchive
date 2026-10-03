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
    sourcePostId: '123', coverSourceUrl: SOURCE };
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

test('official API failures fall back to activity-page share metadata', async t => {
  const outputDir = await temporaryDirectory(t);
  const calls = [];
  const event = { id: 'ys-2', gameKey: 'ys', sourcePostId: '123', url: 'https://act.mihoyo.com/activity', title: '保留' };
  const result = await updateEventCovers({ events: [event], outputDir, lookupImpl, maxAttempts: 1, logger: quietLogger,
    fetchImpl: async url => {
      calls.push(url);
      if (url.includes('getNewsList')) return new Response(JSON.stringify({ retcode: 0, data: { list: [] } }));
      if (url.includes('getPostFull')) return new Response('unavailable', { status: 503 });
      if (url === event.url) return new Response(`<meta property="og:image" content="${SOURCE}">`, { headers: { 'content-type': 'text/html; charset=utf-8' } });
      return imageResponse();
    }
  });
  assert.equal(calls.length, 4);
  assert.equal(result.summary.archived, 1);
  assert.equal(result.summary.allRequestsFailed, false);
  assert.deepEqual(result.events[0], { ...event, coverUrl: '/images/covers/ys-2.png', coverSourceUrl: SOURCE });
});

test('valid existing local covers skip all source requests', async t => {
  const outputDir = await temporaryDirectory(t);
  await fs.writeFile(path.join(outputDir, 'zzz-1.png'), PNG);
  const event = { id: 'zzz-1', coverUrl: '/images/covers/zzz-1.png' };
  const result = await updateEventCovers({ events: [event], outputDir, logger: quietLogger,
    fetchImpl: () => { throw new Error('should never fetch'); } });
  assert.equal(result.summary.skipped, 1);
  assert.deepEqual(result.events, [event]);
});

test('corrupt existing files are repaired, API covers outrank page metadata, and disk writes preserve field order', async t => {
  const outputDir = await temporaryDirectory(t);
  const eventsPath = path.join(outputDir, 'events.json');
  const event = { id: 'sr-3', title: '标题', sourcePostId: '456', gameKey: 'sr', coverUrl: '/images/covers/sr-3.png', custom: { x: 1 } };
  await fs.writeFile(eventsPath, JSON.stringify([event]));
  await fs.writeFile(path.join(outputDir, 'sr-3.png'), 'broken');
  const result = await updateEventCovers({ eventsPath, outputDir, lookupImpl, logger: quietLogger, maxAttempts: 1,
    fetchImpl: async url => url.includes('getPostFull')
      ? new Response(JSON.stringify({ retcode: 0, data: { post: { post: { cover: SOURCE } } } })) : imageResponse()
  });
  assert.equal(result.summary.archived, 1);
  const saved = JSON.parse(await fs.readFile(eventsPath, 'utf8'));
  assert.deepEqual(Object.keys(saved[0]), [...Object.keys(event), 'coverSourceUrl']);
  assert.deepEqual(saved[0].custom, event.custom);
  assert.deepEqual(await fs.readFile(path.join(outputDir, 'sr-3.png')), PNG);
});

test('dry run and id/limit filters discover covers without writing any assets or fields', async t => {
  const outputDir = await temporaryDirectory(t);
  const events = ['ys-1', 'ys-2', 'ys-3'].map(id => ({ id, sourcePostId: '123' }));
  let calls = 0;
  const result = await updateEventCovers({ events, ids: ['ys-2', 'ys-3'], limit: 1, dryRun: true,
    outputDir, lookupImpl, logger: quietLogger, fetchImpl: async () => {
      calls++; return new Response(JSON.stringify({ retcode: 0, data: { post: { post: { cover: SOURCE } } } }));
    } });
  assert.equal(calls, 1);
  assert.equal(result.summary.proposed, 1);
  assert.deepEqual(result.events, events);
  assert.deepEqual(await fs.readdir(outputDir), []);
});

test('offline results distinguish all failed requests from successful pages without any cover', async () => {
  const event = { id: 'ys-4', url: 'https://act.mihoyo.com/empty', sourcePostId: '123', coverSourceUrl: SOURCE };
  const offline = await updateEventCovers({ events: [event], lookupImpl, maxAttempts: 1, logger: quietLogger,
    fetchImpl: async () => { throw new Error('offline'); } });
  assert.equal(offline.summary.allRequestsFailed, true);
  assert.deepEqual(offline.events, [event]);
  const missing = await updateEventCovers({ events: [{ id: 'ys-5', url: event.url }], lookupImpl,
    logger: quietLogger, fetchImpl: async () => new Response('<html>No share metadata</html>', { headers: { 'content-type': 'text/html' } }) });
  assert.equal(missing.summary.missing, 1);
  assert.equal(missing.summary.allRequestsFailed, false);
});

test('cached news-list pages cover multiple events and stop once all target posts are found', async t => {
  const outputDir = await temporaryDirectory(t);
  const events = [
    { id: 'ys-20', gameKey: 'ys', sourcePostId: '200' },
    { id: 'ys-21', gameKey: 'ys', sourcePostId: '100' },
    { id: 'ys-22', gameKey: 'ys', sourcePostId: '100' }
  ];
  const apiCalls = [];
  const result = await updateEventCovers({ events, outputDir, lookupImpl, logger: quietLogger,
    maxAttempts: 1, fetchImpl: async url => {
      if (url.includes('getPostFull')) throw new Error('No detail fetch expected');
      if (!url.includes('getNewsList')) return imageResponse();
      const parsed = new URL(url);
      apiCalls.push(parsed);
      const first = !parsed.searchParams.get('last_id');
      return new Response(JSON.stringify({ retcode: 0, data: {
        list: [{ post: { post_id: first ? '200' : '100', cover: SOURCE } }],
        last_id: first ? '199' : '99'
      } }));
    } });
  assert.equal(result.summary.archived, 3);
  assert.equal(result.summary.bulkPages, 2);
  assert.equal(result.summary.detailRequests, 0);
  assert.equal(apiCalls[0].hostname, 'bbs-api-static.miyoushe.com');
  assert.equal(apiCalls[0].searchParams.get('page_size'), '100');
  assert.equal(apiCalls[0].searchParams.get('gids'), '2');
  assert.equal(apiCalls[1].searchParams.get('last_id'), '199');
});

test('known cover sources avoid both list and detail calls, including when that image fails', async t => {
  const outputDir = await temporaryDirectory(t);
  const events = [{ id: 'sr-20', gameKey: 'sr', sourcePostId: '555', coverSourceUrl: SOURCE }];
  const calls = [];
  const result = await updateEventCovers({ events, outputDir, lookupImpl, logger: quietLogger, maxAttempts: 1,
    fetchImpl: async url => { calls.push(url); return imageResponse(); } });
  assert.deepEqual(calls, [SOURCE]);
  assert.equal(result.summary.archived, 1);
  const failed = await updateEventCovers({ events: [{ ...events[0], id: 'sr-21' }], outputDir, lookupImpl,
    logger: quietLogger, maxAttempts: 1, fetchImpl: async url => {
      assert.equal(url, SOURCE); return new Response('Missing', { status: 404 });
    } });
  assert.equal(failed.summary.failed, 1);
  assert.equal(failed.summary.bulkPages, 0);
  assert.equal(failed.summary.detailRequests, 0);
});

test('detail fallback is serial, paced and cached for duplicate post ids', async t => {
  const outputDir = await temporaryDirectory(t);
  const events = [
    { id: 'ys-30', gameKey: 'ys', sourcePostId: '100' },
    { id: 'ys-31', gameKey: 'ys', sourcePostId: '100' },
    { id: 'ys-32', gameKey: 'ys', sourcePostId: '101' }
  ];
  let active = 0;
  let maxActive = 0;
  const startedAt = [];
  const result = await updateEventCovers({ events, outputDir, lookupImpl, logger: quietLogger, detailDelayMs: 15,
    fetchImpl: async url => {
      if (url.includes('getNewsList')) return new Response(JSON.stringify({ retcode: 0, data: { list: [] } }));
      if (!url.includes('getPostFull')) return imageResponse();
      startedAt.push(Date.now());
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise(resolve => setTimeout(resolve, 5));
      active--;
      return new Response(JSON.stringify({ retcode: 0, data: { post: { post: { cover: SOURCE } } } }));
    } });
  assert.equal(result.summary.archived, 3);
  assert.equal(result.summary.detailRequests, 2);
  assert.equal(maxActive, 1);
  assert.ok(startedAt[1] - startedAt[0] >= 15);
});

test('retcode 1034 stops queued detail calls while every event still uses share images', async t => {
  const outputDir = await temporaryDirectory(t);
  const events = ['1', '2', '3'].map(id => ({ id: `ys-4${id}`, gameKey: 'ys', sourcePostId: id,
    url: `https://act.mihoyo.com/share-${id}`, screenshot: `/screenshots/ys-4${id}.png` }));
  let detailCalls = 0;
  const result = await updateEventCovers({ events, outputDir, lookupImpl, logger: quietLogger,
    detailDelayMs: 0, fetchImpl: async url => {
      if (url.includes('getNewsList')) return new Response(JSON.stringify({ retcode: 0, data: { list: [] } }));
      if (url.includes('getPostFull')) {
        detailCalls++;
        return new Response(JSON.stringify({ retcode: 1034, message: 'verification required' }));
      }
      if (url.includes('share-')) return new Response(`<meta property="og:image" content="${SOURCE}">`,
        { headers: { 'content-type': 'text/html' } });
      return imageResponse();
    } });
  assert.equal(detailCalls, 1);
  assert.equal(result.summary.detailBlocked, true);
  assert.equal(result.summary.requestFailures, 1);
  assert.equal(result.summary.archived, 3);
  assert.deepEqual(result.events.map(event => event.screenshot), events.map(event => event.screenshot));
});

test('bulk search is bounded to five pages before detail fallback', async () => {
  let page = 0;
  const result = await updateEventCovers({ events: [{ id: 'zzz-50', gameKey: 'zzz', sourcePostId: '999' }],
    dryRun: true, lookupImpl, logger: quietLogger, fetchImpl: async url => {
      if (url.includes('getNewsList')) {
        page++;
        return new Response(JSON.stringify({ retcode: 0, data: { list: [{ post: { post_id: String(page) } }], last_id: String(page) } }));
      }
      return new Response(JSON.stringify({ retcode: 0, data: { post: { post: { cover: SOURCE } } } }));
    } });
  assert.equal(page, 5);
  assert.equal(result.summary.detailRequests, 1);
  assert.equal(result.summary.proposed, 1);
});

test('force refresh prefers the cached announcement cover over an existing source', async t => {
  const outputDir = await temporaryDirectory(t);
  await fs.writeFile(path.join(outputDir, 'sr-60.png'), PNG);
  const event = { id: 'sr-60', gameKey: 'sr', sourcePostId: '600', coverUrl: '/images/covers/sr-60.png',
    coverSourceUrl: `${SOURCE}?old` };
  const result = await updateEventCovers({ events: [event], force: true, outputDir, lookupImpl, logger: quietLogger,
    fetchImpl: async url => {
      if (url.includes('getNewsList')) return new Response(JSON.stringify({ retcode: 0, data: { list: [{ post: { post_id: '600', cover: SOURCE } }] } }));
      assert.equal(url, SOURCE);
      return imageResponse();
    } });
  assert.equal(result.summary.archived, 1);
  assert.equal(result.summary.detailRequests, 0);
  assert.equal(result.events[0].coverSourceUrl, SOURCE);
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
