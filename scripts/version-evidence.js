import { readPublicResource } from './event-covers.js';
import { extractPostText } from './crawler-rules.js';
import { extractExplicitVersion } from './version-classification.js';

const LAUNCHER_GAMES = Object.freeze({
  ys: { id: '1Z8W5NHUQb', biz: 'hk4e_cn' },
  sr: { id: '64kMb5iAWu', biz: 'hkrpg_cn' },
  zzz: { id: 'x6znKlJ0xK', biz: 'nap_cn' },
  bh3: { id: 'osvnlOc0S8', biz: 'bh3_cn' }
});

// The live branch tag names the current release. Download packages can lag
// behind it; required-client and pre-download tags describe different things.
export async function fetchLauncherVersions(options = {}) {
  try {
    const url = new URL('https://hyp-api.mihoyo.com/hyp/hyp-connect/api/getGameBranches');
    url.searchParams.set('launcher_id', 'jGHBHlcOq1');
    for (const game of Object.values(LAUNCHER_GAMES)) url.searchParams.append('game_ids[]', game.id);
    const timeout = Number(options.timeoutMs);
    const resource = await readPublicResource(url.href, {
      fetchImpl: options.fetchImpl, lookupImpl: options.lookupImpl,
      timeoutMs: Number.isFinite(timeout) ? Math.min(15000, Math.max(1, Math.trunc(timeout))) : 15000,
      maxBytes: 8 * 1024 * 1024
    });
    const json = JSON.parse(resource.body.toString('utf8'));
    if (json?.retcode !== 0 || !Array.isArray(json?.data?.game_branches)) {
      throw new Error('Launcher API returned invalid branch data');
    }
    const games = {};
    const errors = [];
    for (const [key, expected] of Object.entries(LAUNCHER_GAMES)) {
      const matches = json.data.game_branches.filter(item => item?.game?.id === expected.id);
      if (matches.length !== 1 || matches[0].game.biz !== expected.biz) {
        errors.push(`${key}: missing, ambiguous or mismatched game identity`);
        continue;
      }
      const branchVersion = matches[0].main?.tag;
      const match = typeof branchVersion === 'string' && /^([1-9]\d*)\.(\d+)\.(\d+)$/.exec(branchVersion);
      if (!match) {
        errors.push(`${key}: invalid main branch tag`);
        continue;
      }
      games[key] = { version: `v${Number(match[1])}.${Number(match[2])}`, branchVersion };
    }
    return { games, status: errors.length ? Object.keys(games).length ? 'partial' : 'failed' : 'ok',
      ...(errors.length ? { error: errors.join('; ') } : {}) };
  } catch (error) {
    return { games: {}, status: 'failed', error: error.message };
  }
}

const FULL_DATE = /(?<!\d)(\d{4})\s*(?:年|[./-])\s*(\d{1,2})\s*(?:月|[./-])\s*(\d{1,2})\s*日?(?!\d)/;

function normalizedDate(match) {
  if (!match) return undefined;
  const [, year, month, day] = match.map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return undefined;
  return `${year}.${String(month).padStart(2, '0')}.${String(day).padStart(2, '0')}`;
}

function updateDate(post) {
  const text = extractPostText(post);
  // Read only a maintenance section's immediate date, before another heading or
  // compensation prose. Other full dates in patch notes are usually event dates.
  const heading = /(?:^|\n)\s*[〓【■★◆#\s]*(?:版本更新时间|更新开始时间|更新维护信息|更新时间|维护时间)[〓】\s:：]*([^\n]*(?:\n[^\n]*){0,3})/g;
  for (const match of text.matchAll(heading)) {
    const nearby = match[1].slice(0, 160).split(/【|〓|■|补偿|奖励|领取|活动/)[0];
    const date = normalizedDate(nearby.match(FULL_DATE));
    if (date) return date;
  }
  // A sentence explicitly scheduling version maintenance is also sufficient.
  for (const sentence of text.split(/[。！!\n]/)) {
    if (!/将于/.test(sentence)) continue;
    const after = sentence.slice(sentence.indexOf('将于') + 2);
    const date = after.match(FULL_DATE);
    if (date && date.index <= 12 && /^.{0,50}进行(?:版本)?更新维护/.test(after.slice(date.index + date[0].length))) {
      const normalized = normalizedDate(date);
      if (normalized) return normalized;
    }
  }
  return undefined;
}

function finalUpdateVersion(subject) {
  const title = String(subject || '').trim();
  if (/预下载|预告|预览|前瞻/.test(title)
    || !/版本\s*(?:[「『《“][\s\S]*[」』》”]\s*)?(?:版本)?更新(?:说明|公告)$/.test(title)) return undefined;
  return extractExplicitVersion(title);
}

function chinaDate(time) {
  return new Date(time + 8 * 60 * 60 * 1000).toISOString().slice(0, 10).replaceAll('-', '.');
}

export function buildVersionContext(gameKey, posts, launcherGame, { now = Date.now() } = {}) {
  const checkedDate = chinaDate(Number(now));
  const finals = [];
  for (const item of posts || []) {
    const version = finalUpdateVersion(item?.post?.subject);
    if (!version) continue;
    const published = Number(item.post.created_at) * 1000;
    if (!Number.isFinite(published) || published > now) continue;
    const date = updateDate(item.post);
    if (date && date > checkedDate) continue;
    finals.push({ version, date, published, sourceUrl: item.sourceNewsUrl });
  }
  const byVersion = new Map();
  for (const entry of finals.filter(entry => entry.date)) {
    if (!byVersion.has(entry.version)) byVersion.set(entry.version, new Map());
    byVersion.get(entry.version).set(entry.date, entry);
  }
  const ambiguous = [...byVersion.values()].some(dates => dates.size > 1);
  const releases = [...byVersion.values()].filter(dates => dates.size === 1)
    .map(dates => [...dates.values()][0])
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(({ version, date, sourceUrl }) => ({ version, date, sourceUrl }));
  const latestDated = releases.at(-1);
  // BH3 patch notes often omit the maintenance date. Their publication permits
  // a version comparison, but never invents a release date or date fallback.
  const latestUndated = gameKey === 'bh3'
    ? finals.filter(entry => !entry.date).sort((a, b) => b.published - a.published)[0] : undefined;
  const datedPublished = latestDated ? finals.find(entry => entry.version === latestDated.version && entry.date === latestDated.date)?.published : undefined;
  const announcement = latestUndated && (!latestDated || latestUndated.published > datedPublished)
    ? latestUndated : latestDated;
  const launcherVersion = /^v[1-9]\d*\.\d+$/.test(launcherGame?.version) ? launcherGame.version : undefined;
  const announcementVersion = announcement?.version;
  const conflict = ambiguous || Boolean(launcherVersion && announcementVersion && launcherVersion !== announcementVersion);
  const confirmed = !conflict && Boolean(launcherVersion && launcherVersion === announcementVersion);
  return { releases, checkedDate, status: conflict ? 'conflict' : confirmed ? 'confirmed' : 'unconfirmed',
    ...(launcherVersion ? { launcherVersion } : {}),
    ...(announcementVersion ? { announcementVersion } : {}),
    ...(confirmed ? { currentVersion: launcherVersion } : {}) };
}
