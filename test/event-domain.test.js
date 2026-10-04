import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
  EVENT_FIELDS,
  normalizeEvent,
  projectEventForDisplay,
  resolveEventStatus,
  safeCoverUrl,
  validateEvent,
  validateEventCollection
} from '../src/event-domain.js';

test('day-only future starts are upcoming without guessing a clock on their start day', () => {
  const event = { status: '可访问', startDate: '2026.10.05' };
  assert.equal(resolveEventStatus(event, '2026.10.04', '2026-10-04T12:00:00+08:00'), '未开始');
  assert.equal(resolveEventStatus({ ...event, status: '未开始' }, '2026.10.05', '2026-10-05T00:00:00+08:00'), '可访问');
  assert.equal(resolveEventStatus({ ...event, status: '需登录' }, '2026.10.04', '2026-10-04T12:00:00+08:00'), '需登录');
});

const events = JSON.parse(
  fs.readFileSync(new URL('../src/events.json', import.meta.url), 'utf8')
);

test('official news provenance persists independently from historical post IDs', () => {
  const fallback = { ...events[0], sourcePostId: 'legacy-reference', sourceNewsId: '456',
    sourceNewsUrl: 'https://sr.mihoyo.com/news/456?utm_source=archive' };
  assert.ok(EVENT_FIELDS.includes('sourceNewsId'));
  assert.ok(EVENT_FIELDS.includes('sourceNewsUrl'));
  const retained = normalizeEvent({ id: fallback.id, title: 'Edited title' }, fallback);
  assert.equal(retained.sourceNewsId, '456');
  assert.equal(retained.sourceNewsUrl, 'https://sr.mihoyo.com/news/456');
  assert.equal(retained.sourcePostId, 'legacy-reference');
  assert.deepEqual(validateEvent(retained), []);
  for (const sourceNewsId of [null, undefined, 456, 'legacy-reference', '']) {
    const cleared = normalizeEvent({ ...fallback, sourceNewsId }, fallback);
    assert.equal(cleared.sourceNewsId, undefined);
    assert.equal(cleared.sourcePostId, fallback.sourcePostId);
    assert.equal(cleared.sourceNewsUrl, retained.sourceNewsUrl);
  }
  for (const sourceNewsUrl of [null, undefined, 'javascript:bad', 'https://user:pass@example.com/news/1']) {
    const cleared = normalizeEvent({ ...fallback, sourceNewsUrl }, fallback);
    assert.equal(cleared.sourceNewsUrl, undefined);
    assert.equal(cleared.sourceNewsId, '456');
  }
  assert.deepEqual(validateEvent({ ...events[0], sourceNewsId: null, sourceNewsUrl: null }), []);
  for (const sourceNewsId of [456, '', 'abc']) {
    assert.ok(validateEvent({ ...events[0], sourceNewsId }).some(issue => issue.includes('sourceNewsId')));
  }
  assert.ok(validateEvent({ ...events[0], sourceNewsUrl: 'https://user@example.com/news/1' })
    .some(issue => issue.includes('sourceNewsUrl')));
});

test('cover URLs accept only safe archived paths and credential-free remote images', () => {
  for (const extension of ['jpg', 'jpeg', 'png', 'webp']) {
    const path = `/images/covers/ys-1.${extension}`;
    assert.equal(safeCoverUrl(path), path);
  }
  const remote = 'https://example.com/cover?mode=crop&win_mode=dark&utm_source=signed&signature=a%2Fb';
  assert.equal(safeCoverUrl(remote), remote);
  for (const value of [
    'javascript:alert(1)', 'data:image/png;base64,eA==', '//example.com/a.jpg',
    'https://user:pass@example.com/a.jpg', '/images/covers/../ys-1.jpg',
    '/images/covers/ys-1.svg', '/images/screenshots/ys-1.png', '/images/covers/ys-1.jpg?evil=1',
    null, 42
  ]) {
    assert.equal(safeCoverUrl(value), null, String(value));
  }
});

