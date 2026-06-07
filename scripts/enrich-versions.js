import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const eventsPath = path.join(__dirname, '..', 'src', 'events.json');
const events = JSON.parse(fs.readFileSync(eventsPath, 'utf8'));

// Helper to convert YYYY.MM.DD to a Date object
function parseDate(dateStr) {
  const parts = dateStr.split('.');
  return new Date(parts[0], parts[1] - 1, parts[2]);
}

// Version maps with release dates (as Date objects)
const versionMaps = {
  ys: [
    { version: 'v1.0', date: '2020.09.28' },
    { version: 'v1.1', date: '2020.11.11' },
    { version: 'v1.2', date: '2020.12.23' },
    { version: 'v1.3', date: '2021.02.03' },
    { version: 'v1.4', date: '2021.03.17' },
    { version: 'v1.5', date: '2021.04.28' },
    { version: 'v1.6', date: '2021.06.09' },
    { version: 'v2.0', date: '2021.07.21' },
    { version: 'v2.1', date: '2021.09.01' },
    { version: 'v2.2', date: '2021.10.13' },
    { version: 'v2.3', date: '2021.11.24' },
    { version: 'v2.4', date: '2022.01.05' },
    { version: 'v2.5', date: '2022.02.16' },
    { version: 'v2.6', date: '2022.03.30' },
    { version: 'v2.7', date: '2022.05.31' },
    { version: 'v2.8', date: '2022.07.13' },
    { version: 'v3.0', date: '2022.08.24' },
    { version: 'v3.1', date: '2022.09.28' },
    { version: 'v3.2', date: '2022.11.02' },
    { version: 'v3.3', date: '2022.12.07' },
    { version: 'v3.4', date: '2023.01.18' },
    { version: 'v3.5', date: '2023.03.01' },
    { version: 'v3.6', date: '2023.04.12' },
    { version: 'v3.7', date: '2023.05.24' },
    { version: 'v3.8', date: '2023.07.05' },
    { version: 'v4.0', date: '2023.08.16' },
    { version: 'v4.1', date: '2023.09.27' },
    { version: 'v4.2', date: '2023.11.08' },
    { version: 'v4.3', date: '2023.12.20' },
    { version: 'v4.4', date: '2024.01.31' },
    { version: 'v4.5', date: '2024.03.13' },
    { version: 'v4.6', date: '2024.04.24' },
    { version: 'v4.7', date: '2024.06.05' },
    { version: 'v4.8', date: '2024.07.17' },
    { version: 'v5.0', date: '2024.08.28' },
    { version: 'v5.1', date: '2024.10.09' },
    { version: 'v5.2', date: '2024.11.20' },
    { version: 'v5.3', date: '2025.01.01' },
    { version: 'v5.4', date: '2025.02.12' },
    { version: 'v5.5', date: '2025.03.26' },
    { version: 'v5.6', date: '2025.05.07' },
    { version: 'v5.7', date: '2025.06.18' },
    { version: 'v5.8', date: '2025.07.30' },
    { version: 'v6.0', date: '2025.09.10' },
    { version: 'v6.1', date: '2025.10.22' },
    { version: 'v6.2', date: '2025.12.03' },
    { version: 'v6.3', date: '2026.01.14' },
    { version: 'v6.4', date: '2026.02.25' },
    { version: 'v6.5', date: '2026.04.08' },
    { version: 'v6.6', date: '2026.05.20' },
    { version: 'v6.7', date: '2026.07.01' }
  ],
  sr: [
    { version: 'v1.0', date: '2023.04.26' },
    { version: 'v1.1', date: '2023.06.07' },
    { version: 'v1.2', date: '2023.07.19' },
    { version: 'v1.3', date: '2023.08.30' },
    { version: 'v1.4', date: '2023.10.11' },
    { version: 'v1.5', date: '2023.11.15' },
    { version: 'v1.6', date: '2023.12.27' },
    { version: 'v2.0', date: '2024.02.06' },
    { version: 'v2.1', date: '2024.03.27' },
    { version: 'v2.2', date: '2024.05.08' },
    { version: 'v2.3', date: '2024.06.19' },
    { version: 'v2.4', date: '2024.07.31' },
    { version: 'v2.5', date: '2024.09.11' },
    { version: 'v2.6', date: '2024.10.23' },
    { version: 'v2.7', date: '2024.12.04' },
    { version: 'v3.0', date: '2025.01.15' },
    { version: 'v3.1', date: '2025.02.27' },
    { version: 'v3.2', date: '2025.04.10' },
    { version: 'v3.3', date: '2025.05.21' },
    { version: 'v3.4', date: '2025.07.03' },
    { version: 'v3.5', date: '2025.08.14' },
    { version: 'v3.6', date: '2025.09.25' },
    { version: 'v3.7', date: '2025.11.06' },
    { version: 'v3.8', date: '2025.12.18' },
    { version: 'v4.0', date: '2026.02.13' }, // Corrected from 2026.01.30
    { version: 'v4.1', date: '2026.03.25' }, // Corrected from 2026.03.12
    { version: 'v4.2', date: '2026.04.22' },
    { version: 'v4.3', date: '2026.06.01' },
    { version: 'v4.4', date: '2026.07.15' }
  ],
  zzz: [
    { version: 'v1.0', date: '2024.07.04' },
    { version: 'v1.1', date: '2024.08.14' },
    { version: 'v1.2', date: '2024.09.25' },
    { version: 'v1.3', date: '2024.11.06' },
    { version: 'v1.4', date: '2024.12.18' },
    { version: 'v1.5', date: '2025.01.22' },
    { version: 'v1.6', date: '2025.03.05' },
    { version: 'v1.7', date: '2025.04.23' },
    { version: 'v2.0', date: '2025.06.06' },
    { version: 'v2.1', date: '2025.07.17' },
    { version: 'v2.2', date: '2025.09.03' },
    { version: 'v2.3', date: '2025.10.15' },
    { version: 'v2.4', date: '2025.11.26' },
    { version: 'v2.5', date: '2026.01.07' },
    { version: 'v2.6', date: '2026.02.18' },
    { version: 'v2.7', date: '2026.04.01' },
    { version: 'v2.8', date: '2026.05.06' },
    { version: 'v3.0', date: '2026.06.17' }
  ]
};

