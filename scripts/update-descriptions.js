import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readPublicResource } from './event-covers.js';
import { enrichEventDescription, extractAnnouncementMetadata, extractPostText, isDescriptionResource } from './crawler-rules.js';

const EVENTS_PATH = fileURLToPath(new URL('../src/events.json', import.meta.url));
const PLACEHOLDERS = new Set(['', '提瓦特/米游社官方网页活动。', '米游社官方网页活动。']);

// Compare against the former crawler output so existing custom text stays intact.
function legacyPostText(post) {
  try {
    const ops = typeof post.structured_content === 'string'
      ? JSON.parse(post.structured_content) : post.structured_content;
    if (Array.isArray(ops)) {
      const text = ops.map(op => typeof op?.insert === 'string' ? op.insert : '')
        .filter(Boolean).join('\n').replace(/\r/g, '').trim();
      if (text) return text;
    }
  } catch { /* Use the previous HTML fallback below. */ }
  return String(post.content || '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/\r/g, '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

function pageDescription(html) {
  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attrs = {};
    for (const attribute of match[0].matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) {
      attrs[attribute[1].toLowerCase()] = attribute[2] ?? attribute[3] ?? attribute[4];
    }
    if (['description', 'og:description', 'twitter:description'].includes((attrs.name || attrs.property || '').toLowerCase())) {
      return String(attrs.content || '').replace(/&quot;/gi, '"').replace(/&#39;/g, "'")
        .replace(/&amp;/gi, '&').replace(/&nbsp;/gi, ' ').trim();
    }
  }
  return '';
}

export async function updateEventDescriptions(options = {}) {
  const eventsPath = options.eventsPath || EVENTS_PATH;
  const original = options.events ?? JSON.parse(await fs.readFile(eventsPath, 'utf8'));
  if (!Array.isArray(original)) throw new Error('events.json must contain an array');
  const events = original.slice();
  const ids = options.ids ? new Set(typeof options.ids === 'string' ? options.ids.split(',') : options.ids) : null;
  const selected = events.map((event, index) => ({ event, index }))
    .filter(({ event }) => !ids || ids.has(event.id)).slice(0, options.limit ?? Infinity);
  const summary = { selected: selected.length, updated: 0, manualSkipped: 0, preserved: 0,
    missing: 0, failed: 0, requests: 0, detailRequests: 0, detailBlocked: false };
  const logger = options.logger ?? console;
  const network = { fetchImpl: options.fetchImpl, lookupImpl: options.lookupImpl, timeoutMs: options.timeoutMs ?? 15000 };
  const posts = new Map();
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

  async function requestApi(url) {
    summary.requests++;
    const { body } = await readPublicResource(url, { ...network, maxBytes: 4 * 1024 * 1024 });
    const json = JSON.parse(body.toString('utf8'));
    if (json.retcode === 1034) summary.detailBlocked = true;
    if (json.retcode !== 0 || !json.data) throw new Error(`Official API retcode=${json.retcode}`);
    return json.data;
  }

  let lastDetailAt = 0;
  const attempted = new Set();
  for (const { event, index } of pending) {
    const postId = String(event.sourcePostId || '');
    let failed = false;
    if (/^\d+$/.test(postId) && !posts.has(postId) && !attempted.has(postId) && !summary.detailBlocked) {
      attempted.add(postId);
      const delay = Math.max(0, (options.detailDelayMs ?? 2500) - (Date.now() - lastDetailAt));
      if (delay) await new Promise(resolve => setTimeout(resolve, delay));
      const url = new URL('https://bbs-api.miyoushe.com/post/wapi/getPostFull');
      url.searchParams.set('post_id', postId);
      summary.detailRequests++;
      try {
        const data = await requestApi(url.href);
        const post = data.post?.post;
        if (!post || String(post.post_id) !== postId) throw new Error('Official source post does not match the event');
        posts.set(postId, post);
      } catch (error) { failed = true; logger.warn?.(`[${event.id}] Description source unavailable: ${error.message}`); }
      finally { lastDetailAt = Date.now(); }
    }

    const post = posts.get(postId);
    let update = post ? enrichEventDescription(event, extractPostText(post), { legacyText: legacyPostText(post) })
      : { event, changed: false };
    // Page metadata only fills empty/placeholder text; it never downgrades a useful announcement.
    if (!update.changed && PLACEHOLDERS.has(String(event.description || '').trim())) {
      try {
        summary.requests++;
        const resource = await readPublicResource(event.url, { ...network, maxBytes: 2 * 1024 * 1024 });
        const description = pageDescription(resource.body.toString('utf8'));
        if (description) {
          update = enrichEventDescription(event, description);
          if (update.changed) update.event.descriptionSource = 'page';
        }
      } catch (error) { failed = true; logger.warn?.(`[${event.id}] Description metadata unavailable: ${error.message}`); }
    }
    if (update.changed) {
      events[index] = update.event;
      summary.updated++;
      logger.log?.(`[${event.id}] ${options.dryRun ? 'Proposed' : 'Updated'} description: ${update.event.description}`);
    } else if (failed) summary.failed++;
    else if (post || !PLACEHOLDERS.has(String(event.description || '').trim())) summary.preserved++;
    else summary.missing++;
  }
  if (summary.detailBlocked) logger.warn?.('Official API requested verification; remaining detail requests stopped.');
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
