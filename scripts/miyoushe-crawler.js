import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import puppeteer from 'puppeteer';
import {
  canonicalizeEventUrl,
  classifyEventType,
  getAnnouncementDate,
  isPermanentResourceUrl
} from './crawler-rules.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const eventsPath = path.join(__dirname, '..', 'src', 'events.json');
const events = JSON.parse(fs.readFileSync(eventsPath, 'utf8'));

const games = [
  { gids: 2, name: '原神', gameKey: 'ys', forumId: 28 },
  { gids: 6, name: '星穹铁道', gameKey: 'sr', forumId: 53 },
  { gids: 8, name: '绝区零', gameKey: 'zzz', forumId: 58 },
  { gids: 1, name: '崩坏3', gameKey: 'bh3', forumId: 6 }
];

async function runCrawler() {
  console.log('Starting automated Miyoushe web event crawler...\n');
  const knownEventUrls = new Set(events.map(event => canonicalizeEventUrl(event.url)));
  
  // Track maximum event ID suffixes to prevent duplicates
  const maxNums = {};
  games.forEach(g => {
    const gameEvents = events.filter(e => e.gameKey === g.gameKey);
    let maxNum = 0;
    gameEvents.forEach(e => {
      const parts = e.id.split('-');
      if (parts.length === 2) {
        const num = parseInt(parts[1], 10);
        if (!isNaN(num) && num > maxNum) {
          maxNum = num;
        }
      }
    });
    maxNums[g.gameKey] = maxNum;
  });

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  let newEventsCount = 0;
  for (const game of games) {
    try {
      console.log(`>>> Fetching forum post list for game: ${game.name} (${game.gameKey.toUpperCase()})`);
      
      const pageSize = 30;
      const url = `https://bbs-api.miyoushe.com/post/wapi/getForumPostList?forum_id=${game.forumId}&is_good=false&is_top=false&last_id=&page_size=${pageSize}&sort_type=2`;
      
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Referer': 'https://www.miyoushe.com/'
        }
      });
      const json = await res.json();
      
      if (json.retcode !== 0 || !json.data || !json.data.list) {
        console.error(`Failed to fetch forum list for ${game.name}: retcode=${json.retcode}, message=${json.message}`);
        continue;
      }
      
      console.log(`Found total ${json.data.list.length} announcement posts for ${game.name}. Parsing details...`);
      
      for (const item of json.data.list) {
        const postId = item.post.post_id;
        const subject = item.post.subject;
        const structuredStr = item.post.structured_content;
        
        if (!structuredStr) continue;
        
        let ops = [];
        try {
          ops = JSON.parse(structuredStr);
        } catch (e) {
          continue;
        }
        
        if (!Array.isArray(ops)) continue;
        
        // Extract links from structured content
        const matches = [];
        ops.forEach(op => {
          if (op.attributes && op.attributes.link) {
            const link = op.attributes.link;
            if (link.includes('act.mihoyo.com') || link.includes('webstatic.mihoyo.com')) {
              matches.push(link);
            }
          }
        });
        
        // Process unique URLs found in this post
        const uniqueUrls = [...new Set(matches.map(u => u.replace(/&amp;/g, '&').replace(/[.,;!?]$/, '')))];
        
        for (const rawUrl of uniqueUrls) {
          // Exclude generic links like webstatic.mihoyo.com/common/ or static image resources
          if (rawUrl.includes('/common/') || rawUrl.match(/\.(png|jpg|jpeg|gif|svg)/i)) {
            continue;
          }

          if (isPermanentResourceUrl(rawUrl)) {
            console.log(`Skipping permanent resource linked by "${subject}": ${rawUrl}`);
            continue;
          }
          
          const cleanUrl = rawUrl;
          const canonicalUrl = canonicalizeEventUrl(cleanUrl);
          
          // Check if it already exists in the database
          if (knownEventUrls.has(canonicalUrl)) {
            continue;
          }
          
          console.log(`\n[NEW EVENT FOUND] Post: "${subject}"`);
          console.log(`Target Event URL: ${cleanUrl}`);
          
          // Scrape metadata using Puppeteer
          let eventTitle = subject;
          let eventDesc = '提瓦特/米游社官方网页活动。';
          
          const page = await browser.newPage();
          await page.setViewport({ width: 1280, height: 720 });
          
          try {
            await page.goto(cleanUrl, { waitUntil: 'networkidle2', timeout: 20000 });
            await new Promise(r => setTimeout(r, 2000));
            
            const pageData = await page.evaluate(() => {
              const title = document.title || '';
              const descEl = document.querySelector('meta[name="description"]') || 
                             document.querySelector('meta[property="og:description"]');
              const desc = descEl ? descEl.getAttribute('content') : '';
              return { title, desc };
            });
            
            if (pageData.title && pageData.title.trim().length > 3) {
              eventTitle = pageData.title.trim();
            }
            if (pageData.desc && pageData.desc.trim().length > 10) {
              eventDesc = pageData.desc.trim();
            }
          } catch (err) {
            console.warn(`Could not fetch details for ${cleanUrl}: ${err.message}. Using post subject.`);
          } finally {
            await page.close();
          }
          
          // Extract version info
          const combinedText = `${eventTitle} ${eventDesc}`;
          const versionRegex = /(?<!\d)([1-9]\.\d)(?!\d)/;
          const versionMatch = combinedText.match(versionRegex);
          const version = versionMatch ? 'v' + versionMatch[1] : '通用';
          
          // This is the announcement post date, not necessarily the page's launch date.
          const pubDate = getAnnouncementDate(item);
          if (!pubDate) {
            console.warn(`Skipping ${cleanUrl}: source post has no reliable publication time.`);
            continue;
          }
          
          const textToAnalyze = `${eventTitle} ${eventDesc}`.toLowerCase();
          const eventType = classifyEventType(textToAnalyze);
          
          // Generate new ID suffix safely
          maxNums[game.gameKey] += 1;
          const newId = `${game.gameKey}-${maxNums[game.gameKey]}`;
          
          // Assemble tags
          const tags = [];
          if (eventType !== '其他活动') tags.push(eventType);
          if (version !== '通用') tags.push(`${version}版本`);
          if (textToAnalyze.includes('原石') || textToAnalyze.includes('星琼') || textToAnalyze.includes('菲林')) {
            tags.push('游戏内奖励');
          }
          
          const newEvent = {
            id: newId,
            title: eventTitle,
            url: cleanUrl,
            game: game.name,
            gameKey: game.gameKey,
            type: eventType,
            status: '可访问',
            date: pubDate,
            dateType: 'announcement',
            sourcePostId: String(postId),
            sourcePostTitle: subject,
            tags: tags.length > 0 ? tags : ['网页活动'],
            version: version,
            description: eventDesc
          };
          
          events.push(newEvent);
          knownEventUrls.add(canonicalUrl);
          newEventsCount++;
          console.log(`Added new event: [${newEvent.id}] ${newEvent.title} (${newEvent.version})`);
        }
      }
    } catch (err) {
      console.error(`Error processing ${game.name}:`, err.message);
    }
  }

  await browser.close();

  if (newEventsCount > 0) {
    // Write back to events.json
    fs.writeFileSync(eventsPath, JSON.stringify(events, null, 2), 'utf8');
    console.log(`\nSuccessfully added ${newEventsCount} new web events and updated events.json.`);
  } else {
    console.log('\nNo new web events found. Database is up to date.');
  }
}

runCrawler().catch(err => {
  console.error('Crawler failed:', err);
  process.exit(1);
});
