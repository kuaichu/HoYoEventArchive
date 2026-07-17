import { EVENT_FIELDS, normalizeEvent } from './event-domain.js';

export const EVENT_STORAGE_VERSION = 2;

export function createEmptyEventOverlay() {
  return {
    version: EVENT_STORAGE_VERSION,
    overrides: {},
    additions: [],
    deletedIds: []
  };
}

function cloneOverlay(overlay) {
  return {
    version: EVENT_STORAGE_VERSION,
    overrides: Object.fromEntries(
      Object.entries(overlay?.overrides || {}).map(([id, patch]) => [id, { ...patch }])
    ),
    additions: (overlay?.additions || []).map(event => ({ ...event, tags: [...event.tags] })),
    deletedIds: [...(overlay?.deletedIds || [])]
  };
}

function eventPatch(baseEvent, nextEvent) {
  const patch = {};
  for (const field of EVENT_FIELDS) {
    if (field === 'id') continue;
    if (JSON.stringify(baseEvent[field]) !== JSON.stringify(nextEvent[field])) {
      patch[field] = nextEvent[field] === undefined ? null : nextEvent[field];
    }
  }
  return patch;
}

function normalizeVersionedOverlay(value, baseEvents) {
  const overlay = createEmptyEventOverlay();
  const baseById = new Map(baseEvents.map(event => [event.id, event]));

  if (value?.overrides && typeof value.overrides === 'object' && !Array.isArray(value.overrides)) {
    for (const [id, patch] of Object.entries(value.overrides)) {
      const baseEvent = baseById.get(id);
      if (!baseEvent || !patch || typeof patch !== 'object') continue;
      const normalized = normalizeEvent({ ...baseEvent, ...patch }, baseEvent);
      if (!normalized) continue;
      const cleanPatch = eventPatch(baseEvent, normalized);
      if (Object.keys(cleanPatch).length > 0) overlay.overrides[id] = cleanPatch;
    }
  }

  if (Array.isArray(value?.additions)) {
    const additionsById = new Map();
    for (const candidate of value.additions) {
      const event = normalizeEvent(candidate);
      if (event && !baseById.has(event.id)) additionsById.set(event.id, event);
    }
    overlay.additions = [...additionsById.values()];
  }

  if (Array.isArray(value?.deletedIds)) {
    overlay.deletedIds = [...new Set(
      value.deletedIds.filter(id => typeof id === 'string' && baseById.has(id))
    )];
  }

  return overlay;
}

function migrateLegacyArray(rows, baseEvents) {
  const overlay = createEmptyEventOverlay();
  const baseById = new Map(baseEvents.map(event => [event.id, event]));
  const additionsById = new Map();

  for (const row of rows) {
    if (baseById.has(row?.id)) continue;
    const normalized = normalizeEvent(row);
    if (normalized) additionsById.set(normalized.id, normalized);
  }

  overlay.additions = [...additionsById.values()];

  return overlay;
}

export function parsePersistedEventState(raw, baseEvents) {
  if (!raw) {
    return { overlay: createEmptyEventOverlay(), migrated: false, error: null };
  }

  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return {
        overlay: migrateLegacyArray(parsed, baseEvents),
        migrated: true,
        error: null
      };
    }
    if (parsed?.version === EVENT_STORAGE_VERSION) {
      return {
        overlay: normalizeVersionedOverlay(parsed, baseEvents),
        migrated: false,
        error: null
      };
    }
    return {
      overlay: createEmptyEventOverlay(),
      migrated: false,
      error: 'Unsupported event storage format'
    };
  } catch (error) {
    return {
      overlay: createEmptyEventOverlay(),
      migrated: false,
      error: error.message
    };
  }
}

export function mergeEventState(baseEvents, overlay) {
  const normalizedOverlay = normalizeVersionedOverlay(overlay, baseEvents);
  const deleted = new Set(normalizedOverlay.deletedIds);
  const mergedBase = baseEvents
    .filter(event => !deleted.has(event.id))
    .map(event => normalizeEvent({
      ...event,
      ...(normalizedOverlay.overrides[event.id] || {})
    }, event))
    .filter(Boolean);

  return [...mergedBase, ...normalizedOverlay.additions];
}

export function upsertEventInOverlay(overlay, baseEvents, event) {
  const next = cloneOverlay(overlay);
  const baseEvent = baseEvents.find(candidate => candidate.id === event?.id);
  const normalized = normalizeEvent(event, baseEvent);
  if (!normalized) throw new Error('Event has an invalid ID');

  next.deletedIds = next.deletedIds.filter(id => id !== normalized.id);
  if (baseEvent) {
    const patch = eventPatch(baseEvent, normalized);
    if (Object.keys(patch).length > 0) next.overrides[normalized.id] = patch;
    else delete next.overrides[normalized.id];
    next.additions = next.additions.filter(candidate => candidate.id !== normalized.id);
  } else {
    const index = next.additions.findIndex(candidate => candidate.id === normalized.id);
    if (index >= 0) next.additions[index] = normalized;
    else next.additions.push(normalized);
  }

  return next;
}

export function deleteEventFromOverlay(overlay, baseEvents, eventId) {
  const next = cloneOverlay(overlay);
  const isBaseEvent = baseEvents.some(event => event.id === eventId);

  delete next.overrides[eventId];
  next.additions = next.additions.filter(event => event.id !== eventId);
  if (isBaseEvent && !next.deletedIds.includes(eventId)) next.deletedIds.push(eventId);

  return next;
}

export function serializeEventState(overlay) {
  return JSON.stringify(cloneOverlay(overlay));
}

export function nextEventId(gameKey, baseEvents, overlay) {
  const prefix = `${gameKey}-`;
  const usedIds = new Set([
    ...baseEvents.map(event => event.id),
    ...(overlay?.additions || []).map(event => event.id),
    ...(overlay?.deletedIds || [])
  ]);
  let maxNumber = 0;

  for (const id of usedIds) {
    if (!id.startsWith(prefix)) continue;
    const suffix = Number.parseInt(id.slice(prefix.length), 10);
    if (Number.isInteger(suffix) && suffix > maxNumber) maxNumber = suffix;
  }

  return `${prefix}${maxNumber + 1}`;
}
