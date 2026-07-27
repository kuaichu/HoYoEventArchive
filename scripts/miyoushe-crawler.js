import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import puppeteer from 'puppeteer';
import {
  canonicalizeEventUrl,
  classifyCrawlerVersion,
  classifyEventType,
  enrichEventWithMetadata,
  extractAnnouncementMetadata,
  extractPostText,
  getAnnouncementDate,
  isEventCandidateUrl,
  isPermanentResourceUrl,
  resolveStoredEventUrl,
  selectEventTitle
} from './crawler-rules.js';
import { isNumericVersion } from './version-classification.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const eventsPath = path.join(__dirname, '..', 'src', 'events.json');
const events = JSON.parse(fs.readFileSync(eventsPath, 'utf8'));

const games = [
  { gids: 2, name: '原神', gameKey: 'ys', forumId: 28 },
  { gids: 6, name: '星穹铁道', gameKey: 'sr', forumId: 53 },
  { gids: 8, name: '绝区零', gameKey: 'zzz', forumId: 58 },
  { gids: 1, name: '崩坏3', gameKey: 'bh3', forumId: 6 }
];

const pageSize = Number.parseInt(process.env.MIYOUSHE_PAGE_SIZE || '20', 10);
const maxPagesPerGame = Number.parseInt(process.env.MIYOUSHE_MAX_PAGES || '5', 10);
const fetchMaxAttempts = Math.min(
  5,
  Math.max(1, Number.parseInt(process.env.MIYOUSHE_FETCH_ATTEMPTS || '3', 10) || 3)
);
const fetchRetryDelayMs = Math.max(
  0,
  Number.parseInt(process.env.MIYOUSHE_RETRY_DELAY_MS || '750', 10) || 750
);
const enrichExistingIds = new Set(
  String(process.env.MIYOUSHE_ENRICH_EXISTING_IDS || '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean)
);

function sleep(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

function isRetryableFetchError(error) {
  const status = error?.httpStatus;
  return status === undefined
    || status === 408
    || status === 425
    || status === 429
    || status >= 500;
}

async function fetchForumPage(game, page, lastId, fetchImpl, options) {
  const url = `https://bbs-api.miyoushe.com/post/wapi/getForumPostList?forum_id=${game.forumId}&is_good=false&is_top=false&last_id=${encodeURIComponent(lastId)}&page_size=${pageSize}&sort_type=2`;
  let lastError;

  for (let attempt = 1; attempt <= options.maxAttempts; attempt++) {
    try {
      const res = await fetchImpl(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Referer': 'https://www.miyoushe.com/'
        }
      });
      if (!res.ok) {
        const error = new Error(`HTTP ${res.status}`);
        error.httpStatus = res.status;
        throw error;
      }

      const json = await res.json();
      if (json.retcode !== 0 || !json.data || !Array.isArray(json.data.list)) {
        throw new Error(`retcode=${json.retcode}, message=${json.message}`);
      }
      return json;
    } catch (error) {
      lastError = error;
      if (attempt >= options.maxAttempts || !isRetryableFetchError(error)) throw error;
      const delayMs = options.retryDelayMs * attempt;
      console.warn(
        `Retrying forum list page ${page} for ${game.name} after ${error.message} ` +
        `(attempt ${attempt}/${options.maxAttempts}, delay ${delayMs}ms).`
      );
      await options.sleepFn(delayMs);
    }
  }

  throw lastError;
}

export async function fetchForumPosts(game, fetchImpl = fetch, options = {}) {
  const posts = [];
  let lastId = '';
  const requestOptions = {
    maxAttempts: Math.min(5, Math.max(1, Number.parseInt(options.maxAttempts, 10) || fetchMaxAttempts)),
    retryDelayMs: Math.max(0, Number.parseInt(options.retryDelayMs, 10) || 0),
    sleepFn: options.sleepFn || sleep
  };
  if (options.retryDelayMs === undefined) requestOptions.retryDelayMs = fetchRetryDelayMs;

  for (let page = 1; page <= maxPagesPerGame; page++) {
    try {
      const json = await fetchForumPage(game, page, lastId, fetchImpl, requestOptions);

      posts.push(...json.data.list);

      if (json.data.is_last || !json.data.last_id || json.data.list.length === 0) {
        break;
      }
      lastId = json.data.last_id;
    } catch (error) {
      const status = posts.length === 0 ? 'failed' : 'partial';
      console.error(`Failed to fetch forum list page ${page} for ${game.name}: ${error.message}`);
      return { posts, status, error: error.message };
    }
  }

  return { posts, status: 'ok', error: null };
}

export function shouldFailCrawler(sourceOutcomes) {
  return sourceOutcomes.length === 0 || sourceOutcomes.every(result => result.status === 'failed');
}

