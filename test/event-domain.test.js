import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
  normalizeEvent,
  projectEventForDisplay,
  resolveEventStatus,
  safeCoverUrl,
  validateEvent,
  validateEventCollection
} from '../src/event-domain.js';

const events = JSON.parse(
  fs.readFileSync(new URL('../src/events.json', import.meta.url), 'utf8')
);

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
    ['zzz-8', '公测前'], ['bh3-1', 'v8.5'], ['bh3-8', 'v9.0']
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
    ['ys-40', '2026.07.28']
  ]);

  for (const event of julyEvents) {
    assert.equal(event.dateType, 'announcement');
    assert.equal(event.endDate, verifiedEndDates.get(event.id));
    if (event.endDate) {
      assert.notEqual(event.endDate, event.date);
      assert.equal(
        resolveEventStatus({ ...event, status: '可访问' }, '2026.07.18'),
        event.endDate < '2026.07.18' ? '已结束' : '可访问',
        `${event.id} should respect its verified end date`
      );
    }
  }
});
