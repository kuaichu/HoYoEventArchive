import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchActivityTime } from './activity-time-sources.js';
import { parseActivityTime } from './activity-time-parser.js';
import { canonicalizeEventUrl, extractPostText, getAnnouncementDate, isPermanentResourceUrl } from './crawler-rules.js';
import { fetchOfficialNews, fetchOfficialNewsDetail, NEWS_SOURCES } from './official-news.js';
import { buildVersionContext } from './version-evidence.js';
import { extractExplicitVersion } from './version-classification.js';
import { normalizeEventTimestamp, timestampDate } from '../src/event-time.js';
import { currentShanghaiDate, resolveEventStatus, validateEventCollection } from '../src/event-domain.js';

const EVENTS_PATH = fileURLToPath(new URL('../src/events.json', import.meta.url));
const TIME_FIELDS = ['startAt', 'endAt', 'startDate', 'endDate', 'timeStages', 'timeSource', 'timeSourceUrl'];

async function writeJson(file, value) {
  const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
    await fs.rename(temporary, file);
  } finally { await fs.rm(temporary, { force: true }); }
}

function hasRange(result) {
  return Boolean((result.startAt || result.startDate) && (result.endAt || result.endDate));
}

function permanent(event) {
  return isPermanentResourceUrl(event.url) || /\/(?:agreement|developer|cocreation)(?:\/|$)|\/mihoyo-zzz-game-record\/|\/user-change-server\/|\/around-gift-[^/]+\/|\/wechat-landing-[^/]+\/|\/gt-aio\/chrysos-heirs\//.test(new URL(event.url).pathname);
}

function matchAnnouncement(event, posts) {
  if (event.sourceNewsId) return posts.find(post => post.sourceNewsId === event.sourceNewsId);
  const url = canonicalizeEventUrl(event.url);
  const titleKey = value => String(value || '').normalize('NFKC').replace(/^(?:\s*【[^】]*】)+/, '').replace(/[^\p{Letter}\p{Number}]/gu, '');
  const titles = new Set([titleKey(event.sourcePostTitle), titleKey(event.title)].filter(Boolean));
  const byUrl = posts.filter(post => post.links.some(link => canonicalizeEventUrl(link) === url));
  const matching = byUrl.length ? byUrl : posts.filter(post => titles.has(titleKey(post.post.subject))
    || [...post.post.subject.matchAll(/[「《“]([^」》”]+)[」》”]/g)]
      .some(match => titleKey(match[1]).length >= 6 && titles.has(titleKey(match[1]))));
  const date = event.date.replaceAll('.', '-');
  const distance = post => Math.abs(Date.parse(`${getAnnouncementDate(post).replaceAll('.', '-')}T00:00:00+08:00`) - Date.parse(`${date}T00:00:00+08:00`));
  matching.sort((a, b) => distance(a) - distance(b));
  // A reused activity landing page must not inherit a different year's campaign.
  return matching.find(post => distance(post) <= 14 * 86400000);
}

function versionPeriodFallback(event, evidence, posts) {
  const version = evidence.versionPeriod || evidence.versionStart;
  if (!/^v\d+\.\d+$/.test(version ?? '') || event.version !== version) return null;
  const notices = posts.filter(post => !/预告|前瞻|预下载/.test(post.post.subject)
    && /版本.*更新(?:公告|说明)$/.test(post.post.subject) && extractExplicitVersion(post.post.subject) === version);
  for (const notice of notices) {
    const text = extractPostText(notice.post);
    const rangeLine = text.split('\n').find(line => /版本的持续时间为/.test(line));
    if (evidence.versionPeriod && rangeLine) {
      const parsed = parseActivityTime(`活动时间：${rangeLine.replace(/^.*版本的持续时间为\s*/, '')}`,
        { announcementDate: getAnnouncementDate(notice) });
      if (hasRange(parsed)) return { ...parsed, timeSource: 'announcement', timeSourceUrl: notice.sourceNewsUrl,
        method: 'official-version-period', reason: 'Activity rules explicitly name this version; dates come from its official duration notice' };
    }
  }
  const release = buildVersionContext(event.gameKey, posts, undefined).releases.find(item => item.version === version);
  return release ? { startDate: release.date, timeSource: 'announcement', timeSourceUrl: release.sourceUrl,
    method: 'official-version-start', reason: 'Rules say after this version update; its maintenance date establishes only the day, not the reopening time' } : null;
}

