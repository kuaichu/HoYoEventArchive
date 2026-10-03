import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDescriptionResource } from './crawler-rules.js';
import {
  archiveEventCover, extractPostCoverUrl, extractShareCoverUrl,
  hasValidLocalCover, normalizeCoverSourceUrl, readPublicResource
} from './event-covers.js';

const DEFAULT_EVENTS_PATH = fileURLToPath(new URL('../src/events.json', import.meta.url));
const GAME_GIDS = { ys: 2, sr: 6, zzz: 8, bh3: 1 };

export async function updateEventCovers(options = {}) {
  const eventsPath = options.eventsPath ?? DEFAULT_EVENTS_PATH;
  const original = options.events ?? JSON.parse(await fs.readFile(eventsPath, 'utf8'));
  if (!Array.isArray(original)) throw new Error('events.json must contain an array');
  const events = original.slice();
  const ids = options.ids ? new Set(typeof options.ids === 'string' ? options.ids.split(',') : options.ids) : null;
  const limit = options.limit ?? Infinity;
  const selected = events.map((event, index) => ({ event, index }))
    .filter(({ event }) => !ids || ids.has(event.id)).slice(0, limit);
  const summary = { selected: selected.length, skipped: 0, archived: 0, proposed: 0, missing: 0,
    failed: 0, requests: 0, requestFailures: 0, bulkPages: 0, bulkFailures: 0,
    detailRequests: 0, detailBlocked: false, allRequestsFailed: false, errors: [] };
  const maxAttempts = Math.min(3, Math.max(1, options.maxAttempts ?? 2));
  const logger = options.logger ?? console;
  const networkOptions = { fetchImpl: options.fetchImpl, lookupImpl: options.lookupImpl,
    timeoutMs: options.timeoutMs ?? 15000 };

  async function request(url, maxBytes, retryDelayMs = options.retryDelayMs ?? 250) {
    let lastError;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      summary.requests++;
      try { return await readPublicResource(url, { ...networkOptions, maxBytes }); }
      catch (error) {
        summary.requestFailures++;
        lastError = error;
        if (attempt + 1 < maxAttempts) {
          await new Promise(resolve => setTimeout(resolve, retryDelayMs));
        }
      }
    }
    throw lastError;
  }

  function blockDetails() {
    if (!summary.detailBlocked) logger.warn?.('Official API returned retcode=1034; stopping detail requests for this run.');
    summary.detailBlocked = true;
  }

  async function requestApi(url, retryDelayMs) {
    const { body } = await request(url, 4 * 1024 * 1024, retryDelayMs);
    try {
      const json = JSON.parse(body.toString('utf8'));
      if (json.retcode === 1034) blockDetails();
      if (json.retcode !== 0 || !json.data) throw new Error(`Official API retcode=${json.retcode}`);
      return json.data;
    } catch (error) { summary.requestFailures++; throw error; }
  }

  const pending = [];
  const archiveOptions = { ...networkOptions, outputDir: options.outputDir,
    maxBytes: options.maxBytes, force: options.force };
  for (const entry of selected) {
    // A linked agreement is not the announcement's activity. Do not give it
    // that activity's artwork during a later automatic backfill.
    if (isDescriptionResource(entry.event)
      || !options.force && await hasValidLocalCover(entry.event, archiveOptions)) summary.skipped++;
    else pending.push(entry);
  }

  // The cached news list supplies many covers per request. Do not fetch
  // detail pages for every event or repeat searches for events already archived.
  const bulkCovers = new Map();
  const gameTargets = new Map();
  for (const { event } of pending) {
    if (!/^\d+$/.test(String(event.sourcePostId ?? ''))
      || !options.force && normalizeCoverSourceUrl(event.coverSourceUrl)) continue;
    const gids = options.gameGids?.[event.gameKey] ?? GAME_GIDS[event.gameKey];
    if (!gids) continue;
    if (!gameTargets.has(gids)) gameTargets.set(gids, new Set());
    gameTargets.get(gids).add(String(event.sourcePostId));
  }
  if (options.bulk !== false) for (const [gids, targets] of gameTargets) {
    if (summary.detailBlocked) break;
    let lastId = '';
    const maxPages = Math.min(5, Math.max(1, options.maxBulkPages ?? 5));
    for (let page = 0; page < maxPages && targets.size > 0; page++) {
      const api = new URL('https://bbs-api-static.miyoushe.com/painter/wapi/getNewsList');
      api.searchParams.set('gids', String(gids));
      api.searchParams.set('type', '2');
      api.searchParams.set('page_size', '100');
      api.searchParams.set('last_id', lastId);
      summary.bulkPages++;
      try {
        const data = await requestApi(api.href);
        if (!Array.isArray(data.list)) throw new Error('Official news list is missing');
        for (const item of data.list) {
          const postId = String(item?.post?.post_id ?? item?.post_id ?? '');
          if (targets.has(postId)) {
            bulkCovers.set(postId, extractPostCoverUrl(item));
            targets.delete(postId);
          }
        }
        const nextId = String(data.last_id ?? data.list.at(-1)?.post?.post_id ?? data.list.at(-1)?.post_id ?? '');
        if (!data.list.length || data.is_last || !nextId || nextId === lastId) break;
        lastId = nextId;
      } catch (error) {
        summary.bulkFailures++;
        logger.warn?.(`Official cover list (gids=${gids}): ${error.message}`);
        break;
      }
    }
  }

  const detailCache = new Map();
  let detailQueue = Promise.resolve();
  let lastDetailFinishedAt = 0;
  const detailDelayMs = Math.max(0, options.detailDelayMs ?? 1000);
  function fetchDetailCover(event) {
    const postId = String(event.sourcePostId);
    if (detailCache.has(postId)) return detailCache.get(postId);
    const task = detailQueue.then(async () => {
      if (summary.detailBlocked) return {};
      const waitMs = detailDelayMs - (Date.now() - lastDetailFinishedAt);
      if (waitMs > 0) await new Promise(resolve => setTimeout(resolve, waitMs));
      if (summary.detailBlocked) return {};
      const api = new URL('https://bbs-api.miyoushe.com/post/wapi/getPostFull');
      api.searchParams.set('post_id', postId);
      const gids = options.gameGids?.[event.gameKey] ?? GAME_GIDS[event.gameKey];
      if (gids) api.searchParams.set('gids', String(gids));
      summary.detailRequests++;
      try {
        const data = await requestApi(api.href, Math.max(detailDelayMs, options.retryDelayMs ?? 250));
        if (!data.post) throw new Error('Official detail post is missing');
        return { cover: extractPostCoverUrl(data.post) };
      } catch (error) { return { error: error.message }; }
      finally { lastDetailFinishedAt = Date.now(); }
    });
    detailCache.set(postId, task);
    detailQueue = task.then(() => undefined);
    return task;
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
      // Image requests use the same bounded retry policy as the source requests.
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
    const knownSource = normalizeCoverSourceUrl(event.coverSourceUrl);
    const bulkSource = bulkCovers.get(String(event.sourcePostId));
    if (!options.force && await tryCover(knownSource)) return;
    if (await tryCover(bulkSource)) return;
    if ((!knownSource || options.force) && !bulkSource && /^\d+$/.test(String(event.sourcePostId ?? ''))) {
      const detail = await fetchDetailCover(event);
      if (detail.error) failures.push(`official API: ${detail.error}`);
      if (await tryCover(detail.cover)) return;
    }
    if (await tryCover(normalizeCoverSourceUrl(event.coverSourceUrl)
      ?? normalizeCoverSourceUrl(event.coverUrl))) return;
    const pageUrl = normalizeCoverSourceUrl(event.url);
    if (pageUrl) {
      try {
        const { body, contentType, url } = await request(pageUrl, 2 * 1024 * 1024);
        if (!/^(?:text\/html|application\/xhtml\+xml)(?:;|$)/i.test(contentType)) {
          throw new Error('Activity page did not return HTML');
        }
        if (await tryCover(extractShareCoverUrl(body.toString('utf8'), url))) return;
      } catch (error) { failures.push(`share page: ${error.message}`); }
    }
    if (failures.length) {
      summary.failed++;
      summary.errors.push({ id: event.id, messages: failures });
      logger.warn?.(`[${event.id}] No cover archived: ${failures.join('; ')}`);
    } else {
      summary.missing++;
      logger.log?.(`[${event.id}] No announcement/share image available; retaining current cover and screenshot.`);
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
