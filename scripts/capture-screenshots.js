import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const eventsPath = path.join(__dirname, '..', 'src', 'events.json');
const outputDir = path.join(__dirname, '..', 'public', 'images', 'screenshots');

async function captureScreenshots() {
  console.log('Starting screenshot capture process...');
  
  // Ensure output directory exists
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
    console.log('Created screenshots directory:', outputDir);
  }

  // Load events
  const events = JSON.parse(fs.readFileSync(eventsPath, 'utf8'));
  console.log(`Loaded ${events.length} events from database.`);

  // Create 404 placeholder screenshot
  const placeholderPath = path.join(outputDir, '404.png');
  // We will create a simple 404 image if it doesn't exist (or we can let the application fallback)
  
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  
  // Set viewport to a nice 16:9 ratio (1024x576)
  await page.setViewport({
    width: 1024,
    height: 576,
    deviceScaleFactor: 1
  });

  // Set user agent to a standard desktop browser
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

  // Set standard timeout
  page.setDefaultNavigationTimeout(30000);
  page.setDefaultTimeout(30000);

  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    const outputPath = path.join(outputDir, `${event.id}.png`);

    console.log(`\n[${i + 1}/${events.length}] Processing: ${event.title}`);
    
    // Check if we already have it to avoid re-downloading
    if (fs.existsSync(outputPath)) {
      console.log(`-> Screenshot already exists at ${outputPath}. Skipping.`);
      continue;
    }

    if (event.status === '已失效') {
      console.log(`-> Status is '已失效' (404). Skipping capture.`);
      continue;
    }

    try {
      console.log(`-> Navigating to: ${event.url}`);
      
      // Navigate to URL
      const response = await page.goto(event.url, { waitUntil: 'networkidle2', timeout: 30000 });
      
      // If 404 status code returned
      if (response && response.status() === 404) {
        console.log(`-> URL returned 404. Skipping.`);
        continue;
      }

      // Wait a few seconds for animations to settle
      console.log('-> Waiting 10 seconds for page load and animations...');
      await new Promise(resolve => setTimeout(resolve, 10000));

      // Take screenshot
      await page.screenshot({ path: outputPath, type: 'png' });
      console.log(`-> Saved screenshot to: ${outputPath}`);

    } catch (error) {
      console.error(`-> Error capturing screenshot for ${event.title}:`, error.message);
    }
  }

  await browser.close();
  console.log('\nScreenshot capture process completed successfully!');
}

captureScreenshots().catch(err => {
  console.error('Fatal error in capture script:', err);
});
