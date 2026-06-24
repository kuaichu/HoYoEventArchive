import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { canonicalizeEventUrl } from './crawler-rules.js';

const currentPath = new URL('../src/events.json', import.meta.url);

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

const baseKeys = new Set(readBaseEvents().map(eventKey));
const currentEvents = JSON.parse(fs.readFileSync(currentPath, 'utf8'));
const addedEvents = currentEvents.filter(event => !baseKeys.has(eventKey(event)));

if (addedEvents.length === 0) {
  process.exit(0);
}

const maxLines = Number.parseInt(process.env.EVENT_UPDATE_SUMMARY_MAX_LINES || '20', 10);
const lines = addedEvents.slice(0, maxLines).map(event => {
  const version = event.version && event.version !== '通用' ? ` ${event.version}` : '';
  return `${event.game || event.gameKey}${version} 新增活动: ${event.title}`;
});

if (addedEvents.length > maxLines) {
  lines.push(`...and ${addedEvents.length - maxLines} more`);
}

console.log(lines.join('\n'));
