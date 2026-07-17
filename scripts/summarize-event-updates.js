import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { canonicalizeEventUrl } from './crawler-rules.js';

const currentPath = new URL('../src/events.json', import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const notificationFields = [
  'title',
  'url',
  'version',
  'startDate',
  'endDate',
  'reward',
  'rewards'
];

function readBaseEvents() {
  try {
    const raw = execFileSync('git', ['show', 'HEAD:src/events.json'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    });
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function eventKey(event) {
  return canonicalizeEventUrl(event.url || '');
}

function notificationSignature(event) {
  return JSON.stringify(
    Object.fromEntries(notificationFields.map(field => [field, event?.[field] ?? null]))
  );
}

export function collectEventUpdates(baseEvents, currentEvents, includeIds = new Set()) {
  const baseByKey = new Map(baseEvents.map(event => [eventKey(event), event]));
  const addedEvents = [];
  const updatedEvents = [];

  for (const event of currentEvents) {
    const baseEvent = baseByKey.get(eventKey(event));
    if (!baseEvent) {
      addedEvents.push(event);
    } else if (notificationSignature(baseEvent) !== notificationSignature(event)) {
      updatedEvents.push(event);
    }
  }

  const selectedIds = new Set([...addedEvents, ...updatedEvents].map(event => event.id));
  for (const event of currentEvents) {
    if (includeIds.has(event.id) && !selectedIds.has(event.id)) {
      updatedEvents.push(event);
      selectedIds.add(event.id);
    }
  }

  return {
    addedEvents,
    updatedEvents,
    notificationEvents: [...addedEvents, ...updatedEvents]
  };
}

export function main() {
  const outputJson = process.argv.includes('--json');
  const currentEvents = JSON.parse(fs.readFileSync(currentPath, 'utf8'));
  const includeIds = new Set(
    String(process.env.EVENT_UPDATE_INCLUDE_IDS || '')
      .split(',')
      .map(value => value.trim())
      .filter(Boolean)
  );
  const updates = collectEventUpdates(readBaseEvents(), currentEvents, includeIds);

  if (outputJson) {
    console.log(JSON.stringify(updates.notificationEvents, null, 2));
    return;
  }

  if (updates.notificationEvents.length === 0) return;

  const maxLines = Number.parseInt(process.env.EVENT_UPDATE_SUMMARY_MAX_LINES || '20', 10);
  const addedIds = new Set(updates.addedEvents.map(event => event.id));
  const lines = updates.notificationEvents.slice(0, maxLines).map(event => {
    const version = event.version && event.version !== '通用' ? ` ${event.version}` : '';
    const label = addedIds.has(event.id) ? '新增活动' : '活动更新';
    return `${event.game || event.gameKey}${version} ${label}: ${event.title}`;
  });

  if (updates.notificationEvents.length > maxLines) {
    lines.push(`...and ${updates.notificationEvents.length - maxLines} more`);
  }

  console.log(lines.join('\n'));
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main();
}