test('cover fields survive normalization while explicit null or unsafe URLs clear only their own field', () => {
  const fallback = {
    ...events[0],
    coverUrl: '/images/covers/ys-1.jpg',
    coverSourceUrl: 'https://example.com/cover.jpg?mode=resize&token=a%2Fb'
  };
  const retained = normalizeEvent({ id: fallback.id, title: 'Edited title' }, fallback);
  assert.equal(retained.coverUrl, fallback.coverUrl);
  assert.equal(retained.coverSourceUrl, fallback.coverSourceUrl);
  for (const coverUrl of [null, undefined, 'javascript:bad']) {
    const cleared = normalizeEvent({ ...fallback, coverUrl }, fallback);
    assert.equal(cleared.coverUrl, undefined);
    assert.equal(cleared.coverSourceUrl, fallback.coverSourceUrl);
  }
  const cleared = normalizeEvent({ ...fallback, coverSourceUrl: null }, fallback);
  assert.equal(cleared.coverUrl, fallback.coverUrl);
  assert.equal(cleared.coverSourceUrl, undefined);
  assert.equal(normalizeEvent({ ...fallback, coverSourceUrl: fallback.coverUrl }, fallback).coverSourceUrl, undefined);
});

test('cover schema validates archived images, source URLs, and explicit removals', () => {
  assert.deepEqual(validateEvent({
    ...events[0], coverUrl: '/images/covers/ys-1.webp', coverSourceUrl: 'https://example.com/image.jpg'
  }), []);
  assert.deepEqual(validateEvent({ ...events[0], coverUrl: null, coverSourceUrl: null }), []);
  assert.notDeepEqual(validateEvent({ ...events[0], coverUrl: '/other/ys-1.jpg' }), []);
  assert.notDeepEqual(validateEvent({ ...events[0], coverSourceUrl: '/images/covers/ys-1.jpg' }), []);
  assert.notDeepEqual(validateEvent({ ...events[0], coverSourceUrl: 'https://user@example.com/image.jpg' }), []);
});

test('announcement dates never imply that an event has ended', () => {
  const event = {
    status: '可访问',
    date: '2026.07.15',
    dateType: 'announcement'
  };

  assert.equal(resolveEventStatus(event, '2026.07.17'), '可访问');
});

test('only an explicit past endDate changes an event to ended', () => {
  assert.equal(
    resolveEventStatus({ status: '可访问', endDate: '2026.07.16' }, '2026.07.17'),
    '已结束'
  );
  assert.equal(
    resolveEventStatus({ status: '可访问', endDate: '2026.07.17' }, '2026.07.17'),
    '可访问'
  );
  assert.equal(
    resolveEventStatus({ status: '需登录', endDate: 'not-a-date' }, '2026.07.17'),
    '需登录'
  );
  assert.equal(
    resolveEventStatus({ status: '已失效', endDate: '2026.01.01' }, '2026.07.17'),
    '已失效'
  );
  assert.equal(
    resolveEventStatus({ status: '拼写错误', endDate: '2026.01.01' }, '2026.07.17'),
    '拼写错误'
  );
});

test('display projection exposes the effective lifecycle status without mutating source data', () => {
  const source = { status: '可访问', endDate: '2026.07.16' };
  const projected = projectEventForDisplay(source, '2026.07.17');

  assert.equal(projected.status, '已结束');
  assert.equal(source.status, '可访问');
});

test('precise lifecycle cutoff includes the whole stated minute and respects seconds', () => {
  for (const [endAt, before, cutoff] of [
    ['2026-07-17T23:59+08:00', '2026-07-17T23:59:59.999+08:00', '2026-07-18T00:00:00+08:00'],
    ['2026-07-17T10:00+08:00', '2026-07-17T10:00:59.999+08:00', '2026-07-17T10:01:00+08:00'],
    ['2026-07-17T10:00:30+08:00', '2026-07-17T10:00:29.999+08:00', '2026-07-17T10:00:30+08:00']
  ]) {
    const event = { status: '可访问', endAt, endDate: '2026.07.01' };
    assert.equal(resolveEventStatus(event, '2026.07.18', new Date(before)), '可访问', endAt);
    assert.equal(resolveEventStatus(event, '2026.07.17', new Date(cutoff)), '已结束', endAt);
    assert.equal(resolveEventStatus({ ...event, status: '已失效' }, '2026.07.17', cutoff), '已失效');
  }
});

