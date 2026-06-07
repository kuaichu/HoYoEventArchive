import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import puppeteer from 'puppeteer';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const eventsPath = path.join(__dirname, '..', 'src', 'events.json');
const events = JSON.parse(fs.readFileSync(eventsPath, 'utf8'));

const games = [
  { gids: 2, name: '原神', gameKey: 'ys' },
  { gids: 6, name: '星穹铁道', gameKey: 'sr' },
  { gids: 8, name: '绝区零', gameKey: 'zzz' },
  { gids: 1, name: '崩坏3', gameKey: 'bh3' }
];

async function runCrawler() {
  console.log('Starting automated Miyoushe web event crawler...\n');
  
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

  const browser = await puppeteer.launch({ headless: true });
  let newEventsCount = 0;

  for (const game of games) {
    try {
      console.log(`>>> Fetching news list for game: ${game.name} (${game.gameKey.toUpperCase()})`);
      
      const posts = [];
      const types = [1, 2, 3]; // 1: 公告, 2: 活动, 3: 资讯
      const pageSize = 50;

      for (const type of types) {
        console.log(`Fetching latest ${pageSize} posts for type ${type}...`);
        const url = `https://bbs-api.miyoushe.com/painter/wapi/getNewsList?gids=${game.gids}&type=${type}&page_size=${pageSize}`;
        try {
          const res = await fetch(url, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
              'Referer': 'https://www.miyoushe.com/'
            }
          });
          const json = await res.json();
          if (json.retcode === 0 && json.data && json.data.list && json.data.list.length > 0) {
            posts.push(...json.data.list);
          }
        } catch (err) {
          console.error(`Error fetching type ${type} for ${game.name}:`, err.message);
        }
        await new Promise(r => setTimeout(r, 200));
      }

      // Deduplicate posts by post_id
      const uniquePostsMap = {};
      posts.forEach(p => {
        uniquePostsMap[p.post.post_id] = p;
      });
      const uniquePosts = Object.values(uniquePostsMap);
      
      console.log(`Found total ${uniquePosts.length} unique announcement posts for ${game.name}. Parsing details...`);
      
      for (const item of uniquePosts) {
        const postId = item.post.post_id;
        const subject = item.post.subject;
        
        // Fetch full post content
        const detailUrl = `https://bbs-api.miyoushe.com/post/wapi/getPostFull?post_id=${postId}`;
        
        // Sleep 300ms to be polite to the API
        await new Promise(r => setTimeout(r, 300));
        
        const detailRes = await fetch(detailUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Referer': 'https://www.miyoushe.com/'
          }
        });
        const detailJson = await detailRes.json();
        
        if (detailJson.retcode !== 0 || !detailJson.data || !detailJson.data.post || !detailJson.data.post.post) {
          continue;
        }
        
        const content = detailJson.data.post.post.content;
        
        // Extract web activity links
        const urlRegex = /https?:\/\/(?:act|webstatic)\.mihoyo\.com\/[^\s"'<>\(\)]+/gi;
        const matches = content.match(urlRegex) || [];
        
        // Process unique URLs found in this post
        const uniqueUrls = [...new Set(matches.map(u => u.replace(/&amp;/g, '&').replace(/[.,;!?]$/, '')))];
        
        for (const rawUrl of uniqueUrls) {
          // Exclude generic links like webstatic.mihoyo.com/common/ or static image resources
          if (rawUrl.includes('/common/') || rawUrl.match(/\.(png|jpg|jpeg|gif|svg)/i)) {
            continue;
          }
          
          // Helper to strip minor query params for comparison
          const getBaseUrl = u => u.split('?')[0].split('#')[0].replace(/\/$/, '');
          const cleanUrl = rawUrl;
          const baseUrl = getBaseUrl(cleanUrl);
          
          // Check if it already exists in the database
          const exists = events.some(e => getBaseUrl(e.url) === baseUrl);
          if (exists) {
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
          
          // Format publication date from Miyoushe metadata
          let pubDate = '';
          if (item.news_meta && item.news_meta.start_at_sec) {
            const seconds = parseInt(item.news_meta.start_at_sec, 10);
            if (!isNaN(seconds)) {
              const d = new Date(seconds * 1000);
              pubDate = `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
            }
          }
          if (!pubDate && item.post && item.post.created_at) {
            const d = new Date(item.post.created_at * 1000);
            pubDate = `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
          }
          if (!pubDate) {
            const d = new Date();
            pubDate = `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
          }
          
          // Categorize activity type
          let eventType = '其他活动';
          const textToAnalyze = `${eventTitle} ${eventDesc}`.toLowerCase();
          if (textToAnalyze.includes('年度报告') || textToAnalyze.includes('年报') || textToAnalyze.includes('足迹')) {
            eventType = '年度报告';
          } else if (textToAnalyze.includes('回归') || textToAnalyze.includes('重聚') || textToAnalyze.includes('召回')) {
            eventType = '回归活动';
          } else if (textToAnalyze.includes('联动') || textToAnalyze.includes('合作') || textToAnalyze.includes('联动小游戏')) {
            eventType = '联动活动';
          } else if (textToAnalyze.includes('小游戏') || textToAnalyze.includes('游玩') || textToAnalyze.includes('绘画征集') || textToAnalyze.includes('画笔')) {
            eventType = '小游戏';
          } else if (textToAnalyze.includes('资料站') || textToAnalyze.includes('图鉴') || textToAnalyze.includes('计算器') || textToAnalyze.includes('指南')) {
            eventType = '资料站';
          } else if (textToAnalyze.includes('预约') || textToAnalyze.includes('预抽卡') || textToAnalyze.includes('前瞻')) {
            eventType = '预约/预抽卡';
          }
          
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
            tags: tags.length > 0 ? tags : ['网页活动'],
            version: version,
            description: eventDesc
          };
          
          events.push(newEvent);
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

runCrawler();