function mergeEvidence(primary, fallback) {
  if (!fallback) return primary;
  const merged = { ...primary };
  for (const field of ['versionPeriod', 'versionStart']) {
    if (!merged[field] && fallback[field]) {
      merged[field] = fallback[field];
      merged.versionRuleSourceUrl = fallback.timeSourceUrl;
    }
  }
  let used = false;
  for (const side of ['start', 'end']) {
    const at = `${side}At`, date = `${side}Date`;
    const primaryDate = timestampDate(primary[at]) || primary[date];
    const fallbackDate = timestampDate(fallback[at]) || fallback[date];
    if (!primaryDate && fallbackDate) {
      if (fallback[at]) merged[at] = fallback[at];
      merged[date] = fallbackDate;
      used = true;
    } else if (!primary[at] && primaryDate && fallback[at] && primaryDate === fallbackDate) {
      merged[at] = fallback[at];
      used = true;
    }
  }
  if (used && !primary.startAt && !primary.endAt && !primary.startDate && !primary.endDate) {
    if (primary.timeSourceUrl && primary.timeSourceUrl !== fallback.timeSourceUrl) merged.activitySourceUrl = primary.timeSourceUrl;
    merged.timeSource = fallback.timeSource;
    merged.timeSourceUrl = fallback.timeSourceUrl;
    merged.method = fallback.method;
  }
  if (used) merged.fallbackSourceUrl = fallback.timeSourceUrl;
  merged.status = hasRange(merged) ? 'ok' : (merged.startAt || merged.endAt || merged.startDate || merged.endDate || merged.timeStages?.length) ? 'partial' : primary.status;
  return merged;
}

export function applyEventTime(event, evidence) {
  if (event.timeSource === 'manual') return { ...event };
  const updated = { ...event };
  let participationChanged = false;
  for (const side of ['start', 'end']) {
    const at = `${side}At`, date = `${side}Date`;
    const value = normalizeEventTimestamp(evidence[at]);
    const dateValue = timestampDate(value) || evidence[date];
    if (!dateValue) continue;
    // An announcement never downgrades an already verified timestamp.
    if (event[at] && evidence.timeSource === 'announcement' && event.timeSource !== 'announcement') continue;
    if (value) updated[at] = value;
    else if (updated[at] && timestampDate(updated[at]) !== dateValue) delete updated[at];
    updated[date] = dateValue;
    participationChanged = true;
  }
  if (evidence.timeStages?.length) {
    const stages = [...evidence.timeStages].sort((a, b) => Date.parse(a.startAt || a.endAt) - Date.parse(b.startAt || b.endAt));
    updated.timeStages = stages;
  }
  if ((participationChanged || evidence.timeStages?.length) && evidence.timeSource && evidence.timeSourceUrl) {
    updated.timeSource = evidence.timeSource;
    updated.timeSourceUrl = evidence.timeSourceUrl;
  }
  return updated;
}

