import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import puppeteer from 'puppeteer';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const eventsPath = path.join(__dirname, '..', 'src', 'events.json');
const events = JSON.parse(fs.readFileSync(eventsPath, 'utf8'));

async function scrapeAndUpdate() {
  // Filter events with status "可访问" or "需登录"
  const activeEvents = events.filter(e => e.status === '可访问' || e.status === '需登录');
  console.log(`Found ${activeEvents.length} active/login events to scrape.`);

  const browser = await puppeteer.launch({ headless: true });
  
  for (const evt of activeEvents) {
    console.log(`\nScraping [${evt.id}] - "${evt.title}"...`);
    console.log(`URL: ${evt.url}`);
    
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 720 });
    
    try {
      await page.goto(evt.url, { waitUntil: 'networkidle2', timeout: 30000 });
      await new Promise(r => setTimeout(r, 2000)); // wait for animations/JS
      
      const data = await page.evaluate(() => {
        const title = document.title;
        const metaDescEl = document.querySelector('meta[name="description"]') || 
                           document.querySelector('meta[property="og:description"]');
        const metaDesc = metaDescEl ? metaDescEl.getAttribute('content') : '';
        return { title, metaDesc };
      });
      
      console.log(`Scraped Title: "${data.title}"`);
      console.log(`Scraped Meta Description: "${data.metaDesc}"`);
      
      let updated = false;

      // Extract version from meta description or title
      // Matches pattern like "3.0版本" or "v2.5" or "1.3 version"
      const versionRegex = /(?<!\d)([1-9]\.\d)(?!\d)/;
      const combinedText = `${data.title} ${data.metaDesc}`;
      const versionMatch = combinedText.match(versionRegex);
      
      if (versionMatch) {
        const extractedVersion = 'v' + versionMatch[1];
        if (evt.version !== extractedVersion) {
          console.log(`Updating version: ${evt.version} -> ${extractedVersion}`);
          evt.version = extractedVersion;
          updated = true;
        }
      }
      
      // Update description if we got a rich meta description
      if (data.metaDesc && data.metaDesc.length > 15) {
        if (evt.description !== data.metaDesc) {
          console.log(`Updating description.`);
          evt.description = data.metaDesc;
          updated = true;
        }
      }
      
      if (!updated) {
        console.log('No updates needed for this event.');
      }
      
    } catch (err) {
      console.error(`Error scraping ${evt.id}:`, err.message);
    } finally {
      await page.close();
    }
  }
  
  await browser.close();
  
  // Write back to events.json
  fs.writeFileSync(eventsPath, JSON.stringify(events, null, 2), 'utf8');
  console.log('\nDatabase update completed successfully.');
}

scrapeAndUpdate();
