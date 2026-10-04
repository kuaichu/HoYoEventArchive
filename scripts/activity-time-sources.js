import { normalizeCoverSourceUrl, readPublicResource } from './event-covers.js';
import { parseActivityTime, parseChinaTime, parseUnixTime } from './activity-time-parser.js';

const MAX_BYTES = 8 * 1024 * 1024;
const GAME_BIZ = { ys: 'hk4e_cn', sr: 'hkrpg_cn', zzz: 'nap_cn', bh3: 'bh3_cn' };
const bounded = (value, fallback, max) => Number.isFinite(Number(value)) ? Math.max(1, Math.min(max, Math.trunc(Number(value)))) : fallback;
function officialUrl(value, base) {
  const normalized = normalizeCoverSourceUrl(value, base);
  if (!normalized) return null;
  const host = new URL(normalized).hostname;
  return ['mihoyo.com', 'hoyoverse.com'].some(domain => host === domain || host.endsWith(`.${domain}`)) ? normalized : null;
}
const dateOf = value => value?.slice(0, 10).replaceAll('-', '.');
function ordered(start, end) { return !start || !end || Date.parse(start) <= Date.parse(end); }
function windowFields(start, end) {
  return ordered(start, end) ? { ...(start ? { startAt: start } : {}), ...(end ? { endAt: end } : {}) } : {};
}
function hasTimes(value) { return Boolean(value.startAt || value.endAt || value.startDate || value.endDate); }
function complete(value) { return Boolean((value.startAt || value.startDate) && (value.endAt || value.endDate)); }
function safeId(url) {
  const id = url.searchParams.get('act_id') ?? url.searchParams.get('id');
  const alternate = url.searchParams.get('id');
  return /^[a-zA-Z0-9_-]{1,100}$/.test(id ?? '') && (!alternate || alternate === id) ? id : null;
}

