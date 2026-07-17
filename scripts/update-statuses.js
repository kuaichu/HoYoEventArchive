import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  currentShanghaiDate,
  resolveEventStatus,
  validateEventCollection
} from '../src/event-domain.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const eventsPath = path.join(__dirname, '..', 'src', 'events.json');

export function updateStatuses(todayShanghai = currentShanghaiDate()) {
  const events = JSON.parse(fs.readFileSync(eventsPath, 'utf8'));
  console.log(`Loaded ${events.length} events for status updates.`);

  const existingIssues = validateEventCollection(events);
  if (existingIssues.length > 0) {
    throw new Error(`Existing event data is invalid:\n${existingIssues.join('\n')}`);
  }

  let endedCount = 0;
  let changedCount = 0;

  const updatedEvents = events.map(e => {
    const nextStatus = resolveEventStatus(e, todayShanghai);
    if (nextStatus !== e.status) {
      changedCount++;
      if (nextStatus === '已结束') endedCount++;
      return { ...e, status: nextStatus };
    }

    return e;
  });

  const validationIssues = validateEventCollection(updatedEvents);
  if (validationIssues.length > 0) {
    throw new Error(`Event validation failed:\n${validationIssues.join('\n')}`);
  }

  if (changedCount > 0) {
    fs.writeFileSync(eventsPath, `${JSON.stringify(updatedEvents, null, 2)}\n`, 'utf8');
    console.log('Status update complete.');
    console.log(`- Marked ${endedCount} event(s) as '已结束' from explicit endDate values.`);
  } else {
    console.log(`No status changes required for ${todayShanghai}.`);
  }

  return { changedCount, endedCount, events: updatedEvents };
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  try {
    updateStatuses();
  } catch (error) {
    console.error('Status update failed:', error);
    process.exitCode = 1;
  }
}