test('future starts affect available events while unavailable and login states retain precedence', () => {
  const startAt = '2026-07-17T10:00+08:00';
  const before = new Date('2026-07-17T09:59:59+08:00');
  const atStart = new Date(startAt);
  for (const status of ['可访问', '未开始']) {
    const event = { status, startAt };
    assert.equal(resolveEventStatus(event, '2026.07.17', before), '未开始');
    assert.equal(resolveEventStatus(event, '2026.07.17', atStart), '可访问');
    assert.equal(projectEventForDisplay(event, '2026.07.17', before).status, '未开始');
    assert.equal(event.status, status);
  }
  for (const status of ['需登录', '已失效', '已结束']) {
    assert.equal(resolveEventStatus({ status, startAt }, '2026.07.17', before), status);
    assert.equal(resolveEventStatus({ status, startAt }, '2026.07.17', atStart), status);
  }
});

test('time metadata normalizes offsets, retains fallback data, and supports explicit removal', () => {
  const fallback = {
    ...events[0], startDate: '2026.07.17', endDate: '2026.07.18',
    startAt: '2026-07-16T16:00Z', endAt: '2026-07-18T23:59:00+08:00',
    timeSource: 'activity-api', timeSourceUrl: 'https://example.com/api?mode=detail&signature=a%2Fb',
    timeStages: [
      { name: '活动', startAt: '2026-07-16T16:00Z', endAt: '2026-07-18T23:59:00+08:00' },
      { name: '评奖', startAt: '2026-07-19T10:00+08:00' }
    ]
  };
  const timeFields = ['startAt', 'endAt', 'timeSource', 'timeSourceUrl', 'timeStages'];
  for (const field of timeFields) assert.ok(EVENT_FIELDS.includes(field), field);
  const normalized = normalizeEvent({ id: fallback.id, title: 'Edited' }, fallback);
  assert.equal(normalized.startAt, '2026-07-17T00:00+08:00');
  assert.equal(normalized.endAt, fallback.endAt);
  assert.equal(normalized.timeSourceUrl, fallback.timeSourceUrl);
  assert.equal(normalized.timeStages[0].startAt, normalized.startAt);
  assert.notEqual(normalized.timeStages, fallback.timeStages);
  assert.deepEqual(validateEvent(normalized), []);
  for (const field of timeFields) {
    for (const value of [null, undefined]) {
      assert.equal(normalizeEvent({ id: fallback.id, [field]: value }, fallback)[field], undefined, field);
    }
  }
  assert.deepEqual(validateEvent({ ...events[0], ...Object.fromEntries(timeFields.map(field => [field, null])) }), []);
});

test('time schema rejects unsafe sources, mismatched dates, timestamp ordering, and malformed stages', () => {
  const { startAt, endAt, timeStages, ...fixture } = events[0];
  const base = { ...fixture, startDate: '2026.07.17', endDate: '2026.07.18' };
  for (const patch of [
    { startAt: '2026-07-17T10:00' },
    { startAt: '2026-02-30T10:00+08:00' },
    { startAt: '2026-07-16T10:00+08:00' },
    { endAt: '2026-07-19T10:00+08:00' },
    { startAt: '2026-07-18T10:00+08:00', endAt: '2026-07-17T10:00+08:00' },
    { timeSource: 'unknown' }, { timeSourceUrl: 'https://user:pass@example.com/api' },
    { timeSourceUrl: '/api' }, { timeSourceUrl: 'javascript:alert(1)' },
    { timeStages: [] }, { timeStages: Array(13).fill({ name: '活动', startAt: '2026-07-17T10:00Z' }) },
    { timeStages: [{ name: '' }] }, { timeStages: [{ name: 'a'.repeat(49), startAt: '2026-07-17T10:00Z' }] },
    { timeStages: [{ name: '活动', startAt: null }] },
    { timeStages: [{ name: '活动', startAt: '2026-07-17T10:00Z', unrelated: 1 }] },
    { timeStages: [{ name: '活动', startAt: '2026-07-18T10:00Z', endAt: '2026-07-17T10:00Z' }] },
    { timeStages: [
      { name: '评奖', startAt: '2026-07-18T10:00Z' },
      { name: '投稿', startAt: '2026-07-17T10:00Z' }
    ] }
  ]) assert.notDeepEqual(validateEvent({ ...base, ...patch }), [], JSON.stringify(patch));
  for (const timeSource of ['activity-api', 'activity-config', 'announcement', 'manual']) {
    assert.deepEqual(validateEvent({ ...base, timeSource }), []);
  }
  assert.deepEqual(validateEvent({ ...base, timeStages: [{ name: '投稿', endAt: '2026-07-18T10:00Z' }] }), []);
});