export function classifySourceProcessingOutcome(fetchStatus, processedPostCount, parseErrorCount) {
  if (fetchStatus === 'failed') return 'failed';
  if (parseErrorCount > 0 && processedPostCount === 0) return 'failed';
  if (fetchStatus === 'partial' || parseErrorCount > 0) return 'partial';
  return 'ok';
}

export async function runCrawler() {
  console.log('Starting automated Miyoushe web event crawler...\n');
  const knownEventUrls = new Set(events.map(event => canonicalizeEventUrl(event.url)));
  const eventsByCanonicalUrl = new Map(
    events.map(event => [canonicalizeEventUrl(event.url), event])
  );
  
  // Track maximum event ID suffixes to prevent duplicates
  const maxNums = {};
  games.forEach(g => {
    const gameEvents = events.filter(e => e.gameKey === g.gameKey);
    let maxNum = 0;
    gameEvents.forEach(e => {
      const parts = e.id.split('-');
      if (parts.length === 2) {
        const num = parseInt(parts[1], 10);
        if (!isNaN(num) && num > maxNum) {
          maxNum = num;
        }
      }
    });
    maxNums[g.gameKey] = maxNum;
  });

  let browser;
  let newEventsCount = 0;
  let updatedEventsCount = 0;
  const sourceOutcomes = [];

  try {
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    for (const game of games) {
      console.log(`>>> Fetching forum post list for game: ${game.name} (${game.gameKey.toUpperCase()})`);

      const sourceResult = await fetchForumPosts(game);
      const sourceOutcome = {
        gameKey: game.gameKey,
        status: sourceResult.status,
        error: sourceResult.error
      };
      sourceOutcomes.push(sourceOutcome);

      if (sourceResult.status === 'failed') {
        continue;
      }

      const posts = sourceResult.posts;
      if (posts.length === 0) {
        continue;
      }

      console.log(
        `Found total ${posts.length} announcement posts for ${game.name}` +
        `${sourceResult.status === 'partial' ? ' (partial source result)' : ''}. Parsing details...`
      );

      let processedPostCount = 0;
      let parseErrorCount = 0;

      for (const item of posts) {
        try {
          const post = item?.post;
          if (!post || typeof post.post_id === 'undefined' || typeof post.subject !== 'string') {
            throw new Error('post is missing required fields');
          }

          const postId = post.post_id;
          const subject = post.subject;
          const structuredStr = post.structured_content;

          if (!structuredStr) {
            processedPostCount++;
            continue;
          }

          const ops = JSON.parse(structuredStr);
          if (!Array.isArray(ops)) {
            throw new Error('structured_content is not an array');
          }
          processedPostCount++;
          const postText = extractPostText(post);
          const announcementMetadata = extractAnnouncementMetadata(postText);
        
          // Extract links from structured content
          const matches = [];
          ops.forEach(op => {
            if (op.attributes && op.attributes.link) {
              const link = op.attributes.link;
              if (isEventCandidateUrl(link)) {
                matches.push(link.replace(/&amp;/g, '&').replace(/[.,;!?]$/, ''));
              }
            }
          });
        
          // Process unique URLs found in this post
          const uniqueUrls = [...new Set(matches.map(u => u.replace(/&amp;/g, '&').replace(/[.,;!?]$/, '')))];
        
          for (const rawUrl of uniqueUrls) {
          let cleanUrl;
          try {
            cleanUrl = await resolveStoredEventUrl(rawUrl);
          } catch (error) {
            console.warn(`Could not resolve event link ${rawUrl}: ${error.message}`);
            continue;
          }

          if (!cleanUrl) continue;
          if (cleanUrl !== rawUrl) {
            console.log(`Resolved event short link: ${rawUrl} -> ${cleanUrl}`);
          }

          if (isPermanentResourceUrl(cleanUrl)) {
            console.log(`Skipping permanent resource linked by "${subject}": ${cleanUrl}`);
            continue;
          }

          const canonicalUrl = canonicalizeEventUrl(cleanUrl);

          const existingEvent = eventsByCanonicalUrl.get(canonicalUrl);
          if (existingEvent) {
            const sameSource = !existingEvent.sourcePostId || String(existingEvent.sourcePostId) === String(postId);
            if (sameSource && enrichExistingIds.has(existingEvent.id)) {
              const enrichment = enrichEventWithMetadata(existingEvent, announcementMetadata);
              if (enrichment.changed) {
                Object.assign(existingEvent, enrichment.event);
                updatedEventsCount++;
                console.log(`Enriched existing event metadata: [${existingEvent.id}] ${existingEvent.title}`);
              }
            }
            continue;
          }
          
          console.log(`\n[NEW EVENT FOUND] Post: "${subject}"`);
          console.log(`Target Event URL: ${cleanUrl}`);
          
          // Scrape metadata using Puppeteer
          let eventTitle = subject;
          let eventDesc = '提瓦特/米游社官方网页活动。';
          
          let page;
          
          try {
            page = await browser.newPage();
            await page.setViewport({ width: 1280, height: 720 });
            await page.goto(cleanUrl, { waitUntil: 'networkidle2', timeout: 20000 });
            await new Promise(r => setTimeout(r, 2000));
            
            const pageData = await page.evaluate(() => {
              const title = document.title || '';
              const ogTitleEl = document.querySelector('meta[property="og:title"]');
              const descEl = document.querySelector('meta[name="description"]') || 
                             document.querySelector('meta[property="og:description"]');
              const ogTitle = ogTitleEl ? ogTitleEl.getAttribute('content') : '';
              const desc = descEl ? descEl.getAttribute('content') : '';
              return { title, ogTitle, desc };
            });
            
            eventTitle = selectEventTitle(subject, pageData.title, pageData.ogTitle);
            if (pageData.desc && pageData.desc.trim().length > 10) {
              eventDesc = pageData.desc.trim();
            }
          } catch (err) {
            console.warn(`Could not fetch details for ${cleanUrl}: ${err.message}. Using post subject.`);
          } finally {
            await page?.close().catch(error => {
              console.warn(`Could not close metadata page for ${cleanUrl}: ${error.message}`);
            });
          }
          
          const combinedText = `${postText} ${eventTitle} ${eventDesc}`;
          // This is the announcement post date, not necessarily the page's launch date.
          const pubDate = getAnnouncementDate(item);
          if (!pubDate) {
            console.warn(`Skipping ${cleanUrl}: source post has no reliable publication time.`);
            continue;
          }
          
          const textToAnalyze = `${postText} ${eventTitle} ${eventDesc}`.toLowerCase();
          const eventType = classifyEventType(textToAnalyze);
          const version = classifyCrawlerVersion({
            gameKey: game.gameKey,
            title: eventTitle,
            sourcePostTitle: subject,
            description: eventDesc,
            body: postText,
            date: pubDate,
            eventType
          });
          if (eventType === '版本前瞻' && !isNumericVersion(version)) {
            console.warn(`Skipping ${cleanUrl}: version preview has no confirmed target version.`);
            continue;
          }
          
          // Generate new ID suffix safely
          maxNums[game.gameKey] += 1;
          const newId = `${game.gameKey}-${maxNums[game.gameKey]}`;
          
          // Assemble tags
          const tags = [];
          if (eventType !== '其他活动') tags.push(eventType);
          if (isNumericVersion(version)) tags.push(`${version}版本`);
          else if (version === '公测前') tags.push('公测前');
          if (textToAnalyze.includes('原石') || textToAnalyze.includes('星琼') || textToAnalyze.includes('菲林')) {
            tags.push('游戏内奖励');
          }
          
          const newEvent = {
            id: newId,
            title: eventTitle,
            url: cleanUrl,
            game: game.name,
            gameKey: game.gameKey,
            type: eventType,
            status: '可访问',
            date: pubDate,
            dateType: 'announcement',
            sourcePostId: String(postId),
            sourcePostTitle: subject,
            tags: tags.length > 0 ? tags : ['网页活动'],
            version: version,
            description: announcementMetadata.description || eventDesc,
            ...(announcementMetadata.startDate ? { startDate: announcementMetadata.startDate } : {}),
            ...(announcementMetadata.endDate ? { endDate: announcementMetadata.endDate } : {}),
            ...(announcementMetadata.reward ? { reward: announcementMetadata.reward } : {})
          };
          
          events.push(newEvent);
          knownEventUrls.add(canonicalUrl);
          eventsByCanonicalUrl.set(canonicalUrl, newEvent);
          newEventsCount++;
          console.log(`Added new event: [${newEvent.id}] ${newEvent.title} (${newEvent.version})`);
          }
        } catch (err) {
          parseErrorCount++;
          console.error(`Skipping malformed post for ${game.name}: ${err.message}`);
        }
      }

      sourceOutcome.status = classifySourceProcessingOutcome(
        sourceResult.status,
        processedPostCount,
        parseErrorCount
      );
      if (parseErrorCount > 0) {
        sourceOutcome.error = `${parseErrorCount} malformed post(s)`;
      }
    }

    if (shouldFailCrawler(sourceOutcomes)) {
      throw new Error('All configured Miyoushe sources failed. Refusing to report a successful crawl.');
    }

    if (newEventsCount > 0 || updatedEventsCount > 0) {
      fs.writeFileSync(eventsPath, `${JSON.stringify(events, null, 2)}\n`, 'utf8');
      console.log(
        `\nCrawler updated events.json: ${newEventsCount} new event(s), ${updatedEventsCount} enriched event(s).`
      );
    } else {
      console.log('\nNo new web events found. Database is up to date.');
    }

    return { newEventsCount, updatedEventsCount, sourceOutcomes };
  } finally {
    await browser?.close();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  runCrawler().catch(err => {
    console.error('Crawler failed:', err);
    process.exitCode = 1;
  });
}
