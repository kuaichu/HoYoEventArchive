import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { applyEventTime, updateEventTimes } from '../scripts/update-times.js';

const event = { id: 'bh3-13', gameKey: 'bh3', game: '崩坏3', title: '【公告】忆旅的流彩叙映',
  sourcePostTitle: '【公告】忆旅的流彩叙映', type: '其他活动', status: '可访问', date: '2026.09.28',
  dateType: 'announcement', version: 'v9.1', tags: ['网页活动'], description: '回顾年度数据。',
  url: 'https://act.mihoyo.com/bh3/event/e20260928anniversary-khr27n/index.html' };
const now = '2026-10-04T12:00:00+08:00';
const quiet = { log() {} };
const missing = async () => ({ status: 'missing', method: 'activity-page', reason: 'No config' });
const news = async () => ({ status: 'ok', posts: [] });

test('official exact times replace incomplete dates and preserve unrelated event fields', async () => {
  const input = { ...event, startDate: '2026.09.27', endDate: '2026.11.26' };
  const result = await updateEventTimes({ events: [input], now, logger: quiet, fetchNews: news,
    fetchTime: async () => ({ status: 'ok', method: 'activity-static-config', timeSource: 'activity-config',
      timeSourceUrl: 'https://fastcdn.mihoyo.com/mi18n/config.json',
      startAt: '2026-09-28T10:00:00+08:00', endAt: '2026-11-26T04:00:00+08:00' }) });
  assert.equal(result.events[0].startDate, '2026.09.28');
  assert.equal(result.events[0].endAt, '2026-11-26T04:00:00+08:00');
  assert.equal(result.events[0].description, input.description);
  assert.equal(input.startDate, '2026.09.27');
  assert.equal(result.summary.updated, 1);
});

test('an exact matching official title supplies a fallback even when the article has no link', async () => {
  const result = await updateEventTimes({ events: [event], now, logger: quiet, fetchTime: missing,
    fetchNews: async () => ({ status: 'ok', posts: [{ sourceNewsId: '166494', links: [],
      sourceNewsUrl: 'https://bh3.mihoyo.com/news/693/166494',
      post: { subject: '忆旅的流彩叙映', created_at: Date.parse('2026-09-28T10:00:00+08:00') / 1000,
        content: '<p>活动时间</p><p>9月28日10:00~11月26日04:00</p>' } }] }) });
  assert.equal(result.events[0].endAt, '2026-11-26T04:00+08:00');
  assert.equal(result.events[0].timeSource, 'announcement');
  assert.equal(result.report.records[0].method, 'official-announcement');
});

test('an exact quoted activity name resolves an official announcement behind a short link', async () => {
  const result = await updateEventTimes({ events: [event], now, logger: quiet, fetchTime: missing,
    fetchNews: async () => ({ status: 'ok', posts: [{ sourceNewsId: '166494', links: ['https://mhyurl.cn/Example'],
      sourceNewsUrl: 'https://bh3.mihoyo.com/news/693/166494',
      post: { subject: '「忆旅的流彩叙映」活动说明', created_at: Date.parse('2026-09-28T10:00:00+08:00') / 1000,
        content: '<p>活动时间</p><p>9月28日10:00~11月26日04:00</p>' } }] }) });
  assert.equal(result.events[0].endAt, '2026-11-26T04:00+08:00');
  assert.equal(result.events[0].timeSource, 'announcement');
});

test('a partial official configuration can gain the start date from its matching announcement', async () => {
  const result = await updateEventTimes({ events: [event], now, logger: quiet,
    fetchTime: async () => ({ status: 'partial', method: 'activity-static-config',
      endAt: '2026-11-26T04:00+08:00', timeSource: 'activity-config',
      timeSourceUrl: 'https://fastcdn.mihoyo.com/config.json' }),
    fetchNews: async () => ({ status: 'ok', posts: [{ sourceNewsId: '166494', links: [event.url],
      sourceNewsUrl: 'https://bh3.mihoyo.com/news/693/166494',
      post: { subject: '忆旅的流彩叙映', created_at: Date.parse('2026-09-28T10:00:00+08:00') / 1000,
        content: '活动时间：2026年9月28日—2026年11月26日' } }] }) });
  assert.equal(result.events[0].startDate, '2026.09.28');
  assert.equal(result.events[0].startAt, undefined);
  assert.equal(result.events[0].endAt, '2026-11-26T04:00+08:00');
  assert.equal(result.events[0].timeSource, 'activity-config');
});

