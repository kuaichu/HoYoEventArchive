import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { enrichVersions } from '../scripts/enrich-versions.js';

const quiet = { log() {}, warn() {} };
const fetchNews = async () => ({ posts: [], status: 'ok', error: null });
const event = { id: 'zzz-1', gameKey: 'zzz', title: '年度数据回顾', type: '年度报告',
  description: '查看自己的年度足迹。', url: 'https://act.mihoyo.com/zzz/event/report/index.html',
  date: '2026.09.14', version: '待确认', tags: ['年度报告'] };
const context = { status: 'confirmed', currentVersion: 'v3.2', checkedDate: '2026.10.04',
  releases: [{ version: 'v3.2', date: '2026.09.09' }] };

test('version repair fills pending records while preserving valid historical versions and other fields', async () => {
  const historical = { ...event, id: 'zzz-2', version: 'v3.1', date: '2026.08.01' };
  const result = await enrichVersions({ events: [event, historical], fetchNews, logger: quiet,
    versionContexts: { zzz: context } });
  assert.equal(result.summary.updated, 1);
  assert.deepEqual(result.events[0], { ...event, version: 'v3.2', tags: ['年度报告', 'v3.2版本'] });
  assert.deepEqual(result.events[1], historical);
  assert.equal(event.version, '待确认');
});

test('conflicts, maintenance days and dates beyond the API observation remain pending', async () => {
  for (const [date, versionContext] of [
    ['2026.09.14', { ...context, status: 'conflict', currentVersion: undefined }],
    ['2026.09.09', context], ['2026.10.05', context]
  ]) {
    const input = { ...event, date };
    const result = await enrichVersions({ events: [input], fetchNews, logger: quiet,
      versionContexts: { zzz: versionContext } });
    assert.deepEqual(result.events, [input]);
    assert.equal(result.summary.updated, 0);
  }
});

test('a matched activity announcement can resolve a pending future preview without using the current version', async () => {
  const input = { ...event, type: '版本前瞻', title: '新版本特别节目' };
  const result = await enrichVersions({ events: [input], logger: quiet, versionContexts: {},
    fetchNews: async () => ({ status: 'ok', error: null, posts: [{ sourceNewsId: '100',
      links: [input.url], post: { subject: '3.3版本前瞻特别节目', content: '' } }] }) });
  assert.equal(result.events[0].version, 'v3.3');
});

test('dry-run version repair proposes changes without touching the file', async () => {
  const folder = await mkdtemp(path.join(os.tmpdir(), 'hoyo-version-repair-'));
  const eventsPath = path.join(folder, 'events.json');
  const original = `${JSON.stringify([event], null, 2)}\n`;
  try {
    await writeFile(eventsPath, original);
    const result = await enrichVersions({ eventsPath, dryRun: true, fetchNews, logger: quiet,
      versionContexts: { zzz: context } });
    assert.equal(result.summary.updated, 1);
    assert.equal(await readFile(eventsPath, 'utf8'), original);
  } finally { await rm(folder, { recursive: true, force: true }); }
});
