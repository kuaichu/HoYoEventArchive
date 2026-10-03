import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchLauncherVersions, buildVersionContext } from '../scripts/version-evidence.js';

const now = Date.parse('2026-10-04T04:00:00Z');
const lookupImpl = async () => [{ address: '8.8.8.8', family: 4 }];
const games = [
  ['ys', '1Z8W5NHUQb', 'hk4e_cn', '7.1.0'],
  ['sr', '64kMb5iAWu', 'hkrpg_cn', '4.6.0'],
  ['zzz', 'x6znKlJ0xK', 'nap_cn', '3.2.0'],
  ['bh3', 'osvnlOc0S8', 'bh3_cn', '9.1.0']
];
const branches = () => games.map(([, id, biz, tag]) => ({ game: { id, biz },
  main: { tag, required_client_version: '99.0.0' },
  pre_download: { tag: '100.0.0' } }));
const response = rows => new Response(JSON.stringify({ retcode: 0, data: { game_branches: rows } }));
const post = (subject, content, published = '2026-09-20T00:00:00Z', id = '1') => ({
  sourceNewsId: id, sourceNewsUrl: `https://ys.mihoyo.com/main/news/detail/${id}`,
  post: { subject, content, created_at: Date.parse(published) / 1000 }
});
const context = (posts, version, gameKey = 'ys') => buildVersionContext(gameKey, posts, { version }, { now });

test('launcher batches four strict game identities and uses only main.tag', async () => {
  let calls = 0;
  const result = await fetchLauncherVersions({ lookupImpl, fetchImpl: async (raw, options) => {
    calls++;
    const url = new URL(raw);
    assert.equal(url.hostname, 'hyp-api.mihoyo.com');
    assert.equal(url.pathname, '/hyp/hyp-connect/api/getGameBranches');
    assert.equal(url.searchParams.get('launcher_id'), 'jGHBHlcOq1');
    assert.deepEqual(url.searchParams.getAll('game_ids[]'), games.map(game => game[1]));
    assert.equal(options.headers.Authorization, undefined);
    return response(branches());
  } });
  assert.equal(calls, 1);
  assert.equal(result.status, 'ok');
  assert.deepEqual(result.games.ys, { version: 'v7.1', branchVersion: '7.1.0' });
  assert.deepEqual(result.games.bh3, { version: 'v9.1', branchVersion: '9.1.0' });
});

test('missing, duplicate, wrong-biz and malformed branches cannot supply a version', async () => {
  for (const mutate of [
    rows => rows.slice(1),
    rows => [...rows, rows[0]],
    rows => { rows[0].game.biz = 'nap_cn'; return rows; },
    rows => { rows[0].main.tag = '7.1'; return rows; },
    rows => { rows[0].main.tag = '7.1.0-download'; return rows; },
    rows => { delete rows[0].main; return rows; }
  ]) {
    const result = await fetchLauncherVersions({ lookupImpl, fetchImpl: async () => response(mutate(branches())) });
    assert.equal(result.status, 'partial');
    assert.equal(result.games.ys, undefined);
    assert.equal(result.games.zzz.version, 'v3.2');
    assert.match(result.error, /ys:/);
  }
  const empty = await fetchLauncherVersions({ lookupImpl, fetchImpl: async () => response([]) });
  assert.equal(empty.status, 'failed');
  assert.deepEqual(empty.games, {});
});

test('launcher failures, invalid JSON, oversize and bounded timeout return failure without throwing', async () => {
  for (const fetchImpl of [
    async () => { throw new TypeError('fetch failed'); },
    async () => new Response('{broken'),
    async () => new Response(JSON.stringify({ retcode: -1, data: {} })),
    async () => new Response('{}', { headers: { 'content-length': String(8 * 1024 * 1024 + 1) } }),
    async () => new Promise(() => {})
  ]) {
    const result = await fetchLauncherVersions({ lookupImpl, fetchImpl, timeoutMs: 15 });
    assert.equal(result.status, 'failed');
    assert.deepEqual(result.games, {});
    assert.ok(result.error);
  }
});

test('real-style HTML update sections beat publication, compensation and event dates', () => {
  const rows = [
    post('「往冥府的安魂歌」7.1版本更新说明', `<p>活动时间：2026/10/11 06:00。</p>
      <p><strong>〓更新时间〓</strong></p><p>2026/09/23 06:00开始，预计5个小时完成。</p>
      <p>〓补偿说明〓</p><p>请于2026/10/23前领取奖励。</p>`),
    post('「无神怜爱的雪国」7.0版本更新说明', '<p>〓更新时间〓</p><p>2026/08/12 06:00开始，预计5个小时完成。</p>', '2026-08-10T00:00:00Z', '2'),
    post('「『空月之歌·谐谑』映夏！归乡？千灵节！」「月之八」版本更新说明', '<p>〓更新时间〓</p><p>2026/07/01 06:00开始，预计5个小时完成。</p>', '2026-06-30T00:00:00Z', '3')
  ];
  const result = context(rows, 'v5.5');
  assert.deepEqual(result.releases.map(({ version, date }) => [version, date]), [
    ['v6.7', '2026.07.01'], ['v7.0', '2026.08.12'], ['v7.1', '2026.09.23']
  ]);
  assert.equal(result.status, 'conflict');
  assert.equal(result.announcementVersion, 'v7.1');
  assert.equal(result.currentVersion, undefined);
});

