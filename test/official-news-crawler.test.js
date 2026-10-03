import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { normalizeOfficialNews } from '../scripts/official-news.js';
import { runCrawler as crawl } from '../scripts/official-news-crawler.js';

const runCrawler = options => crawl({ versionContexts: {}, ...options });

const quiet = { log() {}, warn() {} };
const activityUrl = 'https://act.mihoyo.com/sr/event/test-api/index.html';
function article(id, url = activityUrl) {
  return normalizeOfficialNews('sr', {
    iInfoId: id, sTitle: '「群星邀约」网页活动开启',
    dtStartTime: '2026-09-01 10:00:00', dtEndTime: '2035-01-01 00:00:00',
    sContent: `<p>亲爱的开拓者：</p><p>参与网页活动，完成邀请任务，即可获得星琼奖励。</p>
      <p>活动时间</p><p>2026/09/01 10:00 - 2026/09/10 23:59</p><a href="${url}">参与活动</a>`,
    sExt: JSON.stringify({ 'news-poster': [{ url: 'https://fastcdn.mihoyo.com/banner.png' }] })
  });
}
function source(posts) { return async () => ({ posts, status: 'ok', error: null }); }
const noNetwork = async () => { throw new Error('Activity pages and Miyoushe must not be fetched'); };

test('API crawler builds events from announcement fields without loading activity pages', async () => {
  const result = await runCrawler({ events: [], games: ['sr'], fetchNews: source([article(1)]),
    fetchImpl: noNetwork, logger: quiet });
  assert.equal(result.newEventsCount, 1);
  const event = result.events[0];
  assert.equal(event.id, 'sr-1');
  assert.equal(event.sourceNewsId, '1');
  assert.equal(event.sourceNewsUrl, 'https://sr.mihoyo.com/news/1');
  assert.equal(event.sourcePostId, undefined);
  assert.equal(event.date, '2026.09.01');
  assert.equal(event.endDate, '2026.09.10');
  assert.equal(event.coverSourceUrl, 'https://fastcdn.mihoyo.com/banner.png');
  assert.match(event.description, /完成邀请任务/);
});

test('API crawler canonical URL deduplication preserves manual content and original IDs', async () => {
  const existing = { id: 'sr-7', gameKey: 'sr', url: activityUrl, title: '人工标题', version: 'v4.5',
    description: '人工整理简介', descriptionSource: 'manual', reward: '已核对奖励',
    coverSourceUrl: 'https://fastcdn.mihoyo.com/curated.png', sourcePostId: 'old-post' };
  const result = await runCrawler({ events: [existing], games: ['sr'],
    fetchNews: source([article(1), article(2, `${activityUrl}?utm_source=web`)]),
    fetchImpl: noNetwork, logger: quiet });
  assert.equal(result.newEventsCount, 0);
  assert.equal(result.updatedEventsCount, 1);
  assert.equal(result.events.length, 1);
  assert.deepEqual(result.events[0], { ...existing, sourceNewsId: '1', sourceNewsUrl: 'https://sr.mihoyo.com/news/1' });
  assert.equal(existing.sourceNewsId, undefined);
});

test('API crawler never assigns a foreign game announcement to an existing URL', async () => {
  const existing = { id: 'ys-1', gameKey: 'ys', url: activityUrl, description: '原简介' };
  const result = await runCrawler({ events: [existing], games: ['sr'], fetchNews: source([article(1)]), logger: quiet });
  assert.equal(result.updatedEventsCount, 0);
  assert.deepEqual(result.events, [existing]);
});

test('API crawler skips a permanent creator service linked by an incentive announcement', async () => {
  const result = await runCrawler({ events: [], games: ['sr'], logger: quiet,
    fetchNews: source([article(1, 'https://webstatic.mihoyo.com/app/community-creator/#/home')]) });
  assert.equal(result.newEventsCount, 0);
  assert.deepEqual(result.events, []);
});

test('live branch and official maintenance evidence can classify a new annual report', async () => {
  const final = normalizeOfficialNews('zzz', { iInfoId: 100, sTitle: '3.2版本「她与她的隐秘往事」更新公告',
    dtStartTime: '2026-09-09 07:00:00', sContent: '<p>【更新开始时间】</p><p>2026/09/09 06:00</p>' });
  const report = normalizeOfficialNews('zzz', { iInfoId: 101, sTitle: '年度大揭秘网页活动开启',
    dtStartTime: '2026-09-14 12:00:00',
    sContent: '<p>分享年度回顾，即可领取菲林奖励。</p><a href="https://act.mihoyo.com/zzz/event/test-report/index.html">参与活动</a>' });
  const options = { events: [], games: ['zzz'], fetchNews: source([report, final]), logger: quiet,
    now: Date.parse('2026-10-04T00:00:00Z'), fetchImpl: noNetwork,
    fetchLauncher: async () => ({ games: { zzz: { version: 'v3.2' } }, status: 'ok' }) };
  const confirmed = await crawl(options);
  assert.equal(confirmed.events[0].version, 'v3.2');
  assert.equal(confirmed.sourceOutcomes[0].versionReference.status, 'confirmed');
  const conflicting = await crawl({ ...options,
    fetchLauncher: async () => ({ games: { zzz: { version: 'v3.1' } }, status: 'ok' }) });
  assert.equal(conflicting.events[0].version, '待确认');
  assert.equal(conflicting.sourceOutcomes[0].versionReference.status, 'conflict');
});

test('API crawler continues with one working game and fails when all sources fail', async () => {
  const fetchNews = async key => key === 'sr' ? { posts: [article(1)], status: 'ok', error: null }
    : { posts: [], status: 'failed', error: 'offline' };
  const result = await runCrawler({ events: [], games: ['ys', 'sr'], fetchNews, logger: quiet });
  assert.equal(result.newEventsCount, 1);
  assert.deepEqual(result.sourceOutcomes.map(item => item.status), ['failed', 'ok']);
  await assert.rejects(runCrawler({ events: [], games: ['ys'], fetchNews, logger: quiet }), /All configured/);
});

test('API crawler dry run and all-source failure leave the original file unchanged', async () => {
  const folder = await mkdtemp(path.join(os.tmpdir(), 'hoyo-api-crawler-'));
  const eventsPath = path.join(folder, 'events.json');
  try {
    await writeFile(eventsPath, '[]\n');
    const result = await runCrawler({ eventsPath, games: ['sr'], dryRun: true,
      fetchNews: source([article(1)]), logger: quiet });
    assert.equal(result.newEventsCount, 1);
    assert.equal(await readFile(eventsPath, 'utf8'), '[]\n');
    await assert.rejects(runCrawler({ eventsPath, games: ['sr'], logger: quiet,
      fetchNews: async () => ({ posts: [], status: 'failed', error: 'offline' }) }), /not written/);
    assert.equal(await readFile(eventsPath, 'utf8'), '[]\n');
  } finally { await rm(folder, { recursive: true, force: true }); }
});
