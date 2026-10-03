import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalizeEventUrl, classifyCrawlerVersion, extractPostText } from './crawler-rules.js';
import { isNumericVersion, isValidVersion } from './version-classification.js';
import { fetchOfficialNews, NEWS_SOURCES } from './official-news.js';
import { buildVersionContext, fetchLauncherVersions } from './version-evidence.js';

const EVENTS_PATH = fileURLToPath(new URL('../src/events.json', import.meta.url));

export async function enrichVersions(options = {}) {
  const eventsPath = options.eventsPath ?? EVENTS_PATH;
  const events = structuredClone(options.events ?? JSON.parse(await fs.readFile(eventsPath, 'utf8')));
  if (!Array.isArray(events)) throw new Error('events.json must contain an array');
  const ids = options.ids ? new Set(options.ids) : null;
  const pending = events.filter(event => (!ids || ids.has(event.id))
    && (!isValidVersion(event.version) || event.version === '待确认'));
  const games = [...new Set(pending.map(event => event.gameKey).filter(key => NEWS_SOURCES[key]))];
  const logger = options.logger ?? console;
  const contexts = { ...(options.versionContexts ?? {}) };
  const postsByGame = new Map();
  const launcher = options.versionContexts || !games.length ? { games: {}, status: 'skipped' }
    : await (options.fetchLauncher ?? fetchLauncherVersions)(options.network ?? {});
  const sourceOutcomes = [];
  for (const gameKey of games) {
    const result = await (options.fetchNews ?? fetchOfficialNews)(gameKey, options.network?.fetchImpl ?? fetch,
      { ...options.network, pageSize: 100, maxPages: 3 });
    postsByGame.set(gameKey, result.posts);
    if (!contexts[gameKey]) contexts[gameKey] = buildVersionContext(gameKey, result.posts, launcher.games[gameKey],
      { now: options.now ?? Date.now() });
    const context = contexts[gameKey];
    sourceOutcomes.push({ gameKey, status: result.status, error: result.error,
      versionStatus: context.status, launcherVersion: context.launcherVersion,
      announcementVersion: context.announcementVersion });
    if (result.status === 'failed') logger.warn?.(`[${gameKey}] Version announcement source unavailable: ${result.error}`);
    if (context.status === 'conflict') logger.warn?.(`[${gameKey}] Live branch ${context.launcherVersion} and announcement ${context.announcementVersion} disagree; no current-version fallback.`);
  }
  const updatedEvents = [];
  for (const event of pending) {
    const posts = postsByGame.get(event.gameKey) ?? [];
    const canonicalUrl = canonicalizeEventUrl(event.url);
    const article = posts.find(item => event.sourceNewsId ? item.sourceNewsId === event.sourceNewsId
      : item.links.some(link => canonicalizeEventUrl(link) === canonicalUrl));
    const version = ['all', 'gen'].includes(event.gameKey) ? '通用' : classifyCrawlerVersion({
      gameKey: event.gameKey, title: event.title, sourcePostTitle: article?.post.subject ?? event.sourcePostTitle,
      description: event.description, body: article ? extractPostText(article.post) : '',
      date: event.startDate || event.date, eventType: event.type, eventUrl: event.url,
      versionContext: contexts[event.gameKey]
    });
    if (version === '待确认' || version === event.version) continue;
    updatedEvents.push({ id: event.id, title: event.title, before: event.version, after: version });
    event.version = version;
    if (isNumericVersion(version)) event.tags = [...new Set([...(event.tags ?? []), `${version}版本`])];
    logger.log?.(`[${event.id}] ${options.dryRun ? 'Proposed' : 'Updated'} version: ${version}`);
  }
  if (!options.dryRun && !options.events && options.write !== false && updatedEvents.length) {
    const temporary = `${eventsPath}.${process.pid}.${crypto.randomUUID()}.tmp`;
    try {
      await fs.writeFile(temporary, `${JSON.stringify(events, null, 2)}\n`, { flag: 'wx' });
      await fs.rename(temporary, eventsPath);
    } finally { await fs.rm(temporary, { force: true }); }
  }
  return { events, updatedEvents, summary: { selected: pending.length, updated: updatedEvents.length,
    launcherStatus: launcher.status, sourceOutcomes } };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = {};
    for (const argument of process.argv.slice(2)) {
      if (argument === '--dry-run') options.dryRun = true;
      else if (argument.startsWith('--ids=')) options.ids = argument.slice(6).split(',').filter(Boolean);
      else throw new Error(`Unknown option: ${argument}`);
    }
    const { summary } = await enrichVersions(options);
    console.log(`Version update summary: ${JSON.stringify(summary)}`);
  } catch (error) { console.error(`Version update failed: ${error.message}`); process.exitCode = 1; }
}
