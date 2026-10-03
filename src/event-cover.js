import { GAME_META, safeCoverUrl, safeScreenshotUrl } from './event-domain.js';

const BUILD_COVER_VERSION = typeof __SCREENSHOT_VERSION__ === 'string'
  ? __SCREENSHOT_VERSION__
  : '';

export function eventImageCandidates(event, version = BUILD_COVER_VERSION) {
  const safeCover = safeCoverUrl(event?.coverUrl);
  const normalizedVersion = String(version || '').trim();
  const cover = safeCover?.startsWith('/') && normalizedVersion
    ? `${safeCover}?v=${encodeURIComponent(normalizedVersion)}`
    : safeCover;
  const source = safeCoverUrl(event?.coverSourceUrl);
  const remoteSource = source && !source.startsWith('/') ? source : null;
  const screenshot = event?.status !== '已失效' || cover || remoteSource
    ? safeScreenshotUrl(event?.id, version)
    : null;
  const gameCover = GAME_META[event?.gameKey]?.cover || GAME_META.all.cover;
  return [...new Set([cover, remoteSource, screenshot, gameCover].filter(Boolean))];
}

export function setEventImage(image, event) {
  const candidates = eventImageCandidates(event);
  let index = 0;
  const showCandidate = () => {
    image.onerror = index < candidates.length - 1
      ? () => { index += 1; showCandidate(); }
      : null;
    image.referrerPolicy = 'no-referrer';
    image.src = candidates[index];
  };
  showCandidate();
}