// Convert dates in versionMaps to Date objects
Object.keys(versionMaps).forEach(game => {
  versionMaps[game].forEach(v => {
    v.dateObj = parseDate(v.date);
  });
  // Sort descending to find the highest patch date that is <= event date
  versionMaps[game].sort((a, b) => b.dateObj - a.dateObj);
});

// Map event to version
events.forEach(evt => {
  if (evt.gameKey === 'all' || evt.gameKey === 'gen') {
    evt.version = '通用';
    return;
  }
  if (evt.gameKey === 'bh3') {
    if (evt.id === 'bh3-1') evt.version = 'v8.8';
    else if (evt.id === 'bh3-2') evt.version = 'v7.8';
    else if (evt.id === 'bh3-3') evt.version = 'v7.0';
    else evt.version = '通用';
    return;
  }

  // 1. Semantic check: Extract version number from title or tags if explicitly mentioned (e.g., "3.0回归" -> "v3.0")
  const titleMatch = evt.title.match(/(?<!\d)([1-9]\.\d)(?!\d)/);
  if (titleMatch) {
    evt.version = 'v' + titleMatch[1];
    return;
  }
  
  for (const tag of evt.tags) {
    const tagMatch = tag.match(/(?<!\d)([1-9]\.\d)(?!\d)/);
    if (tagMatch) {
      evt.version = 'v' + tagMatch[1];
      return;
    }
  }

  // 2. Date matching fallback
  const gamePatches = versionMaps[evt.gameKey];
  if (!gamePatches) {
    evt.version = '通用';
    return;
  }
  
  const evtDate = parseDate(evt.date);
  
  // Find the first patch where patch.dateObj <= evtDate
  const match = gamePatches.find(p => p.dateObj <= evtDate);
  if (match) {
    evt.version = match.version;
  } else {
    // If the event is older than version 1.0 release, it's a pre-release event
    evt.version = gamePatches[gamePatches.length - 1].version + ' 预热';
  }
});

// Save back
fs.writeFileSync(eventsPath, JSON.stringify(events, null, 2), 'utf8');
console.log('Successfully enriched version data for', events.length, 'events.');
