export const VERSION_PATTERN = /^(?:v\d+\.\d+|公测前|通用|待确认)$/;
export const NUMERIC_VERSION_PATTERN = /^v\d+\.\d+$/;

export const VERSION_ALIASES = Object.freeze({
  '月之一': 'v6.0',
  '月之二': 'v6.1',
  '月之三': 'v6.2',
  '月之四': 'v6.3',
  '月之五': 'v6.4',
  '月之六': 'v6.5',
  '月之七': 'v6.6',
  '月之八': 'v6.7'
});

export const VERSION_RELEASE_DATES = Object.freeze({
  ys: Object.freeze([
    ['v1.0', '2020.09.28'], ['v1.1', '2020.11.11'], ['v1.2', '2020.12.23'],
    ['v1.3', '2021.02.03'], ['v1.4', '2021.03.17'], ['v1.5', '2021.04.28'],
    ['v1.6', '2021.06.09'], ['v2.0', '2021.07.21'], ['v2.1', '2021.09.01'],
    ['v2.2', '2021.10.13'], ['v2.3', '2021.11.24'], ['v2.4', '2022.01.05'],
    ['v2.5', '2022.02.16'], ['v2.6', '2022.03.30'], ['v2.7', '2022.05.31'],
    ['v2.8', '2022.07.13'], ['v3.0', '2022.08.24'], ['v3.1', '2022.09.28'],
    ['v3.2', '2022.11.02'], ['v3.3', '2022.12.07'], ['v3.4', '2023.01.18'],
    ['v3.5', '2023.03.01'], ['v3.6', '2023.04.12'], ['v3.7', '2023.05.24'],
    ['v3.8', '2023.07.05'], ['v4.0', '2023.08.16'], ['v4.1', '2023.09.27'],
    ['v4.2', '2023.11.08'], ['v4.3', '2023.12.20'], ['v4.4', '2024.01.31'],
    ['v4.5', '2024.03.13'], ['v4.6', '2024.04.24'], ['v4.7', '2024.06.05'],
    ['v4.8', '2024.07.17'], ['v5.0', '2024.08.28'], ['v5.1', '2024.10.09'],
    ['v5.2', '2024.11.20'], ['v5.3', '2025.01.01'], ['v5.4', '2025.02.12'],
    ['v5.5', '2025.03.26'], ['v5.6', '2025.05.07'], ['v5.7', '2025.06.18'],
    ['v5.8', '2025.07.30'], ['v6.0', '2025.09.10'], ['v6.1', '2025.10.22'],
    ['v6.2', '2025.12.03'], ['v6.3', '2026.01.14'], ['v6.4', '2026.02.25'],
    ['v6.5', '2026.04.08'], ['v6.6', '2026.05.20'], ['v6.7', '2026.07.01']
  ]),
  sr: Object.freeze([
    ['v1.0', '2023.04.26'], ['v1.1', '2023.06.07'], ['v1.2', '2023.07.19'],
    ['v1.3', '2023.08.30'], ['v1.4', '2023.10.11'], ['v1.5', '2023.11.15'],
    ['v1.6', '2023.12.27'], ['v2.0', '2024.02.06'], ['v2.1', '2024.03.27'],
    ['v2.2', '2024.05.08'], ['v2.3', '2024.06.19'], ['v2.4', '2024.07.31'],
    ['v2.5', '2024.09.10'], ['v2.6', '2024.10.23'], ['v2.7', '2024.12.04'],
    ['v3.0', '2025.01.15'], ['v3.1', '2025.02.26'], ['v3.2', '2025.04.09'],
    ['v3.3', '2025.05.21'], ['v3.4', '2025.07.02'], ['v3.5', '2025.08.13'],
    ['v3.6', '2025.09.24'], ['v3.7', '2025.11.05'], ['v3.8', '2025.12.17'],
    ['v4.0', '2026.02.13'], ['v4.1', '2026.03.25'], ['v4.2', '2026.04.22'],
    ['v4.3', '2026.06.01'], ['v4.4', '2026.07.15']
  ]),
  zzz: Object.freeze([
    ['v1.0', '2024.07.04'], ['v1.1', '2024.08.14'], ['v1.2', '2024.09.25'],
    ['v1.3', '2024.11.06'], ['v1.4', '2024.12.18'], ['v1.5', '2025.01.22'],
    ['v1.6', '2025.03.05'], ['v1.7', '2025.04.23'], ['v2.0', '2025.06.06'],
    ['v2.1', '2025.07.17'], ['v2.2', '2025.09.03'], ['v2.3', '2025.10.15'],
    ['v2.4', '2025.11.26'], ['v2.5', '2026.01.07'], ['v2.6', '2026.02.18'],
    ['v2.7', '2026.04.01'], ['v2.8', '2026.05.06'], ['v3.0', '2026.06.17'],
    ['v3.1', '2026.07.29']
  ])
});