// cache includes rejected promises, avoiding repeated requests to missing historical
// bundles. API header is part of the key because many events share one endpoint.
function createReader(options, state) {
  const cache = options.cache ?? new Map();
  const deadline = Date.now() + bounded(options.totalTimeoutMs, 15000, 30000);
  const maxRequests = bounded(options.maxRequests, 8, 12);
  const byteBudget = bounded(options.maxBytes, MAX_BYTES, MAX_BYTES);
  return async (url, headers = {}) => {
    if (!officialUrl(url)) throw new Error('Unsafe or non-official activity URL');
    const key = `${url}\n${headers['x-rpc-act_id'] ?? ''}\n${headers.Range ?? ''}`;
    if (cache.has(key)) return cache.get(key);
    if (state.requests >= maxRequests) throw new Error('Activity request budget exhausted');
    if (state.bytes >= byteBudget) throw new Error('Activity response byte budget exhausted');
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error('Activity time lookup deadline exceeded');
    state.requests++;
    const task = (async () => {
      const fetchImpl = options.fetchImpl ?? fetch;
      const responseLimit = Math.min(byteBudget - state.bytes, headers.Range ? 2097152 : byteBudget);
      const resource = await (options.readResource ?? readPublicResource)(url, {
        lookupImpl: options.lookupImpl, timeoutMs: Math.min(remaining, bounded(options.timeoutMs, 15000, 15000)),
        maxBytes: responseLimit,
        fetchImpl: (requestUrl, init) => fetchImpl(requestUrl, { ...init,
          headers: { ...init.headers, ...headers } })
      });
      const body = Buffer.isBuffer(resource.body) ? resource.body : Buffer.from(resource.body);
      if (body.length > responseLimit) throw new Error('Activity response exceeds bounded source size');
      state.bytes += body.length;
      if (state.bytes > byteBudget) throw new Error('Activity response byte budget exhausted');
      if (!officialUrl(resource.url ?? url)) throw new Error('Activity redirected to a non-official source');
      return { ...resource, body };
    })();
    cache.set(key, task);
    return task;
  };
}
async function apiData(read, url, headers) {
  const resource = await read(url, headers);
  let json;
  try { json = JSON.parse(resource.body.toString('utf8')); }
  catch { throw new Error('Activity API returned invalid JSON'); }
  if (json?.retcode !== 0) {
    const error = new Error(`Activity API retcode=${json?.retcode}: ${String(json?.message ?? '').slice(0, 150)}`);
    error.apiUnavailable = true;
    throw error;
  }
  if (!json.data || typeof json.data !== 'object' || Array.isArray(json.data)) throw new Error('Activity API returned invalid data');
  return json.data;
}
function scriptUrls(html, pageUrl) {
  const page = new URL(pageUrl), directory = page.pathname.slice(0, page.pathname.lastIndexOf('/') + 1);
  const visible = html.replace(/<!--[\s\S]*?(?:-->|$)/g, '')
    .replace(/<style\b[^>]*>[\s\S]*?(?:<\/style\s*>|$)/gi, '');
  const candidates = [];
  // Consume entire script blocks so strings inside scripts cannot masquerade as src tags.
  for (const match of visible.matchAll(/<script\b((?:"[^"]*"|'[^']*'|[^'">])*)>[\s\S]*?(?:<\/script\s*>|$)/gi)) {
    const attr = /(?:^|\s)src\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(match[1]);
    const source = attr && officialUrl((attr[1] ?? attr[2] ?? attr[3]).replaceAll('&amp;', '&'), pageUrl);
    if (!source) continue;
    const parsed = new URL(source);
    if (parsed.origin !== page.origin) continue;
    if (!/\/(?:index|commons?|vendors?)[._-][\w.-]*\.js$/i.test(parsed.pathname)) continue;
    candidates.push(source);
  }
  const campaign = path => /^(?:\/act)?\/(ys|sr|zzz|bh3)\/event\/[^/]+\//.exec(path);
  const pageCampaign = campaign(page.pathname);
  const gameCandidates = pageCampaign ? candidates.filter(url => campaign(new URL(url).pathname)?.[1] === pageCampaign[1]) : [];
  const campaigns = new Set(gameCandidates.map(url => campaign(new URL(url).pathname)[0].replace(/^\/act\//, '/')));
  const roles = new Set(gameCandidates.map(url => /\/(index|commons?|vendors?)[._-]/i.exec(new URL(url).pathname)[1].replace(/s$/, '')));
  const canonical = pageCampaign && campaigns.size === 1 && roles.has('index') && roles.size >= 2
    ? [...campaigns][0] : null;
  const urls = candidates.filter(url => {
    const path = new URL(url).pathname;
    return path.startsWith(directory) || path.startsWith(`/act${directory}`)
      || canonical && path.replace(/^\/act\//, '/').startsWith(canonical);
  });
  return [...new Set(urls)].sort((a, b) => Number(!/\/index[._-]/.test(a)) - Number(!/\/index[._-]/.test(b))).slice(0, 5);
}

export function extractActivityI18nConfigs(script, event = {}) {
  const configs = [];
  // Only actual initialization calls with a literal business app ID count; SDK
  // declarations/defaults and arbitrary image URLs do not establish a source.
  for (const match of script.matchAll(/initAppI18n\)?\s*\([^;]{0,300}?\{([^{}]{0,500})\}/g)) {
    const config = match[1];
    const appId = /\bappId\s*:\s*["']([me]\d{8}[\w-]*)["']/.exec(config)?.[1];
    if (!appId) continue;
    const bizExpression = /\bgameBiz\s*:\s*([^,}]+)/.exec(config)?.[1];
    const declaredBiz = bizExpression && /^["']([\w-]+)["']$/.exec(bizExpression.trim())?.[1];
    const chinaBranchBiz = bizExpression && /["']((?:hk4e|hkrpg|nap|bh3)_cn)["']/.exec(bizExpression)?.[1];
    const gameBiz = declaredBiz ?? chinaBranchBiz ?? GAME_BIZ[event.gameKey];
    if (!Object.values(GAME_BIZ).includes(gameBiz)) continue;
    if (declaredBiz && GAME_BIZ[event.gameKey] && declaredBiz !== GAME_BIZ[event.gameKey]) continue;
    const zone = /\bzone\s*:\s*["']([\w-]+)["']/.exec(config)?.[1];
    if (zone && !['morax', 's3'].includes(zone)) continue;
    const base = zone === 'morax' ? 'https://fastcdn.mihoyo.com/mi18n'
      : zone === 's3' ? 'https://webstatic.hoyoverse.com/admin/mi18n' : 'https://webstatic.mihoyo.com/admin/mi18n';
    configs.push({ appId, gameBiz, url: `${base}/${gameBiz}/${appId}/${appId}-zh-cn.json` });
  }
  // Older business bundles wrap MI18N.install and pass its uniqueID positionally.
  // Establish that wrapper's meaning before inspecting calls; a lone app-ID string
  // or sharing configuration is insufficient evidence.
  for (const wrapper of script.matchAll(/(?:^|[;,{}])\s*(?:(?:var|let|const)\s+)?([A-Za-z_$][\w$]{0,80})\s*=\s*function\s*\([^)]*\)\s*\{[\s\S]{0,900}?\.install\([^;]{0,300}?\{[^{}]{0,300}?uniqueID\s*:[^{}]{0,200}?mi18nGameBiz\s*:/g)) {
    const symbol = wrapper[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const call = new RegExp(`${symbol}\\(\\s*[^,;]{1,100},\\s*["']([me]\\d{8}[\\w-]*)["']\\s*,\\s*([^,;]{1,100})`, 'g');
    for (const match of script.matchAll(call)) {
      const literalBiz = /^["']([\w-]+)["']$/.exec(match[2].trim())?.[1];
      const gameBiz = literalBiz ?? GAME_BIZ[event.gameKey];
      if (!Object.values(GAME_BIZ).includes(gameBiz)) continue;
      if (GAME_BIZ[event.gameKey] && gameBiz !== GAME_BIZ[event.gameKey]) continue;
      const appId = match[1];
      configs.push({ appId, gameBiz,
        url: `https://webstatic.mihoyo.com/admin/mi18n/${gameBiz}/${appId}/${appId}-zh-cn.json` });
    }
  }
  return configs.filter((value, index, all) => all.findIndex(other => other.url === value.url) === index);
}
function ruleTexts(json) {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return [];
  return Object.entries(json).filter(([key, value]) => typeof value === 'string'
    && /^(?:rule(?:[-_]content|Content)?|rule[-_]tab1[-_]content|rule[-_]desc[-_]1[-_]1|modal[-_]rule[-_]content|content[-_]modal[-_]rule|active[-_]rules[-_]content|sys[-_]rules[-_]content|activity[-_]rule(?:[-_]content)?|act[-_]rule(?:[-_]content(?:_bili)?)?|page[-_]rule[-_]content|content[-_]rule|start[-_]rule[-_]content|tipDesc)$/.test(key))
    .map(([, value]) => value);
}

export async function fetchActivityTime(event, options = {}) {
  const state = { requests: 0, bytes: 0 };
  const source = officialUrl(event?.url);
  const base = { timeSource: 'activity-config', timeSourceUrl: source ?? event?.url ?? '', method: 'activity-page' };
  const result = (status, extra = {}) => ({ ...base, ...extra, status, requests: state.requests });
  if (!source) return result('failed', { error: 'Unsafe or non-official activity URL' });
  const page = new URL(source), id = safeId(page);
  const read = createReader(options, state);
  const parserOptions = { date: event.date, startDate: event.startDate,
    announcementDate: options.announcementDate ?? event.announcementDate ?? event.date };
  try {
    if (/\/(?:doujin-collect|doujin-collection|bbs-event-contribute)\//.test(page.pathname)) {
      base.method = 'contribution-act-info';
      base.timeSource = 'activity-api';
      if (!id) return result('missing', { reason: 'Missing or conflicting activity ID' });
      const url = 'https://api-takumi.mihoyo.com/event/contributionv2/actInfo';
      const data = await apiData(read, url, { 'x-rpc-act_id': id });
      if (data.act?.act_id !== id) return result('failed', { error: 'Activity API returned a mismatched act_id' });
      const act = data.act;
      const range = windowFields(parseChinaTime(act.post_start_time), parseChinaTime(act.post_end_time));
      const timeStages = [];
      const cycle = windowFields(parseChinaTime(act.start_time), parseChinaTime(act.end_time));
      if (hasTimes(cycle)) timeStages.push({ name: '活动周期', ...cycle });
      const award = parseChinaTime(act.act_award_start_time);
      if (award) timeStages.push({ name: '评奖', startAt: award });
      return result(complete(range) ? 'ok' : hasTimes(range) || timeStages.length ? 'partial' : 'missing',
        { ...range, timeSourceUrl: url, ...(timeStages.length ? { timeStages } : {}),
          ...(!complete(range) ? { reason: 'No complete valid submission window' } : {}) });
    }
    if (/\/bbs-event-ccl\//.test(page.pathname)) {
      base.method = 'excalibur-skin-rule';
      if (!id) return result('missing', { reason: 'Missing or conflicting activity ID' });
      const url = `https://api-takumi-static.mihoyo.com/event/excalibur/skinV2?act_id=${encodeURIComponent(id)}`;
      const data = await apiData(read, url);
      const parsed = parseActivityTime(data.rule, parserOptions);
      return result(complete(parsed) ? 'ok' : hasTimes(parsed) ? 'partial' : 'missing', { ...parsed, timeSourceUrl: url });
    }
    if (/\/bbs\/event\/live\//.test(page.pathname)) {
      base.method = 'miyolive-live';
      base.timeSource = 'activity-api';
      if (!id) return result('missing', { reason: 'Missing or conflicting activity ID' });
      const url = 'https://api-takumi.mihoyo.com/event/miyolive/index';
      const data = await apiData(read, url, { 'x-rpc-act_id': id });
      const live = windowFields(parseChinaTime(data.live?.start), parseChinaTime(data.live?.end));
      return result(hasTimes(live) ? 'partial' : 'missing', { timeSourceUrl: url,
        ...(hasTimes(live) ? { timeStages: [{ name: '直播', ...live }] } : {}),
        reason: 'Live broadcast time does not establish the participation window' });
    }
    if (/\/luna\/bh3\//.test(page.pathname) || event.gameKey === 'bh3' && /\/sign(?:in)?\//.test(page.pathname)) {
      base.method = 'bh3-signin-bonus';
      base.timeSource = 'activity-api';
      if (!id) return result('missing', { reason: 'Missing or conflicting activity ID' });
      const url = `https://api-takumi.mihoyo.com/event/luna/bh3/home?act_id=${encodeURIComponent(id)}&lang=zh-cn`;
      const data = await apiData(read, url), extra = data.short_extra_award;
      if (data.has_extra_award === false || extra?.has_extra_award === false) return result('permanent', { timeSourceUrl: url, reason: 'Recurring sign-in service has no active limited bonus window' });
      const range = windowFields(parseUnixTime(extra?.start_timestamp) ?? parseChinaTime(extra?.start_time),
        parseUnixTime(extra?.end_timestamp) ?? parseChinaTime(extra?.end_time));
      const reference = event.startDate ?? parserOptions.announcementDate;
      const matchDate = String(reference ?? '').slice(0, 10).replaceAll('-', '.');
      if (!complete(range) || !/^20\d{2}\.\d{2}\.\d{2}$/.test(matchDate)
        || matchDate < dateOf(range.startAt) || matchDate > dateOf(range.endAt)) {
        return result('partial', { timeSourceUrl: url, reason: 'Current sign-in bonus does not match the archived activity phase' });
      }
      return result('ok', { ...range, timeSourceUrl: url });
    }
    base.method = 'activity-static-config';
    const htmlResource = await read(source);
    const html = htmlResource.body.toString('utf8'), pageUrl = htmlResource.url ?? source;
    const htmlRange = parseActivityTime(html, parserOptions);
    if (complete(htmlRange)) return result('ok', { ...htmlRange, timeSourceUrl: pageUrl });
    const configs = [];
    // Inline script calls are business config too, but never execute their code.
    for (const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi)) configs.push(...extractActivityI18nConfigs(match[1], event));
    const failures = [];
    for (const url of scriptUrls(html, pageUrl)) {
      try {
        const first = await read(url, { Range: 'bytes=0-2097151' });
        configs.push(...extractActivityI18nConfigs(first.body.toString('utf8'), event));
        if (!configs.length && first.body.length === 2097152 && /\/index[._-]/.test(url)) {
          const tail = await read(url, { Range: 'bytes=-2097152' });
          configs.push(...extractActivityI18nConfigs(tail.body.toString('utf8'), event));
        }
        if (configs.length) break;
      }
      catch (error) { failures.push(error.message); }
    }
    let partial = hasTimes(htmlRange) ? { ...htmlRange, timeSourceUrl: pageUrl } : null;
    let relative = htmlRange.versionPeriod || htmlRange.versionStart ? { ...htmlRange, timeSourceUrl: pageUrl } : null;
    for (const config of configs.filter((value, index, all) => all.findIndex(other => other.url === value.url) === index)) {
      try {
        const resource = await read(config.url);
        const json = JSON.parse(resource.body.toString('utf8'));
        const direct = typeof json?.event_time === 'string' ? [`活动时间：${json.event_time}`] : [];
        for (const text of [...ruleTexts(json), ...direct]) {
          const parsed = parseActivityTime(text, parserOptions);
          if (complete(parsed)) return result('ok', { ...parsed, timeSourceUrl: config.url });
          if (hasTimes(parsed)) partial ??= { ...parsed, timeSourceUrl: config.url };
          if (parsed.versionPeriod || parsed.versionStart) relative ??= { ...parsed, timeSourceUrl: config.url };
        }
      } catch (error) { failures.push(error.message); }
    }
    if (partial) return result('partial', partial);
    return result('missing', { ...(relative ?? {}), reason: relative?.reason ?? 'No explicit activity window in safely discoverable official rules',
      ...(failures.length ? { error: [...new Set(failures)].join('; ') } : {}) });
  } catch (error) {
    return result(error.apiUnavailable ? 'missing' : 'failed', { error: error.message });
  }
}
