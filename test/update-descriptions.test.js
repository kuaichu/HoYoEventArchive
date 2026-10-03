import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { updateEventDescriptions } from '../scripts/update-descriptions.js';

const greeting = '旅行者好呀，我们又见面啦~';
const body = `<p>${greeting}</p><p>完成小游戏挑战，收集三枚纪念徽章，即可获得原石*20奖励。</p>`;
const event = { id: 'ys-1', gameKey: 'ys', title: '测试小游戏', description: greeting,
  sourcePostId: '123', sourceNewsId: '456', url: 'https://act.mihoyo.com/ys/event/test/',
  reward: '保留原奖励', endDate: '2026.10.18', coverUrl: '/images/covers/ys-1.jpg' };
const json = (id = '456', content = body) => new Response(JSON.stringify({ retcode: 0, data: { list: [{
  iInfoId: Number(id), sTitle: '测试小游戏', sContent: content, dtStartTime: '2026-09-28 08:00:00'
}] } }), { headers: { 'Content-Type': 'application/json' } });
const network = { lookupImpl: async () => [{ address: '8.8.8.8' }], maxAttempts: 1, logger: {} };

test('official ContentAPI repairs legacy intros without querying historical post IDs', async () => {
  const calls = [];
  const original = [structuredClone(event)];
  const { events, summary } = await updateEventDescriptions({ ...network, events: original,
    fetchImpl: async url => { calls.push(new URL(url)); return json(); } });
  assert.equal(calls.length, 1);
  assert.match(calls[0].pathname, /getContent$/);
  assert.equal(calls[0].searchParams.get('iInfoId'), '456');
  assert.ok(!calls[0].hostname.includes('miyoushe'));
  assert.equal(summary.updated, 1);
  assert.equal(summary.newsRequests, 1);
  assert.match(events[0].description, /收集三枚纪念徽章/);
  assert.equal(events[0].descriptionSource, 'announcement');
  assert.deepEqual(Object.fromEntries(Object.entries(events[0]).filter(([key]) => !['description', 'descriptionSource'].includes(key))),
    Object.fromEntries(Object.entries(event).filter(([key]) => key !== 'description')));
  assert.equal(original[0].description, greeting);
});

test('manual, curated and resource descriptions avoid all source requests even with news IDs', async () => {
  const manual = { ...event, descriptionSource: 'manual' };
  const curated = { ...event, id: 'ys-2', description: '参与活动完成签到任务，即可领取原石与纪念徽章奖励。' };
  const resource = { ...event, id: 'ys-3', title: '创作者中心服务协议', url: 'https://act.mihoyo.com/agreement?id=1' };
  const { events, summary } = await updateEventDescriptions({ ...network, events: [manual, curated, resource],
    fetchImpl: async () => { throw new Error('Protected descriptions must not trigger a request'); } });
  assert.deepEqual(events, [manual, curated, resource]);
  assert.equal(summary.manualSkipped, 1);
  assert.equal(summary.requests, 0);
});

test('missing news IDs never request historical MiYouShe posts or activity pages', async () => {
  const original = { ...event, sourceNewsId: undefined, description: '米游社官方网页活动。' };
  let calls = 0;
  const result = await updateEventDescriptions({ ...network, events: [original], refresh: true,
    fetchImpl: async () => { calls++; throw new Error('No compatible source'); } });
  assert.equal(calls, 0);
  assert.equal(result.summary.missing, 1);
  assert.deepEqual(result.events, [original]);
});

test('failed or mismatched official news preserves text without page or post fallback', async () => {
  for (const response of [() => new Response('unavailable', { status: 503 }), () => json('999')]) {
    const calls = [];
    const result = await updateEventDescriptions({ ...network, events: [event],
      fetchImpl: async url => { calls.push(url); return response(); } });
    assert.deepEqual(result.events, [event]);
    assert.equal(result.summary.failed, 1);
    assert.equal(calls.length, 1);
    assert.match(calls[0], /getContent/);
  }
});

test('news details cache by game and ID including failures without disabling other news', async () => {
  const originals = [
    { ...event, description: '' }, { ...event, id: 'ys-2', description: '' },
    { ...event, id: 'sr-1', gameKey: 'sr', description: '' }
  ];
  const calls = [];
  const result = await updateEventDescriptions({ ...network, events: originals,
    fetchImpl: async url => {
      calls.push(new URL(url));
      return calls.length === 1 ? new Response(JSON.stringify({ retcode: 1034 })) : json();
    } });
  assert.equal(calls.length, 2);
  assert.notEqual(calls[0].pathname, calls[1].pathname);
  assert.equal(result.summary.newsRequests, 2);
  assert.equal(result.summary.failed, 2);
  assert.equal(result.summary.updated, 1);
  assert.match(result.events[2].description, /收集三枚纪念徽章/);
});

test('dry run proposes a migration without writing the events file', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'hoyo-description-test-'));
  const eventsPath = path.join(directory, 'events.json');
  const original = `${JSON.stringify([event], null, 2)}\n`;
  try {
    await fs.writeFile(eventsPath, original);
    const result = await updateEventDescriptions({ ...network, eventsPath, dryRun: true,
      fetchImpl: async () => json() });
    assert.equal(result.summary.updated, 1);
    assert.equal(await fs.readFile(eventsPath, 'utf8'), original);
  } finally {
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(directory).startsWith('hoyo-description-test-'));
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('existing automatic summaries skip requests unless explicitly refreshed', async () => {
  const automatic = { ...event, description: '完成签到即可领取纪念奖励。', descriptionSource: 'announcement' };
  const skipped = await updateEventDescriptions({ ...network, events: [automatic],
    fetchImpl: async () => { throw new Error('A completed description should be reused'); } });
  assert.equal(skipped.summary.requests, 0);
  const refreshed = await updateEventDescriptions({ ...network, events: [automatic], ids: ['ys-1'],
    fetchImpl: async () => json() });
  assert.equal(refreshed.summary.newsRequests, 1);
  assert.equal(refreshed.summary.updated, 1);
});