test('reused campaign links from another year do not supply a fallback', async () => {
  const result = await updateEventTimes({ events: [event], now, logger: quiet, fetchTime: missing,
    fetchNews: async () => ({ status: 'ok', posts: [{ sourceNewsId: '1', links: [event.url],
      sourceNewsUrl: 'https://bh3.mihoyo.com/news/693/1',
      post: { subject: '忆旅的流彩叙映', created_at: Date.parse('2025-09-28T10:00:00+08:00') / 1000,
        content: '活动时间：2025年9月28日—2025年10月20日' } }] }) });
  assert.deepEqual(result.events, [event]);
});

test('manual timestamps and precise API evidence survive weaker announcement dates', () => {
  const input = { ...event, startDate: '2026.09.28', endDate: '2026.11.26',
    startAt: '2026-09-28T10:00:00+08:00', endAt: '2026-11-26T04:00:00+08:00',
    timeSource: 'activity-api', timeSourceUrl: 'https://api-takumi.mihoyo.com/event/example' };
  assert.deepEqual(applyEventTime(input, { startDate: '2026.09.29', endDate: '2026.11.27',
    timeSource: 'announcement', timeSourceUrl: 'https://bh3.mihoyo.com/news/693/1' }), input);
  const manual = { ...input, timeSource: 'manual' };
  assert.deepEqual(applyEventTime(manual, { startAt: '2026-09-29T10:00:00+08:00' }), manual);
});

test('explicit version-period rules can use the matching official duration without inventing an opening clock', async () => {
  const input = { ...event, id: 'sr-58', game: '星穹铁道', gameKey: 'sr', version: 'v4.6' };
  const result = await updateEventTimes({ events: [input], now, logger: quiet,
    fetchTime: async () => ({ status: 'partial', method: 'activity-static-config', versionPeriod: 'v4.6',
      timeSource: 'activity-config', timeSourceUrl: 'https://fastcdn.mihoyo.com/config.json' }),
    fetchNews: async () => ({ status: 'ok', posts: [{ sourceNewsId: '166489', links: [],
      sourceNewsUrl: 'https://sr.mihoyo.com/news/166489',
      post: { subject: '4.6版本「月升之前，与兽共舞」版本更新说明',
        created_at: Date.parse('2026-09-28T11:00:00+08:00') / 1000,
        content: '4.6版本的持续时间为 2026/09/28 4.6版本更新后 - 2026/11/11 06:00。' } }] }) });
  assert.equal(result.events[0].startDate, '2026.09.28');
  assert.equal(result.events[0].startAt, undefined);
  assert.equal(result.events[0].endAt, '2026-11-11T06:00+08:00');
  assert.equal(result.report.records[0].method, 'official-version-period');
});

test('contradictory version-period rules remain a reported conflict', async () => {
  const result = await updateEventTimes({ events: [event], now, logger: quiet, fetchNews: news,
    fetchTime: async () => ({ status: 'partial', method: 'activity-static-config', versionPeriod: 'v9.0',
      timeSource: 'activity-config', timeSourceUrl: 'https://fastcdn.mihoyo.com/config.json' }) });
  assert.deepEqual(result.events, [event]);
  assert.equal(result.report.records[0].status, 'conflict');
});

test('failed and invalid evidence preserve known dates, with errors retained in the report', async () => {
  for (const fetchTime of [async () => { throw new Error('Timeout'); },
    async () => ({ status: 'ok', startDate: '2026.02.31', method: 'bad-config' })]) {
    const input = { ...event, startDate: '2026.09.28', endDate: '2026.11.26' };
    const result = await updateEventTimes({ events: [input], now, logger: quiet, fetchTime, fetchNews: news });
    assert.deepEqual(result.events, [input]);
    assert.equal(result.report.records[0].status, 'failed');
  }
});

test('dry-run reports verified proposals without writing event data', async () => {
  const folder = await mkdtemp(path.join(os.tmpdir(), 'hoyo-time-test-'));
  const eventsPath = path.join(folder, 'events.json'), reportPath = path.join(folder, 'report.json');
  const original = `${JSON.stringify([event], null, 2)}\n`;
  try {
    await writeFile(eventsPath, original);
    const result = await updateEventTimes({ eventsPath, reportPath, dryRun: true, now, logger: quiet, fetchNews: news,
      fetchTime: async () => ({ status: 'ok', method: 'test-api', startAt: '2026-09-28T10:00:00+08:00',
        endAt: '2026-11-26T04:00:00+08:00', timeSource: 'activity-api', timeSourceUrl: 'https://api-takumi.mihoyo.com/event/example' }) });
    assert.equal(await readFile(eventsPath, 'utf8'), original);
    assert.equal(JSON.parse(await readFile(reportPath, 'utf8')).summary.updated, 1);
    assert.equal(result.summary.coverage.preciseRanges, 1);
  } finally { await rm(folder, { recursive: true, force: true }); }
});
