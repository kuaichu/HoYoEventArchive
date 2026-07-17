import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
  projectEventForDisplay,
  resolveEventStatus,
  validateEventCollection
} from '../src/event-domain.js';

const events = JSON.parse(
  fs.readFileSync(new URL('../src/events.json', import.meta.url), 'utf8')
);

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

test('the complete event collection satisfies the shared contract', () => {
  assert.deepEqual(validateEventCollection(events), []);
});

test('July announcement records are restored from the invalid ended state', () => {
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

  for (const event of julyEvents) {
    assert.equal(event.status, '可访问', `${event.id} should be available`);
    assert.equal(event.dateType, 'announcement');
    assert.equal(event.endDate, undefined);
  }
});
