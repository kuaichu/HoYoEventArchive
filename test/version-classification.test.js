import assert from 'node:assert/strict';
import test from 'node:test';

import {
  classifyEventVersion,
  extractExplicitVersion,
  inferVersionFromDate
} from '../scripts/version-classification.js';
import { classifyScrapedEventVersion } from '../scripts/scrape-and-update.js';

test('named Genshin versions map to their numeric target versions', () => {
  const aliases = [
    ['月之一', 'v6.0'], ['月之二', 'v6.1'], ['月之三', 'v6.2'], ['月之四', 'v6.3'],
    ['月之五', 'v6.4'], ['月之六', 'v6.5'], ['月之七', 'v6.6'], ['月之八', 'v6.7']
  ];
  for (const [alias, version] of aliases) {
    assert.equal(extractExplicitVersion(`《原神》「${alias}」版本前瞻`), version);
  }
});

test('Star Rail release days belong to the new version in UTC+8', () => {
  const boundaries = [
    ['2024.09.09', 'v2.4'], ['2024.09.10', 'v2.5'],
    ['2025.02.25', 'v3.0'], ['2025.02.26', 'v3.1'],
    ['2025.04.08', 'v3.1'], ['2025.04.09', 'v3.2'],
    ['2025.07.01', 'v3.3'], ['2025.07.02', 'v3.4'],
    ['2025.08.12', 'v3.4'], ['2025.08.13', 'v3.5'],
    ['2025.09.23', 'v3.5'], ['2025.09.24', 'v3.6'],
    ['2025.11.04', 'v3.6'], ['2025.11.05', 'v3.7'],
    ['2025.12.16', 'v3.7'], ['2025.12.17', 'v3.8']
  ];

  for (const [date, version] of boundaries) {
    assert.equal(inferVersionFromDate('sr', date), version, date);
  }
});

test('explicit content version wins over publication-date fallback', () => {
  assert.equal(classifyEventVersion({
    gameKey: 'sr',
    title: '3.2版本回归活动',
    date: '2025.03.01',
    allowDateFallback: true
  }), 'v3.2');
});

test('unrecognized content is pending rather than generic', () => {
  assert.equal(classifyEventVersion({
    gameKey: 'ys',
    title: '全新网页活动开启'
  }), '待确认');
});

test('cross-game description contamination cannot overwrite an intentional generic version', () => {
  assert.equal(classifyEventVersion({
    gameKey: 'zzz',
    title: '绝区零工具合集',
    description: '《原神》「月之八」版本前瞻特别节目',
    currentVersion: '通用',
    allowDateFallback: true,
    date: '2026.06.17'
  }), '通用');
});

test('date fallback recognizes pre-launch content', () => {
  assert.equal(classifyEventVersion({
    gameKey: 'sr',
    title: '群星邀约预抽卡',
    date: '2023.01.15',
    allowDateFallback: true
  }), '公测前');
});

test('legacy page scraper uses shared classification without overwriting intentional categories', () => {
  assert.equal(classifyScrapedEventVersion(
    { gameKey: 'zzz', version: '通用' },
    { title: '绝区零 3.1版本工具更新', metaDesc: '' }
  ), '通用');
  assert.equal(classifyScrapedEventVersion(
    { gameKey: 'ys', version: '待确认' },
    { title: '「月之七」版本活动页', metaDesc: '' }
  ), 'v6.6');
  assert.equal(classifyScrapedEventVersion(
    { gameKey: 'sr', version: 'v3.1' },
    { title: '崩坏：星穹铁道 3.2版本活动页', metaDesc: '' }
  ), 'v3.2');
});
