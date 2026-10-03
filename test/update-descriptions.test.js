import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { updateEventDescriptions } from '../scripts/update-descriptions.js';

const greeting = '旅行者好呀，我们又见面啦~';
const post = { post_id: '123', subject: '测试小游戏', structured_content: JSON.stringify([
  { insert: `${greeting}\n` },
  { insert: '完成小游戏挑战，收集三枚纪念徽章，即可获得原石*20奖励。\n' }
]) };
const event = { id: 'ys-1', gameKey: 'ys', title: '测试小游戏', description: greeting,
  sourcePostId: '123', url: 'https://act.mihoyo.com/ys/event/test/', reward: '保留原奖励',
  endDate: '2026.10.18', coverUrl: '/images/covers/ys-1.jpg' };
const json = data => new Response(JSON.stringify({ retcode: 0, data }), { headers: { 'Content-Type': 'application/json' } });
const network = { lookupImpl: async () => [{ address: '8.8.8.8' }], detailDelayMs: 0, logger: {} };

test('official posts repair legacy intros without altering other event fields', async () => {
  const calls = [];
  const original = [structuredClone(event)];
  const { events, summary } = await updateEventDescriptions({ ...network, events: original,
    fetchImpl: async url => { calls.push(url); return json({ post: { post } }); } });
  assert.equal(calls.length, 1);
  assert.ok(calls[0].includes('getPostFull'));
  assert.equal(summary.updated, 1);
  assert.equal(summary.detailRequests, 1);
  assert.match(events[0].description, /收集三枚纪念徽章/);
  assert.equal(events[0].descriptionSource, 'announcement');
  assert.deepEqual(Object.fromEntries(Object.entries(events[0]).filter(([key]) => !['description', 'descriptionSource'].includes(key))),
    Object.fromEntries(Object.entries(event).filter(([key]) => key !== 'description')));
  assert.equal(original[0].description, greeting);
});

test('manual and unmarked custom descriptions are preserved', async () => {
  const manual = { ...event, descriptionSource: 'manual' };
  const curated = { ...event, id: 'ys-2', description: '人工整理的活动玩法说明，介绍完整流程和参与条件。' };
  const { events, summary } = await updateEventDescriptions({ ...network, events: [manual, curated],
    fetchImpl: async () => { throw new Error('Useful text must not trigger an unnecessary request'); } });
  assert.deepEqual(events, [manual, curated]);
  assert.equal(summary.manualSkipped, 1);
  assert.equal(summary.updated, 0);
});

test('verification stops further details and page metadata fills only placeholders', async () => {
  let details = 0;
  const originals = [{ ...event, description: '米游社官方网页活动。' },
    { ...event, id: 'ys-2', sourcePostId: '456', description: '米游社官方网页活动。' }];
  const { events, summary } = await updateEventDescriptions({ ...network, events: originals, bulk: false,
    fetchImpl: async url => {
      if (url.includes('getPostFull')) { details++; return new Response(JSON.stringify({ retcode: 1034 })); }
      return new Response('<meta content="完成每日签到任务，可领取原石奖励。" property="og:description">', { headers: { 'Content-Type': 'text/html' } });
    } });
  assert.equal(details, 1);
  assert.equal(summary.detailBlocked, true);
  assert.equal(summary.updated, 2);
  assert.ok(events.every(item => item.descriptionSource === 'page'));
});

test('a mismatched official post cannot replace an event description', async () => {
  const { events, summary } = await updateEventDescriptions({ ...network, events: [event], bulk: false,
    fetchImpl: async () => json({ post: { post: { ...post, post_id: '456' } } }) });
  assert.deepEqual(events, [event]);
  assert.equal(summary.failed, 1);
});

test('dry run proposes a migration without writing the events file', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'hoyo-description-test-'));
  const eventsPath = path.join(directory, 'events.json');
  const original = `${JSON.stringify([event], null, 2)}\n`;
  try {
    await fs.writeFile(eventsPath, original);
    const result = await updateEventDescriptions({ ...network, eventsPath, dryRun: true,
      fetchImpl: async () => json({ post: { post } }) });
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
    fetchImpl: async () => json({ post: { post } }) });
  assert.equal(refreshed.summary.detailRequests, 1);
  assert.equal(refreshed.summary.updated, 1);
});

test('agreement records retain their original description without requesting an activity announcement', async () => {
  const resource = { ...event, title: '创作者中心服务协议', url: 'https://act.mihoyo.com/agreement?id=1' };
  const result = await updateEventDescriptions({ ...network, events: [resource], refresh: true,
    fetchImpl: async () => { throw new Error('A resource page must not receive an activity summary'); } });
  assert.deepEqual(result.events, [resource]);
  assert.equal(result.summary.requests, 0);
});
