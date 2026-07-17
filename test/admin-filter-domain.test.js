import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildVersionFilterGroups,
  encodeVersionFilter,
  eventMatchesVersionFilter,
  parseVersionFilter
} from '../src/admin-filter-domain.js';

const events = [
  { id: 'ys-1', game: '原神', version: 'v3.1' },
  { id: 'ys-2', game: '原神', version: 'v2.1' },
  { id: 'sr-1', game: '星穹铁道', version: 'v3.1' },
  { id: 'sr-pre', game: '星穹铁道', version: '公测前' },
  { id: 'all-1', game: '全部游戏', version: '通用' }
];

test('all-game version options retain their game identity', () => {
  const groups = buildVersionFilterGroups(events);
  const options = groups.flatMap(group => group.options);

  assert.equal(options.filter(option => option.version === 'v3.1').length, 2);
  assert.ok(options.some(option => option.label === '原神 · v3.1'));
  assert.ok(options.some(option => option.label === '星穹铁道 · v3.1'));
  assert.ok(groups.some(group => group.label === '通用活动'));
});

test('selecting a game limits version options to that game', () => {
  const groups = buildVersionFilterGroups(events, '原神');

  assert.equal(groups.length, 1);
  assert.equal(groups[0].game, '原神');
  assert.deepEqual(groups[0].options.map(option => option.label), ['v3.1', 'v2.1']);
});

test('pre-launch classification is displayed and filterable for Star Rail', () => {
  const groups = buildVersionFilterGroups(events, '星穹铁道');
  const labels = groups[0].options.map(option => option.label);

  assert.ok(labels.includes('公测前'));
  assert.ok(!labels.includes('v1.0 预热'));
  const value = encodeVersionFilter('星穹铁道', '公测前');
  assert.equal(eventMatchesVersionFilter(events[3], value), true);
  assert.equal(eventMatchesVersionFilter(events[2], value), false);
});

test('version filter values match both game and version', () => {
  const value = encodeVersionFilter('原神', 'v3.1');

  assert.deepEqual(parseVersionFilter(value), { game: '原神', version: 'v3.1' });
  assert.equal(eventMatchesVersionFilter(events[0], value), true);
  assert.equal(eventMatchesVersionFilter(events[2], value), false);
  assert.equal(eventMatchesVersionFilter(events[0], ''), true);
});