export async function updateEventTimes(options = {}) {
  const eventsPath = options.eventsPath ?? EVENTS_PATH;
  const original = options.events ?? JSON.parse(await fs.readFile(eventsPath, 'utf8'));
  const originalIssues = validateEventCollection(original);
  if (originalIssues.length) throw new Error(`Invalid event data: ${originalIssues.join('; ')}`);
  const events = structuredClone(original);
  const ids = options.ids ? new Set(typeof options.ids === 'string' ? options.ids.split(',').filter(Boolean) : options.ids) : null;
  const now = options.now ? new Date(options.now) : new Date();
  const today = currentShanghaiDate(now);
  const cache = options.cache ?? new Map();
  const logger = options.logger ?? console;
  const network = { ...options.network, cache, timeoutMs: options.network?.timeoutMs ?? 10000 };
  const news = new Map();
  const outcomes = new Map();
  const selected = events.map((event, index) => ({ event, index })).filter(({ event }) => (!ids || ids.has(event.id))
    && (options.all || !event.timeSource || !event.startDate || !event.endDate || event.endDate >= today));
  const getNews = gameKey => {
    if (!news.has(gameKey)) news.set(gameKey, (async () => {
      try {
        const result = await (options.fetchNews ?? fetchOfficialNews)(gameKey, network.fetchImpl ?? fetch,
          { ...network, pageSize: 100, maxPages: options.newsPages ?? 10 });
        outcomes.set(gameKey, { gameKey, status: result.status, error: result.error ?? null, articles: result.posts.length });
        return result.posts;
      } catch (error) {
        outcomes.set(gameKey, { gameKey, status: 'failed', error: error.message, articles: 0 });
        return [];
      }
    })());
    return news.get(gameKey);
  };
  const records = new Array(selected.length);
  let cursor = 0;
  const worker = async () => {
    while (cursor < selected.length) {
      const slot = cursor++;
      const { event, index } = selected[slot];
      let evidence;
      let fallback;
      try {
        if (event.timeSource === 'manual') evidence = { status: 'preserved', method: 'manual', reason: 'Preserved manually verified times' };
        else if (permanent(event)) evidence = { status: 'permanent', method: 'resource', reason: 'Permanent service; no campaign deadline inferred' };
        else {
          try { evidence = await (options.fetchTime ?? fetchActivityTime)(event, network); }
          catch (error) { evidence = { status: 'failed', method: 'activity-page', error: error.message }; }
        }
        if (!hasRange(evidence) && !['manual', 'resource'].includes(evidence.method) && NEWS_SOURCES[event.gameKey]) {
          let article;
          if (event.sourceNewsId) {
            try { article = await (options.fetchDetail ?? fetchOfficialNewsDetail)(event.gameKey, event.sourceNewsId, network); }
            catch { /* A list lookup can still find this source when detail access fails. */ }
          }
          article ??= matchAnnouncement(event, await getNews(event.gameKey));
          if (article) {
            const parsed = parseActivityTime(extractPostText(article.post), { announcementDate: getAnnouncementDate(article) });
            fallback = { ...parsed, timeSource: 'announcement', timeSourceUrl: article.sourceNewsUrl, method: 'official-announcement' };
            evidence = mergeEvidence(evidence, fallback);
          }
          if (!hasRange(evidence) && (evidence.versionPeriod || evidence.versionStart)) {
            const referencedVersion = evidence.versionPeriod || evidence.versionStart;
            const versionFallback = versionPeriodFallback(event, evidence, await getNews(event.gameKey));
            if (versionFallback) {
              fallback = versionFallback;
              evidence = mergeEvidence(evidence, versionFallback);
            } else if (/^v\d+\.\d+$/.test(event.version) && referencedVersion !== event.version) {
              evidence = { ...evidence, status: 'conflict', reason: `Activity rules name ${referencedVersion}, but the archived activity belongs to ${event.version}; no version-period dates inferred` };
            }
          }
        }
        const next = applyEventTime(event, evidence);
        next.status = resolveEventStatus(next, today, now);
        const issues = validateEventCollection([next]);
        if (issues.length) throw new Error(`Time evidence rejected: ${issues.join('; ')}`);
        const changes = [...TIME_FIELDS, 'status'].filter(field => JSON.stringify(event[field]) !== JSON.stringify(next[field]));
        events[index] = next;
        records[slot] = { id: event.id, title: event.title, url: event.url, ...evidence,
          ...(fallback ? { announcementFallback: fallback } : {}), changedFields: changes,
          stored: Object.fromEntries(TIME_FIELDS.filter(field => next[field] !== undefined).map(field => [field, next[field]])),
          remaining: ['start', 'end'].filter(side => !next[`${side}At`] && !next[`${side}Date`]) };
      } catch (error) {
        records[slot] = { id: event.id, title: event.title, url: event.url, status: 'failed', error: error.message, changedFields: [],
          stored: Object.fromEntries(TIME_FIELDS.filter(field => event[field] !== undefined).map(field => [field, event[field]])),
          remaining: ['start', 'end'].filter(side => !event[`${side}At`] && !event[`${side}Date`]) };
      }
      logger.log?.(`[${slot + 1}/${selected.length}] ${event.id}: ${records[slot].status} (${records[slot].method ?? 'no source'})`);
    }
  };
  await Promise.all(Array.from({ length: Math.min(options.concurrency ?? 3, selected.length) }, worker));
  const summary = { selected: selected.length, updated: records.filter(record => record.changedFields.length).length,
    outcomes: Object.fromEntries([...new Set(records.map(record => record.status))].map(status => [status, records.filter(record => record.status === status).length])),
    coverage: { total: events.length, startDate: events.filter(event => event.startDate).length, endDate: events.filter(event => event.endDate).length,
      startAt: events.filter(event => event.startAt).length, endAt: events.filter(event => event.endAt).length,
      dateRanges: events.filter(event => event.startDate && event.endDate).length,
      preciseRanges: events.filter(event => event.startAt && event.endAt).length } };
  const report = { checkedAt: now.toISOString(), timezone: 'Asia/Shanghai', summary, newsSources: [...outcomes.values()], records };
  if (!options.dryRun && !options.events && options.write !== false && summary.updated) await writeJson(eventsPath, events);
  if (options.reportPath) await writeJson(path.resolve(options.reportPath), report);
  return { events, summary, report };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = {};
    for (const argument of process.argv.slice(2)) {
      if (argument === '--dry-run') options.dryRun = true;
      else if (argument === '--all') options.all = true;
      else if (argument.startsWith('--ids=')) options.ids = argument.slice(6);
      else if (argument.startsWith('--report=')) options.reportPath = argument.slice(9);
      else if (argument.startsWith('--news-pages=')) {
        options.newsPages = Number(argument.slice(13));
        if (!Number.isInteger(options.newsPages) || options.newsPages < 1 || options.newsPages > 50) throw new Error('--news-pages must be between 1 and 50');
      } else throw new Error(`Unknown option: ${argument}`);
    }
    const { summary } = await updateEventTimes(options);
    console.log(`Activity time summary: ${JSON.stringify(summary)}`);
  } catch (error) { console.error(`Activity time update failed: ${error.message}`); process.exitCode = 1; }
}