function comparableDate(date) {
  const match = String(date || '').match(/^(\d{4})[.-](\d{2})[.-](\d{2})$/);
  if (!match) return null;
  const value = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(value) ? null : value;
}

function flattenSources(sources) {
  return sources.flatMap(source => Array.isArray(source) ? source : [source]);
}

const GAME_TEXT_MARKERS = Object.freeze({
  ys: /原神/,
  sr: /星穹铁道|崩坏[：:]?星穹铁道/,
  zzz: /绝区零/,
  bh3: /崩坏3|崩坏三/
});

function hasConflictingGameMarker(text, gameKey) {
  const normalized = String(text || '');
  return Object.entries(GAME_TEXT_MARKERS).some(([key, marker]) => (
    key !== gameKey && marker.test(normalized) && !GAME_TEXT_MARKERS[gameKey]?.test(normalized)
  ));
}

export function isValidVersion(version) {
  return VERSION_PATTERN.test(String(version || '').trim());
}

export function isNumericVersion(version) {
  return NUMERIC_VERSION_PATTERN.test(String(version || '').trim());
}

export function extractExplicitVersion(...sources) {
  for (const source of flattenSources(sources)) {
    const text = String(source || '');
    if (!text) continue;

    for (const [alias, version] of Object.entries(VERSION_ALIASES)) {
      if (text.includes(alias)) return version;
    }

    const contextual = text.match(/(?<!\d)(?:v|ver\.?\s*)?([1-9]\d*\.\d+)\s*版本/i);
    if (contextual) return `v${contextual[1]}`;

    const prefixed = text.match(/(?<![\d.])v([1-9]\d*\.\d+)(?![\d.])/i);
    if (prefixed) return `v${prefixed[1]}`;
  }

  return undefined;
}

export function inferVersionFromDate(gameKey, date) {
  const releases = VERSION_RELEASE_DATES[gameKey];
  const eventDate = comparableDate(date);
  if (!releases || eventDate === null) return undefined;

  const firstRelease = comparableDate(releases[0][1]);
  if (eventDate < firstRelease) return '公测前';

  for (let index = releases.length - 1; index >= 0; index--) {
    if (eventDate >= comparableDate(releases[index][1])) return releases[index][0];
  }

  return undefined;
}

export function classifyEventVersion({
  gameKey,
  title,
  sourcePostTitle,
  tags,
  description,
  body,
  date,
  currentVersion,
  allowDateFallback = false,
  preserveCurrentSpecial = false
} = {}) {
  const normalizedCurrent = String(currentVersion || '').trim();
  if (preserveCurrentSpecial && ['公测前', '通用'].includes(normalizedCurrent)) {
    return normalizedCurrent;
  }

  const trustedExplicitVersion = extractExplicitVersion(title, sourcePostTitle, tags);
  const descriptiveExplicitVersion = extractExplicitVersion(
    hasConflictingGameMarker(description, gameKey) ? undefined : description,
    hasConflictingGameMarker(body, gameKey) ? undefined : body
  );
  const explicitVersion = trustedExplicitVersion || descriptiveExplicitVersion;
  if (explicitVersion) return explicitVersion;

  if (isValidVersion(normalizedCurrent) && normalizedCurrent !== '待确认') return normalizedCurrent;

  if (allowDateFallback) {
    const dateVersion = inferVersionFromDate(gameKey, date);
    if (dateVersion) return dateVersion;
  }

  return '待确认';
}
