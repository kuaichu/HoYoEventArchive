import { selectEventCandidateUrls } from './crawler-rules.js';
import { normalizeCoverSourceUrl, readPublicResource } from './event-covers.js';

export const NEWS_SOURCES = Object.freeze({
  ys: { host: 'act-api-takumi-static.mihoyo.com', appId: '16471662a82d418a', channelId: 719,
    newsUrl: id => `https://ys.mihoyo.com/main/news/detail/${id}` },
  sr: { host: 'act-api-takumi-static.mihoyo.com', appId: '1963de8dc19e461c', channelId: 255,
    newsUrl: id => `https://sr.mihoyo.com/news/${id}` },
  bh3: { host: 'act-api-takumi-static.mihoyo.com', appId: 'b9d5f96cd69047eb', channelId: 693,
    newsUrl: id => `https://bh3.mihoyo.com/news/693/${id}` },
  zzz: { host: 'api-takumi-static.mihoyo.com', appId: '706fd13a87294881', channelId: 273,
    newsUrl: id => `https://zzz.mihoyo.com/news/${id}` }
});

function decodeEntities(value) {
  return value.replace(/&(?:amp|quot|apos|lt|gt|nbsp|#\d+|#x[\da-f]+);/gi, entity => {
    const name = entity.slice(1, -1).toLowerCase();
    const named = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ' };
    if (named[name]) return named[name];
    const code = name.startsWith('#x') ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
    return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff)
      ? String.fromCodePoint(code) : entity;
  });
}

function htmlTags(html) {
  if (typeof html !== 'string') return [];
  const visible = html.replace(/<!--[\s\S]*?(?:-->|$)/g, '')
    .replace(/<(script|style)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/gi, '');
  return [...visible.matchAll(/<([a-z][\w:-]*)\b(?:"[^"]*"|'[^']*'|[^'">])*>/gi)]
    .map(match => {
      const attrs = {};
      for (const attr of match[0].matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) {
        attrs[attr[1].toLowerCase()] = decodeEntities(attr[2] ?? attr[3] ?? attr[4]);
      }
      return { name: match[1].toLowerCase(), attrs };
    });
}

export function extractAnnouncementLinks(html) {
  return selectEventCandidateUrls(htmlTags(html).map(tag => tag.attrs.href).filter(isPublicAbsoluteLink));
}

function isPublicAbsoluteLink(value) {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password;
  } catch { return false; }
}

function newsId(value) {
  if (typeof value === 'number' && !Number.isSafeInteger(value)) return null;
  const id = String(value ?? '').trim();
  return /^\d+$/.test(id) && /[1-9]/.test(id) ? id : null;
}

function chinaTimestamp(value) {
  if (typeof value !== 'string') return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const parts = match.slice(1).map(Number);
  const [year, month, day, hour, minute, second] = parts;
  const local = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  if (local.getUTCFullYear() !== year || local.getUTCMonth() !== month - 1
    || local.getUTCDate() !== day || local.getUTCHours() !== hour
    || local.getUTCMinutes() !== minute || local.getUTCSeconds() !== second) return null;
  const timestamp = local.getTime() / 1000 - 8 * 3600;
  return timestamp > 0 ? timestamp : null;
}

function coverValue(value) {
  if (Array.isArray(value)) return value.map(coverValue).find(Boolean) ?? null;
  return normalizeCoverSourceUrl(typeof value === 'string' ? value : value?.url ?? value?.image_url);
}

function extractNewsCover(gameKey, item, sourceUrl) {
  let ext = item.sExt;
  try { if (typeof ext === 'string') ext = JSON.parse(ext); } catch { ext = null; }
  if (ext && typeof ext === 'object' && !Array.isArray(ext)) {
    const preferred = { ys: ['720_1', 'newsbanner'], sr: ['news-poster'], zzz: ['news-banner'] }[gameKey]
      ?? Object.keys(ext).filter(key => /_1$/.test(key));
    const keys = [...new Set([...preferred, ...Object.keys(ext).filter(key => /_0$/.test(key))])];
    for (const key of keys) {
      const cover = coverValue(ext[key]);
      if (cover) return cover;
    }
  }
  for (const tag of htmlTags(item.sContent)) {
    if (tag.name !== 'img') continue;
    const cover = normalizeCoverSourceUrl(tag.attrs.src ?? tag.attrs['data-src'], sourceUrl);
    if (cover) return cover;
  }
  return null;
}

export function normalizeOfficialNews(gameKey, item) {
  const source = NEWS_SOURCES[gameKey];
  if (!source || !item || typeof item !== 'object') return null;
  const id = newsId(item.iInfoId);
  const subject = typeof item.sTitle === 'string' ? item.sTitle.trim() : '';
  const createdAt = chinaTimestamp(item.dtStartTime);
  if (!id || !subject || !createdAt || typeof item.sContent !== 'string') return null;
  const sourceNewsUrl = source.newsUrl(id);
  return {
    post: { subject, content: item.sContent, created_at: createdAt,
      cover: extractNewsCover(gameKey, item, sourceNewsUrl) },
    news_meta: { start_at_sec: createdAt },
    sourceNewsId: id, sourceNewsUrl, sourceKind: 'official-news',
    links: selectEventCandidateUrls([...extractAnnouncementLinks(item.sContent),
      ...(typeof item.sUrl === 'string' ? [decodeEntities(item.sUrl)] : [])].filter(isPublicAbsoluteLink))
  };
}

