import assert from 'node:assert/strict';
import test from 'node:test';
import { formatEventTimeRange, normalizeEventTimestamp, timestampDate } from '../src/event-time.js';

test('explicit timezone timestamps normalize to Shanghai and retain the source precision', () => {
  for (const [value, expected] of [
    ['2026-07-16T16:01Z', '2026-07-17T00:01+08:00'],
    ['2026-07-17T10:00:30+09:00', '2026-07-17T09:00:30+08:00'],
    ['2026-07-16T15:59-01:00', '2026-07-17T00:59+08:00'],
    ['2000-02-29T23:59+08:00', '2000-02-29T23:59+08:00'],
    ['0099-02-28T00:00+08:00', '0099-02-28T00:00+08:00']
  ]) assert.equal(normalizeEventTimestamp(value), expected, value);
  assert.equal(timestampDate('2026-07-16T16:01Z'), '2026.07.17');
});

test('timestamp normalization rejects implicit timezone, calendar rollover, and malformed components', () => {
  for (const value of [
    null, 42, '', '2026-07-17', '2026-07-17T10:00', '2026-07-17 10:00+08:00',
    '2026-02-29T10:00+08:00', '1900-02-29T10:00+08:00', '2026-04-31T10:00+08:00',
    '2026-00-01T10:00+08:00', '2026-13-01T10:00+08:00', '2026-01-00T10:00+08:00',
    '2026-07-17T24:00+08:00', '2026-07-17T10:60+08:00', '2026-07-17T10:00:60+08:00',
    '2026-07-17T10:00:00.000+08:00', '2026-07-17T10:00+0800',
    '2026-07-17T10:00+24:00', '2026-07-17T10:00+08:60', '0000-01-01T00:00Z',
    '9999-12-31T23:59-08:00', '0001-01-01T00:00+23:59'
  ]) {
    assert.equal(normalizeEventTimestamp(value), undefined, String(value));
    assert.equal(timestampDate(value), undefined, String(value));
  }
});

test('participation range uses only explicit activity dates and displays unknown endpoints', () => {
  assert.equal(formatEventTimeRange({ date: '2026.07.01', dateType: 'announcement' }), '未知 ～ 未知');
  assert.equal(formatEventTimeRange({ startDate: '2026.07.02', endDate: '2026.07.17' }),
    '2026.07.02 ～ 2026.07.17');
  assert.equal(formatEventTimeRange({ date: '2026.07.01', endAt: '2026-07-17T23:59+08:00' }),
    '未知 ～ 2026.07.17 23:59（北京时间）');
  assert.equal(formatEventTimeRange({ startAt: '2026-07-16T16:00:30Z', endDate: '2026.07.18' }),
    '2026.07.17 00:00:30 ～ 2026.07.18（北京时间）');
  assert.equal(formatEventTimeRange({ startAt: 'bad', startDate: '2026.02.30' }), '未知 ～ 未知');
});
