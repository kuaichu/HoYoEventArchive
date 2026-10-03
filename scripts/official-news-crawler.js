import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchOfficialNews, NEWS_SOURCES } from './official-news.js';
import {
  canonicalizeEventUrl, classifyCrawlerVersion, classifyEventType,
  enrichEventDescription, enrichEventWithMetadata, extractAnnouncementMetadata,
  extractPostText, getAnnouncementDate, isPermanentResourceUrl,
  resolveStoredEventUrl, selectEventCandidateUrls, selectEventTitle
} from './crawler-rules.js';
import { extractPostCoverUrl } from './event-covers.js';
import { isNumericVersion, isValidVersion } from './version-classification.js';
import { buildVersionContext, fetchLauncherVersions } from './version-evidence.js';

const EVENTS_PATH = fileURLToPath(new URL('../src/events.json', import.meta.url));
const GAME_NAMES = { ys: '原神', sr: '星穹铁道', zzz: '绝区零', bh3: '崩坏3' };

export function shouldFailCrawler(sourceOutcomes) {
  return sourceOutcomes.length === 0 || sourceOutcomes.every(result => result.status === 'failed');
}

export function classifySourceProcessingOutcome(fetchStatus, processedPostCount, parseErrorCount) {
  if (fetchStatus === 'failed') return 'failed';
  if (parseErrorCount > 0 && processedPostCount === 0) return 'failed';
  if (fetchStatus === 'partial' || parseErrorCount > 0) return 'partial';
  return 'ok';
}