function boundedInteger(value, fallback, min, max) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, Math.trunc(parsed))) : fallback;
}

function requestOptions(options) {
  return { ...options,
    timeoutMs: boundedInteger(options.timeoutMs, 15000, 1, 15000),
    maxBytes: boundedInteger(options.maxBytes, 8 * 1024 * 1024, 1, 8 * 1024 * 1024),
    maxAttempts: boundedInteger(options.maxAttempts, 2, 1, 2),
    retryDelayMs: boundedInteger(options.retryDelayMs, 500, 0, 5000),
    sleepFn: options.sleepFn ?? (ms => new Promise(resolve => setTimeout(resolve, ms)))
  };
}

function apiUrl(source, method, parameters) {
  const url = new URL(`https://${source.host}/content_v2_user/app/${source.appId}/${method}`);
  url.search = new URLSearchParams({ ...parameters, sLangKey: 'zh-cn' }).toString();
  return url.href;
}

async function requestNews(url, fetchImpl, options) {
  let resource;
  for (let attempt = 1; attempt <= options.maxAttempts; attempt++) {
    try {
      resource = await readPublicResource(url, { ...options, fetchImpl });
      break;
    } catch (error) {
      const http = /^HTTP (\d+)$/.exec(error.message);
      const retryable = http ? Number(http[1]) === 429 || Number(http[1]) >= 500
        : error instanceof TypeError || /timed out|ECONN|ENOTFOUND|EAI_AGAIN|fetch failed/i.test(error.message);
      if (!retryable || attempt === options.maxAttempts) throw error;
      await options.sleepFn(options.retryDelayMs * attempt);
    }
  }
  let json;
  try { json = JSON.parse(resource.body.toString('utf8')); }
  catch { throw new Error('Official news API returned invalid JSON'); }
  if (json?.retcode !== 0) throw new Error(`Official news API retcode=${json?.retcode}`);
  if (!json.data || typeof json.data !== 'object' || Array.isArray(json.data)) {
    throw new Error('Official news API returned invalid data');
  }
  return json.data;
}

export async function fetchOfficialNews(game, fetchImpl = fetch, options = {}) {
  const gameKey = typeof game === 'string' ? game : game?.gameKey;
  const source = NEWS_SOURCES[gameKey];
  if (!source) return { posts: [], status: 'failed', error: `Unknown official news game: ${gameKey}` };
  const settings = requestOptions(options);
  const pageSize = boundedInteger(options.pageSize, 20, 1, 100);
  const maxPages = boundedInteger(options.maxPages, 5, 1, 50);
  const posts = [];
  const ids = new Set();
  const errors = [];
  for (let page = 1; page <= maxPages; page++) {
    try {
      const data = await requestNews(apiUrl(source, 'getContentList', {
        iPage: page, iPageSize: pageSize, iChanId: source.channelId
      }), fetchImpl, settings);
      if (!Array.isArray(data.list)) throw new Error('Official news API returned an invalid list');
      if (!Number.isSafeInteger(data.iTotal) || data.iTotal < 0) throw new Error('Official news API returned an invalid total');
      for (const item of data.list) {
        const normalized = normalizeOfficialNews(gameKey, item);
        if (!normalized) { errors.push(`Invalid official news record on page ${page}`); continue; }
        if (!ids.has(normalized.sourceNewsId)) {
          posts.push(normalized);
          ids.add(normalized.sourceNewsId);
        }
      }
      if (!data.list.length && data.iTotal > (page - 1) * pageSize) {
        errors.push(`Official news API returned an empty page ${page} before its total`);
        break;
      }
      if (page * pageSize >= data.iTotal) break;
    } catch (error) { errors.push(error.message); break; }
  }
  return { posts, status: errors.length ? posts.length ? 'partial' : 'failed' : 'ok',
    error: errors.length ? [...new Set(errors)].join('; ') : null };
}

export async function fetchOfficialNewsDetail(gameKey, id, options = {}) {
  const source = NEWS_SOURCES[gameKey];
  const requestedId = newsId(id);
  if (!source || !requestedId) throw new Error('Invalid official news game or ID');
  const data = await requestNews(apiUrl(source, 'getContent', { iInfoId: requestedId }),
    options.fetchImpl ?? fetch, requestOptions(options));
  const records = Array.isArray(data.list) ? data.list : Object.hasOwn(data, 'iInfoId') ? [data] : [];
  const normalized = records.map(item => normalizeOfficialNews(gameKey, item))
    .find(item => item?.sourceNewsId === requestedId);
  if (!normalized) throw new Error(`Official news detail ${requestedId} is missing or invalid`);
  return normalized;
}
