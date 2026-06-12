const permanentResourcePathFragments = [
  '/bbs/event/bbs-lineup-',
  '/event/character-builder/',
  '/event/cultivation-tool/',
  '/app/community-game-records/',
  '/app/interactive-map/'
];

const identityQueryParams = new Set([
  'act_id',
  'activity_id',
  'event_id',
  'id',
  'page_id',
  'page_sn',
  'sn'
]);

export function isPermanentResourceUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    const path = url.pathname.toLowerCase();
    return permanentResourcePathFragments.some(fragment => path.includes(fragment));
  } catch {
    return false;
  }
}

export function canonicalizeEventUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    const identityParams = [...url.searchParams.entries()]
      .filter(([name]) => identityQueryParams.has(name.toLowerCase()))
      .sort(([nameA, valueA], [nameB, valueB]) => {
        return nameA.localeCompare(nameB) || valueA.localeCompare(valueB);
      });

    const path = url.pathname.replace(/\/$/, '');
    const query = new URLSearchParams(identityParams).toString();
    return `${url.origin}${path}${query ? `?${query}` : ''}`;
  } catch {
    return rawUrl.split('#')[0].replace(/\/$/, '');
  }
}

export function getAnnouncementDate(item) {
  const rawTimestamp = item?.news_meta?.start_at_sec || item?.post?.created_at;
  const seconds = Number.parseInt(rawTimestamp, 10);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return null;
  }

  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date(seconds * 1000));

  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}.${values.month}.${values.day}`;
}