export async function runCrawler(options = {}) {
  const eventsPath = options.eventsPath ?? EVENTS_PATH;
  const events = structuredClone(options.events ?? JSON.parse(await fs.readFile(eventsPath, 'utf8')));
  if (!Array.isArray(events)) throw new Error('events.json must contain an array');
  const logger = options.logger ?? console;
  const games = options.games ?? Object.keys(NEWS_SOURCES);
  const fetchNews = options.fetchNews ?? fetchOfficialNews;
  const enrichIds = new Set(String(options.enrichIds ?? process.env.OFFICIAL_NEWS_ENRICH_EXISTING_IDS ?? '')
    .split(',').map(value => value.trim()).filter(Boolean));
  const eventsByUrl = new Map(events.map(event => [canonicalizeEventUrl(event.url), event]));
  const maxNums = Object.fromEntries(Object.keys(GAME_NAMES).map(gameKey => [gameKey,
    Math.max(0, ...events.filter(event => event.gameKey === gameKey)
      .map(event => Number(event.id.match(new RegExp(`^${gameKey}-(\\d+)$`))?.[1]) || 0))
  ]));
  const sourceOutcomes = [];
  const updatedIds = new Set();
  let newEventsCount = 0;
  logger.log?.(`Starting official news API crawler${options.dryRun ? ' (dry run)' : ''}.`);
  const launcherResult = options.versionContexts ? { games: {}, status: 'injected' }
    : await (options.fetchLauncher ?? fetchLauncherVersions)({ ...options.network,
      fetchImpl: options.fetchImpl ?? fetch });
  if (launcherResult.status === 'failed') logger.warn?.(`Launcher version reference unavailable: ${launcherResult.error}`);

  for (const gameKey of games) {
    if (!NEWS_SOURCES[gameKey]) throw new Error(`Unknown game: ${gameKey}`);
    const result = await fetchNews(gameKey, options.fetchImpl ?? fetch, {
      ...options.network, pageSize: options.pageSize ?? 20, maxPages: options.maxPages ?? 5
    });
    const outcome = { gameKey, status: result.status, error: result.error, posts: result.posts.length };
    sourceOutcomes.push(outcome);
    if (result.status === 'failed') { logger.warn?.(`[${gameKey}] Source unavailable: ${result.error}`); continue; }
    const versionContext = options.versionContexts?.[gameKey]
      ?? buildVersionContext(gameKey, result.posts, launcherResult.games[gameKey], { now: options.now ?? Date.now() });
    outcome.versionReference = { status: versionContext.status, launcherVersion: versionContext.launcherVersion,
      announcementVersion: versionContext.announcementVersion, currentVersion: versionContext.currentVersion };
    if (versionContext.status === 'conflict') {
      logger.warn?.(`[${gameKey}] Launcher ${versionContext.launcherVersion} differs from update announcement ${versionContext.announcementVersion}; no current-version date fallback.`);
    }
    let processed = 0;
    let errors = 0;
    for (const item of result.posts) {
      try {
        if (!/^\d+$/.test(item.sourceNewsId ?? '') || !item.sourceNewsUrl || !item.post?.subject) {
          throw new Error('Official announcement is missing source ID, URL or title');
        }
        const subject = item.post.subject;
        const postText = extractPostText(item.post);
        const metadata = extractAnnouncementMetadata(postText, { title: subject });
        const coverSourceUrl = extractPostCoverUrl(item);
        const date = getAnnouncementDate(item);
        if (!date) throw new Error('Official announcement has no reliable publication date');
        processed++;
        for (const rawUrl of selectEventCandidateUrls(item.links)) {
          let url;
          try { url = await resolveStoredEventUrl(rawUrl, options.fetchImpl ?? fetch); }
          catch (error) { logger.warn?.(`Could not resolve activity link: ${error.message}`); continue; }
          if (!url || isPermanentResourceUrl(url)) continue;
          const canonicalUrl = canonicalizeEventUrl(url);
          const existing = eventsByUrl.get(canonicalUrl);
          if (existing) {
            // News pages can link to other games and to a reused campaign landing page.
            // Only enrich the matching game's first/same announcement; keep curated fields.
            if (existing.gameKey !== gameKey || existing.sourceNewsId
              && String(existing.sourceNewsId) !== item.sourceNewsId) continue;
            let changed = false;
            for (const [field, value] of Object.entries({ sourceNewsId: item.sourceNewsId,
              sourceNewsUrl: item.sourceNewsUrl, coverSourceUrl })) {
              if (value && !existing[field]) { existing[field] = value; changed = true; }
            }
            const description = enrichEventDescription(existing, postText);
            if (description.changed) { Object.assign(existing, description.event); changed = true; }
            if (!isValidVersion(existing.version) || existing.version === '待确认') {
              const version = classifyCrawlerVersion({ gameKey, title: existing.title, sourcePostTitle: subject,
                description: existing.description, body: postText, date: existing.startDate || metadata.startDate || existing.date,
                eventType: existing.type, eventUrl: existing.url, versionContext });
              if (version !== '待确认') {
                existing.version = version;
                if (isNumericVersion(version)) existing.tags = [...new Set([...(existing.tags ?? []), `${version}版本`])];
                changed = true;
              }
            }
            if (enrichIds.has(existing.id)) {
              const enriched = enrichEventWithMetadata(existing, metadata);
              if (enriched.changed) { Object.assign(existing, enriched.event); changed = true; }
            }
            if (changed) updatedIds.add(existing.id);
            continue;
          }
          const title = selectEventTitle(subject, '');
          const type = classifyEventType(`${postText} ${title}`, { title: subject });
          const version = classifyCrawlerVersion({ gameKey, title, sourcePostTitle: subject,
            description: metadata.description ?? '', body: postText, date: metadata.startDate || date,
            eventType: type, eventUrl: url, versionContext });
          if (type === '版本前瞻' && !isNumericVersion(version)) {
            logger.warn?.(`Skipping version preview without a confirmed version: ${title}`);
            continue;
          }
          const tags = [];
          if (type !== '其他活动') tags.push(type);
          if (isNumericVersion(version)) tags.push(`${version}版本`);
          else if (['公测前', '通用'].includes(version)) tags.push(version);
          if (/音乐平台活动/.test(postText)) tags.push('音乐平台');
          if (/原石|星琼|菲林/.test(postText)) tags.push('游戏内奖励');
          const event = {
            id: `${gameKey}-${++maxNums[gameKey]}`, title, url, game: GAME_NAMES[gameKey], gameKey,
            type, status: '可访问', date, dateType: 'announcement',
            sourceNewsId: item.sourceNewsId, sourceNewsUrl: item.sourceNewsUrl,
            ...(coverSourceUrl ? { coverSourceUrl } : {}),
            tags: tags.length ? tags : ['网页活动'], version,
            description: metadata.description || '官方网页活动，详情见来源公告。',
            ...(metadata.description ? { descriptionSource: 'announcement' } : {}),
            ...(metadata.startDate ? { startDate: metadata.startDate } : {}),
            ...(metadata.endDate ? { endDate: metadata.endDate } : {}),
            ...(metadata.reward ? { reward: metadata.reward } : {})
          };
          events.push(event);
          eventsByUrl.set(canonicalUrl, event);
          newEventsCount++;
          logger.log?.(`[${event.id}] ${options.dryRun ? 'Proposed' : 'Added'}: ${title}`);
        }
      } catch (error) { errors++; logger.warn?.(`[${gameKey}] Skipping announcement: ${error.message}`); }
    }
    outcome.status = classifySourceProcessingOutcome(result.status, processed, errors);
    if (errors) outcome.error = `${errors} malformed announcement(s)`;
    logger.log?.(`[${gameKey}] ${outcome.posts} announcements; source ${outcome.status}.`);
  }
  if (shouldFailCrawler(sourceOutcomes)) {
    throw new Error('All configured official news APIs failed. Existing events were not written.');
  }
  const updatedEventsCount = updatedIds.size;
  if (!options.dryRun && !options.events && options.write !== false && (newEventsCount || updatedEventsCount)) {
    const temporary = `${eventsPath}.${process.pid}.${crypto.randomUUID()}.tmp`;
    try {
      await fs.writeFile(temporary, `${JSON.stringify(events, null, 2)}\n`, { flag: 'wx' });
      await fs.rename(temporary, eventsPath);
    } finally { await fs.rm(temporary, { force: true }); }
  }
  return { events, newEventsCount, updatedEventsCount, sourceOutcomes };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = {};
    for (const argument of process.argv.slice(2)) {
      if (argument === '--dry-run') options.dryRun = true;
      else if (argument.startsWith('--games=')) options.games = argument.slice(8).split(',').filter(Boolean);
      else if (argument.startsWith('--enrich-ids=')) options.enrichIds = argument.slice(13);
      else if (/^--(?:max-pages|page-size)=/.test(argument)) {
        const [name, raw] = argument.split('=');
        const value = Number(raw);
        if (!Number.isInteger(value) || value < 1 || value > (name === '--max-pages' ? 50 : 100)) {
          throw new Error(`Invalid ${name}`);
        }
        options[name === '--max-pages' ? 'maxPages' : 'pageSize'] = value;
      } else throw new Error(`Unknown option: ${argument}`);
    }
    const { newEventsCount, updatedEventsCount, sourceOutcomes } = await runCrawler(options);
    console.log(JSON.stringify({ dryRun: Boolean(options.dryRun), newEventsCount, updatedEventsCount, sourceOutcomes }));
  } catch (error) { console.error(`Official news crawl failed: ${error.message}`); process.exitCode = 1; }
}
