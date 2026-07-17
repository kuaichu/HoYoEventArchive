import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { classifyEventVersion, isValidVersion } from './version-classification.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const eventsPath = path.join(__dirname, '..', 'src', 'events.json');
const events = JSON.parse(fs.readFileSync(eventsPath, 'utf8'));

for (const event of events) {
  if (event.gameKey === 'all' || event.gameKey === 'gen') {
    event.version = '通用';
    continue;
  }

  event.version = classifyEventVersion({
    gameKey: event.gameKey,
    title: event.title,
    sourcePostTitle: event.sourcePostTitle,
    tags: event.tags,
    description: event.description,
    date: event.date,
    currentVersion: event.version,
    allowDateFallback: !isValidVersion(event.version) || event.version === '待确认',
    preserveCurrentSpecial: true
  });
}

fs.writeFileSync(eventsPath, `${JSON.stringify(events, null, 2)}\n`, 'utf8');
console.log('Successfully enriched version data for', events.length, 'events.');
