import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDescriptionResource } from './crawler-rules.js';
import { fetchOfficialNewsDetail } from './official-news.js';
import {
  archiveEventCover, extractPostCoverUrl, hasValidLocalCover, normalizeCoverSourceUrl
} from './event-covers.js';

const DEFAULT_EVENTS_PATH = fileURLToPath(new URL('../src/events.json', import.meta.url));

export async function updateEventCovers(options = {}) {
  const eventsPath = options.eventsPath ?? DEFAULT_EVENTS_PATH;
  const original = options.events ?? JSON.parse(await fs.readFile(eventsPath, 'utf8'));
  if (!Array.isArray(original)) throw new Error('events.json must contain an array');
  const events = original.slice();
  const ids = options.ids ? new Set(typeof options.ids === 'string' ? options.ids.split(',') : options.ids) : null;
  const selected = events.map((event, index) => ({ event, index }))
    .filter(({ event }) => !ids || ids.has(event.id)).slice(0, options.limit ?? Infinity);
  const summary = { selected: selected.length, skipped: 0, archived: 0, proposed: 0, missing: 0,
    failed: 0, requests: 0, requestFailures: 0, newsRequests: 0, newsFailures: 0,
    allRequestsFailed: false, errors: [] };
  const maxAttempts = Math.min(3, Math.max(1, options.maxAttempts ?? 2));
  const logger = options.logger ?? console;
  const networkOptions = { fetchImpl: options.fetchImpl, lookupImpl: options.lookupImpl,
    timeoutMs: options.timeoutMs ?? 15000 };
  const archiveOptions = { ...networkOptions, outputDir: options.outputDir,
    maxBytes: options.maxBytes, force: options.force };
  const pending = [];
  for (const entry of selected) {
    if (isDescriptionResource(entry.event)
      || !options.force && await hasValidLocalCover(entry.event, archiveOptions)) summary.skipped++;
    else pending.push(entry);
  }

  // News IDs belong to each game's ContentAPI, separate from historical post IDs.
  const newsCache = new Map();
  function fetchNewsCover(event) {
    const newsId = String(event.sourceNewsId ?? '');
    if (!/^\d+$/.test(newsId) || !event.gameKey) return Promise.resolve({});
    const key = `${event.gameKey}:${newsId}`;
    if (!newsCache.has(key)) {
      const task = (async () => {
        summary.newsRequests++;
        summary.requests++;
        try {
          const item = await fetchOfficialNewsDetail(event.gameKey, newsId, {
            ...networkOptions, maxBytes: 4 * 1024 * 1024, maxAttempts,
            retryDelayMs: options.retryDelayMs ?? 250
          });
          return { cover: extractPostCoverUrl(item) };
        } catch (error) {
          summary.newsFailures++;
          summary.requestFailures++;
          return { error: error.message };
        }
      })();
      newsCache.set(key, task);
    }
    return newsCache.get(key);
  }

  async function processEvent({ event, index }) {
    const failures = [];
    const attempted = new Set();
    async function tryCover(sourceUrl) {
      if (!sourceUrl || attempted.has(sourceUrl)) return false;
      attempted.add(sourceUrl);
      if (options.dryRun) {
        summary.proposed++;
        logger.log?.(`[${event.id}] Found cover: ${sourceUrl}`);
        return true;
      }
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        summary.requests++;
        try {
          events[index] = await archiveEventCover(event, sourceUrl, archiveOptions);
          summary.archived++;
          logger.log?.(`[${event.id}] Archived ${events[index].coverUrl}`);
          return true;
        } catch (error) {
          summary.requestFailures++;
          if (attempt + 1 === maxAttempts) failures.push(`image: ${error.message}`);
          else await new Promise(resolve => setTimeout(resolve, options.retryDelayMs ?? 250));
        }
      }
      return false;
    }
    const knownSource = normalizeCoverSourceUrl(event.coverSourceUrl)
      ?? normalizeCoverSourceUrl(event.coverUrl);
    if (!options.force && await tryCover(knownSource)) return;
    // Only refresh the announcement after a missing/failed source, or an explicit force.
    const detail = await fetchNewsCover(event);
    if (detail.error) failures.push(`official news API: ${detail.error}`);
    if (await tryCover(detail.cover)) return;
    if (await tryCover(knownSource)) return;
    if (failures.length) {
      summary.failed++;
      summary.errors.push({ id: event.id, messages: failures });
      logger.warn?.(`[${event.id}] No cover archived: ${failures.join('; ')}`);
    } else {
      summary.missing++;
      logger.log?.(`[${event.id}] No announcement image available; retaining current cover and screenshot.`);
    }
  }

  let cursor = 0;
  const concurrency = Math.min(4, Math.max(1, options.concurrency ?? 3));
  await Promise.all(Array.from({ length: Math.min(concurrency, pending.length) }, async () => {
    while (cursor < pending.length) await processEvent(pending[cursor++]);
  }));
  summary.allRequestsFailed = summary.requests > 0 && summary.requestFailures === summary.requests;
  if (!options.dryRun && summary.archived > 0 && options.write !== false && !options.events) {
    const temporary = `${eventsPath}.${process.pid}.${crypto.randomUUID()}.tmp`;
    try {
      await fs.writeFile(temporary, `${JSON.stringify(events, null, 2)}\n`, { flag: 'wx' });
      await fs.rename(temporary, eventsPath);
    } finally { await fs.rm(temporary, { force: true }); }
  }
  return { events, summary };
}

function parseArgs(args) {
  const options = {};
  for (const arg of args) {
    if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--force') options.force = true;
    else if (arg.startsWith('--ids=')) options.ids = arg.slice(6).split(',').filter(Boolean);
    else if (arg.startsWith('--limit=')) {
      options.limit = Number(arg.slice(8));
      if (!Number.isInteger(options.limit) || options.limit < 0) throw new Error('--limit must be a nonnegative integer');
    } else throw new Error(`Unknown option: ${arg}`);
  }
  return options;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseArgs(process.argv.slice(2));
    const { summary } = await updateEventCovers(options);
    console.log(`Cover summary${options.dryRun ? ' (dry run)' : ''}: ${JSON.stringify(summary)}`);
    if (summary.allRequestsFailed) console.warn('All cover requests failed; existing covers and screenshots were retained.');
  } catch (error) {
    console.error(`Cover update failed: ${error.message}`);
    process.exitCode = 1;
  }
}
