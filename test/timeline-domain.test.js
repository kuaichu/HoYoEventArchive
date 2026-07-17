import assert from 'node:assert/strict';
import test from 'node:test';

import { groupTimelineEvents, timelineDayLabel } from '../src/timeline-domain.js';

test('timeline groups events by descending year and month', () => {
  const groups = groupTimelineEvents([
    { id: 'old', date: '2025.12.31' },
    { id: 'july-early', date: '2026.07.01' },
    { id: 'june', date: '2026.06.20' },
    { id: 'july-late', date: '2026.07.15' }
  ]);

  assert.deepEqual(groups.map(group => group.year), ['2026', '2025']);
  assert.deepEqual(groups[0].months.map(group => group.month), ['07', '06']);
  assert.deepEqual(groups[0].months[0].events.map(event => event.id), ['july-late', 'july-early']);
  assert.equal(groups[0].months[0].label, '7月');
});

test('timeline day labels distinguish announcement dates', () => {
  assert.equal(timelineDayLabel({ date: '2026.07.15' }), '15日');
  assert.equal(timelineDayLabel({ date: '2026.07.15', dateType: 'announcement' }), '公告 15日');
});
