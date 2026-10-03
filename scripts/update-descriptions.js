import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { enrichEventDescription, extractAnnouncementMetadata, extractPostText, isDescriptionResource } from './crawler-rules.js';
import { fetchOfficialNewsDetail } from './official-news.js';

const EVENTS_PATH = fileURLToPath(new URL('../src/events.json', import.meta.url));
const PLACEHOLDERS = new Set(['', '提瓦特/米游社官方网页活动。', '米游社官方网页活动。', '官方网页活动，详情见来源公告。']);

export async function updateEventDescriptions(options = {}) {
  const eventsPath = options.eventsPath || EVENTS_PATH;
  const original = options.events ?? JSON.parse(await fs.readFile(eventsPath, 'utf8'));
  if (!Array.isArray(original)) throw new Error('events.json must contain an array');
  const events = original.slice();
  const ids = options.ids ? new Set(typeof options.ids === 'string' ? options.ids.split(',') : options.ids) : null;
  const selected = events.map((event, index) => ({ event, index }))
    .filter(({ event }) => !ids || ids.has(event.id)).slice(0, options.limit ?? Infinity);
  const summary = { selected: selected.length, updated: 0, manualSkipped: 0, preserved: 0,
    missing: 0, failed: 0, requests: 0, newsRequests: 0 };
  const logger = options.logger ?? console;
  const network = { fetchImpl: options.fetchImpl, lookupImpl: options.lookupImpl, timeoutMs: options.timeoutMs ?? 15000 };
  const news = new Map();
  const pending = selected.filter(({ event }) => {
    if (event.descriptionSource === 'manual') { summary.manualSkipped++; return false; }
    if (isDescriptionResource(event)) { summary.preserved++; return false; }
    const description = String(event.description || '').trim();
    const refresh = options.refresh || Boolean(ids);
    if (!refresh && event.descriptionSource === 'announcement') {
      summary.preserved++;
      return false;
    }
    if (!refresh && !event.descriptionSource && !PLACEHOLDERS.has(description)
      && extractAnnouncementMetadata(description, { title: event.title, sourcePostTitle: event.sourcePostTitle }).description) {
      summary.preserved++;
      return false;
    }
    return true;
  });

  for (const { event, index } of pending) {
    const newsId = String(event.sourceNewsId || '');
    const newsKey = `${event.gameKey}:${newsId}`;
    let failed = false;
    if (/^\d+$/.test(newsId) && event.gameKey && !news.has(newsKey)) {
      summary.newsRequests++;
      summary.requests++;
      try {
        const item = await fetchOfficialNewsDetail(event.gameKey, newsId, {
          ...network, maxBytes: 4 * 1024 * 1024, maxAttempts: options.maxAttempts ?? 2
        });
        news.set(newsKey, { post: item.post });
      } catch (error) {
        news.set(newsKey, { error });
        logger.warn?.(`[${event.id}] Description source unavailable: ${error.message}`);
      }
    }

    const cached = news.get(newsKey);
    failed = Boolean(cached?.error);
    const post = cached?.post;
    const update = post ? enrichEventDescription(event, extractPostText(post))
      : { event, changed: false };
    if (update.changed) {
      events[index] = update.event;
      summary.updated++;
      logger.log?.(`[${event.id}] ${options.dryRun ? 'Proposed' : 'Updated'} description: ${update.event.description}`);
    } else if (failed) summary.failed++;
    else if (post || !PLACEHOLDERS.has(String(event.description || '').trim())) summary.preserved++;
    else summary.missing++;
  }
  if (!options.dryRun && summary.updated && options.write !== false && !options.events) {
    const temporary = `${eventsPath}.${process.pid}.${crypto.randomUUID()}.tmp`;
    try {
      await fs.writeFile(temporary, `${JSON.stringify(events, null, 2)}\n`, { flag: 'wx' });
      await fs.rename(temporary, eventsPath);
    } finally { await fs.rm(temporary, { force: true }); }
  }
  return { events, summary };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = {};
    for (const argument of process.argv.slice(2)) {
      if (argument === '--dry-run') options.dryRun = true;
      else if (argument === '--refresh') options.refresh = true;
      else if (argument.startsWith('--ids=')) options.ids = argument.slice(6).split(',').filter(Boolean);
      else if (argument.startsWith('--limit=')) {
        options.limit = Number(argument.slice(8));
        if (!Number.isInteger(options.limit) || options.limit < 0) throw new Error('--limit must be a nonnegative integer');
      } else throw new Error(`Unknown option: ${argument}`);
    }
    const { summary } = await updateEventDescriptions(options);
    console.log(`Description summary${options.dryRun ? ' (dry run)' : ''}: ${JSON.stringify(summary)}`);
  } catch (error) { console.error(`Description update failed: ${error.message}`); process.exitCode = 1; }
}