test('schema rejects unsafe URLs and mismatched game metadata', () => {
  const valid = events[0];
  assert.notDeepEqual(
    validateEventCollection([{ ...valid, url: 'https://user:pass@example.com/path' }]),
    []
  );
  assert.notDeepEqual(
    validateEventCollection([{ ...valid, url: 'javascript:alert(1)' }]),
    []
  );
  assert.notDeepEqual(
    validateEventCollection([{ ...valid, game: '原神', gameKey: 'sr' }]),
    []
  );
  assert.notDeepEqual(
    validateEventCollection([{ ...valid, status: '拼写错误' }]),
    []
  );
});

test('description provenance accepts only supported sources', () => {
  for (const descriptionSource of ['announcement', 'page', 'manual']) {
    assert.deepEqual(validateEvent({ ...events[0], descriptionSource }), []);
  }
  assert.ok(validateEvent({ ...events[0], descriptionSource: 'unknown' })
    .some(issue => issue.includes('descriptionSource')));
});

test('version schema accepts only normalized classifications', () => {
  const base = {
    ...events.find(event => event.id === 'ys-11'),
    type: '小游戏'
  };

  for (const version of ['v1.0', 'v12.34', '公测前', '通用', '待确认']) {
    assert.deepEqual(validateEvent({ ...base, version }), [], version);
  }

  for (const version of ['1.0', 'v1', 'v1.0 预热', '未知', '']) {
    assert.notDeepEqual(validateEvent({ ...base, version }), [], version);
  }
});

test('version previews require a confirmed numeric target version', () => {
  const base = {
    ...events.find(event => event.id === 'ys-29'),
    version: 'v6.6'
  };

  assert.deepEqual(validateEvent(base), []);
  assert.notDeepEqual(validateEvent({ ...base, version: '通用' }), []);
  assert.notDeepEqual(validateEvent({ ...base, version: '待确认' }), []);
});

test('the complete event collection satisfies the shared contract', () => {
  assert.deepEqual(validateEventCollection(events), []);
});

test('known version corrections remain locked to their target classifications', () => {
  const expectedVersions = new Map([
    ['ys-5', 'v6.0'], ['ys-11', 'v5.0'], ['ys-16', 'v6.0'], ['ys-20', 'v2.4'],
    ['ys-27', 'v6.6'], ['ys-29', 'v6.6'], ['ys-31', 'v6.6'], ['ys-32', 'v6.6'],
    ['ys-35', 'v6.7'], ['ys-36', 'v6.7'], ['ys-37', 'v6.7'], ['ys-40', 'v6.7'],
    ['sr-1', '公测前'], ['sr-2', 'v3.4'], ['sr-7', 'v3.2'], ['sr-14', 'v3.2'],
    ['sr-19', '通用'], ['sr-28', '公测前'], ['sr-30', '公测前'], ['sr-31', '公测前'],
    ['zzz-8', '公测前'], ['bh3-1', 'v8.5'], ['bh3-8', 'v9.0'], ['sr-58', 'v4.6']
  ]);
  const byId = new Map(events.map(event => [event.id, event]));

  for (const [id, version] of expectedVersions) {
    assert.equal(byId.get(id)?.version, version, id);
  }
});

test('July announcement records preserve verified event windows and lifecycle boundaries', () => {
  const julyIds = new Set([
    'ys-38',
    'sr-45',
    'sr-46',
    'sr-47',
    'ys-39',
    'ys-40',
    'sr-48',
    'sr-49'
  ]);

  const julyEvents = events.filter(event => julyIds.has(event.id));
  assert.equal(julyEvents.length, julyIds.size);
  const verifiedEndDates = new Map([
    ['ys-38', '2026.07.05'],
    ['sr-46', '2026.07.05'],
    ['sr-47', '2026.08.18'],
    ['ys-39', '2026.08.31'],
    ['ys-40', '2026.07.28'],
    ['sr-49', '2026.08.26']
  ]);

  for (const event of julyEvents) {
    assert.equal(event.dateType, 'announcement');
    assert.equal(event.endDate, verifiedEndDates.get(event.id));
    if (event.endDate) {
      assert.notEqual(event.endDate, event.date);
      assert.equal(
        resolveEventStatus({ ...event, status: '可访问' }, '2026.07.18', new Date('2026-07-18T00:00:00+08:00')),
        event.endDate < '2026.07.18' ? '已结束' : '可访问',
        `${event.id} should respect its verified end date`
      );
    }
  }
});