test('SR and ZZZ exact maintenance headings provide release evidence and matched current version', () => {
  const sr = context([post('4.6版本「月升之前，与兽共舞」版本更新说明',
    '<p>跃迁截止：2026/11/11 06:00。</p><p>■更新时间</p><p>2026/09/28 06:00开始，预计5个小时完成。</p><p>■补偿说明</p><p>领取截止2026/10/28。</p>')], 'v4.4', 'sr');
  assert.equal(sr.releases[0].date, '2026.09.28');
  assert.equal(sr.status, 'conflict');
  const zzz = context([post('3.2版本「她与她的隐秘往事」更新公告',
    '<p>【更新开始时间】</p><p>2026/09/09 06:00（UTC+8）</p><p>预计5个小时完成。</p><p>【补偿说明】</p><p>领取截止：2026/10/21 06:00。</p>')], 'v3.2', 'zzz');
  assert.equal(zzz.status, 'confirmed');
  assert.equal(zzz.currentVersion, 'v3.2');
  assert.equal(zzz.releases[0].date, '2026.09.09');
});

test('future final updates, previews, pre-downloads and activity announcements cannot become current', () => {
  const rows = [
    post('7.1版本更新说明', '<p>更新时间</p><p>2026/09/23 06:00开始。</p>'),
    post('7.2版本更新说明', '<p>更新时间</p><p>2026/10/21 06:00开始。</p>'),
    post('8.0版本更新说明', '<p>更新时间</p><p>2026/09/30 06:00开始。</p>', '2026-10-05T00:00:00Z'),
    post('9.0版本更新维护预告', '<p>更新维护信息</p><p>2026/09/30 06:00开始。</p>'),
    post('10.0版本预下载开启&更新通知', '<p>版本更新时间</p><p>2026/09/30 06:00开始。</p>'),
    post('11.0版本前瞻特别节目', '<p>更新时间</p><p>2026/09/30 06:00开始。</p>'),
    post('12.0版本活动更新公告', '<p>更新时间</p><p>2026/09/30 06:00开始。</p>'),
    post('生日贺礼更新说明', '<p>2026/09/30 06:00开始。</p>')
  ];
  const result = context(rows, 'v7.1');
  assert.equal(result.currentVersion, 'v7.1');
  assert.equal(result.releases.length, 1);
});

test('only title target counts; reward and publication dates never invent a release', () => {
  const result = context([
    post('9.1版本更新公告', '<p>欢迎来到9.1版本！</p><p>活动结束：2026/10/22。</p><p>补偿领取：2026/09/24。</p>', '2026-09-24T00:00:00Z'),
    post('角色活动公告', '<p>9.2版本更新时间</p><p>2026/10/01开始。</p>')
  ], 'v8.4', 'bh3');
  assert.equal(result.status, 'conflict');
  assert.equal(result.announcementVersion, 'v9.1');
  assert.deepEqual(result.releases, []);
  assert.equal(result.currentVersion, undefined);
  const matched = context([post('9.1版本更新公告', '<p>欢迎来到9.1版本</p>')], 'v9.1', 'bh3');
  assert.equal(matched.status, 'confirmed');
  assert.equal(matched.currentVersion, 'v9.1');
  assert.deepEqual(matched.releases, []);
});

test('invalid dates and next compensation headings do not supply maintenance dates', () => {
  for (const body of [
    '<p>更新时间</p><p>请稍候。</p><p>【补偿说明】</p><p>2026/09/23前领取。</p>',
    '<p>更新时间</p><p>补偿对象：2026/09/23前登录。</p>',
    '<p>更新时间</p><p>2026/02/30开始。</p>'
  ]) {
    assert.deepEqual(context([post('7.1版本更新说明', body)], 'v7.1').releases, []);
  }
});

test('explicit scheduling sentence supplies date, unrelated dated prose does not', () => {
  const result = context([post('7.1版本更新说明', '<p>制作组将于2026年9月23日 06:00进行版本更新维护，预计5小时。</p>')], 'v7.1');
  assert.equal(result.releases[0].date, '2026.09.23');
  assert.equal(result.status, 'confirmed');
  assert.deepEqual(context([post('7.1版本更新说明', '<p>奖励将于2026/09/23发放，请等待后续更新维护公告。</p>')], 'v7.1').releases, []);
});

test('missing launcher remains unconfirmed and contradictory release dates stay excluded', () => {
  const row = post('7.1版本更新说明', '<p>更新时间</p><p>2026/09/23开始。</p>');
  const result = buildVersionContext('ys', [row], undefined, { now });
  assert.equal(result.status, 'unconfirmed');
  assert.equal(result.currentVersion, undefined);
  assert.equal(result.releases.length, 1);
  const contradictory = context([row, post('7.1版本更新说明', '<p>更新时间</p><p>2026/09/24开始。</p>')], 'v7.1');
  assert.equal(contradictory.status, 'conflict');
  assert.deepEqual(contradictory.releases, []);
});

test('checkedDate follows China timezone', () => {
  const result = buildVersionContext('ys', [], undefined, { now: Date.parse('2026-10-03T18:00:00Z') });
  assert.equal(result.checkedDate, '2026.10.04');
  assert.equal(result.status, 'unconfirmed');
});
