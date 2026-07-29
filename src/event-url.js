const removableContextParams = new Set([
  'bbs_auth_required',
  'bbs_landscape',
  'bbs_presentation_style',
  'mhy_auth_required',
  'mhy_bg_style',
  'mhy_hide_status_bar',
  'mhy_landscape',
  'mhy_presentation_style',
  'mode',
  'win_mode'
]);

const removableTrackingParams = new Set([
  'mys_campaign',
  'mys_medium',
  'mys_source'
]);

const actHostGameBizPathPatterns = [
  /^\/ys\//,
  /^\/sr\//,
  /^\/zzz\//,
  /^\/puzzle\/(?:bh3|hkrpg)\//,
  /^\/miliastra_wonderland\//,
  /^\/app\/mihoyo-zzz-game-record\//,
  /^\/bbs\/event\/doujin-collect\//
];

function isTrackingParam(name) {
  return name.startsWith('utm_') || removableTrackingParams.has(name);
}

function isRedundantGameBiz(url) {
  const hostname = url.hostname.toLowerCase();
  const pathname = url.pathname.toLowerCase();
  if (hostname === 'act.mihoyo.com') {
    return actHostGameBizPathPatterns.some(pattern => pattern.test(pathname));
  }
  return hostname === 'webstatic.mihoyo.com' && pathname.includes('/bbs/event/live/');
}

function shouldRemoveQueryParam(url, name, value) {
  const normalizedName = name.toLowerCase();
  if (isTrackingParam(normalizedName) || removableContextParams.has(normalizedName)) return true;
  if (
    url.hostname.toLowerCase() === 'y.qq.com'
    && url.pathname.toLowerCase().startsWith('/forest/')
    && ['adtag', 'channelid'].includes(normalizedName)
  ) {
    return true;
  }
  if (
    url.hostname.toLowerCase() === 'm.kugou.com'
    && url.pathname.toLowerCase() === '/ssr/musicip/ip'
    && ['ssr_header_param', 'ssr_url_param', 'ishidetitlebar'].includes(normalizedName)
  ) {
    return true;
  }
  if (normalizedName === 'game_biz') return isRedundantGameBiz(url);
  if (
    normalizedName === 'act_id' &&
    url.hostname.toLowerCase() === 'webstatic.mihoyo.com' &&
    url.pathname.toLowerCase().includes('/bbs-event-contribute/') &&
    url.searchParams.get('id') === value
  ) {
    return true;
  }
  return false;
}

function normalizeHash(hash) {
  if (!hash) return '';
  const rawHash = hash.slice(1);
  const questionIndex = rawHash.indexOf('?');
  const ampersandIndex = questionIndex < 0 ? rawHash.search(/&(?=[^=&?#]+=)/) : -1;
  const splitIndex = questionIndex >= 0 ? questionIndex : ampersandIndex;
  if (splitIndex < 0) return hash;

  const route = rawHash.slice(0, splitIndex);
  const rawParams = rawHash.slice(splitIndex + 1).replace(/^&/, '');
  const params = new URLSearchParams(rawParams);
  for (const [name] of [...params.entries()]) {
    const normalizedName = name.toLowerCase();
    if (isTrackingParam(normalizedName) || removableContextParams.has(normalizedName)) {
      params.delete(name);
    }
  }

  const query = params.toString();
  return `#${route}${query ? `?${query}` : ''}`;
}

export function normalizeStoredEventUrl(rawUrl) {
  try {
    const cleaned = String(rawUrl || '')
      .trim()
      .replace(/&amp;/g, '&')
      .replace(/[.,;!?]$/, '');
    const url = new URL(cleaned);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;

    for (const [name, value] of [...url.searchParams.entries()]) {
      if (shouldRemoveQueryParam(url, name, value)) url.searchParams.delete(name);
    }
    if ([...url.searchParams].length === 0) url.search = '';
    url.hash = normalizeHash(url.hash);
    return url.toString();
  } catch {
    return null;
  }
}
