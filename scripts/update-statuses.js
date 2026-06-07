import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const eventsPath = path.join(__dirname, '..', 'src', 'events.json');

function updateStatuses() {
  const events = JSON.parse(fs.readFileSync(eventsPath, 'utf8'));
  console.log(`Loaded ${events.length} events for status updates.`);

  // Current date boundary: 2026.06.07
  let endedCount = 0;
  let activeCount = 0;

  const updatedEvents = events.map(e => {
    // If it's already 404/expired, keep it
    if (e.status === '已失效') {
      return e;
    }

    // Check if it's a permanent resource
    const isPermanent = 
      e.title.includes('WIKI') || 
      e.title.includes('指南') || 
      e.title.includes('工具') || 
      e.title.includes('概念站') || 
      e.title.includes('自助') ||
      e.tags.includes('资料站') ||
      e.type === '资料站';

    if (isPermanent) {
      // Keep available or requires login
      return e;
    }

    // Parse date: e.g. "2026.04.22" -> year: 2026, month: 4
    const parts = e.date.split('.');
    const year = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10);
    const day = parseInt(parts[2], 10);

    // Active event condition: very recent (within last 15 days, i.e., from May 23, 2026 onwards)
    // Current date is 2026-06-07
    let isRecent = false;
    if (year === 2026) {
      if (month === 6) {
        isRecent = true; // Any event in June 2026 is active
      } else if (month === 5 && day >= 23) {
        isRecent = true; // Events in late May 2026 are active
      }
    }

    if (!isRecent) {
      // Mark as ended
      e.status = '已结束';
      endedCount++;
    } else {
      activeCount++;
    }

    return e;
  });

  fs.writeFileSync(eventsPath, JSON.stringify(updatedEvents, null, 2), 'utf8');
  console.log(`Status update complete.`);
  console.log(`- Marked ${endedCount} historical events as '已结束'`);
  console.log(`- Kept ${activeCount} recent events as '可访问/需登录'`);
}

updateStatuses();
