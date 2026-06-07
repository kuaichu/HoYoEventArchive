import puppeteer from 'puppeteer';

const sites = {
  ys: 'https://ys.mihoyo.com/',
  zzz: 'https://zzz.mihoyo.com/',
  bh3: 'https://bh3.mihoyo.com/'
};

async function findLogos() {
  console.log('Launching browser...');
  const browser = await puppeteer.launch({ headless: true });

  for (const [game, url] of Object.entries(sites)) {
    console.log(`\n=== Game: ${game.toUpperCase()} ===`);
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 720 });
    
    try {
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
      await new Promise(r => setTimeout(r, 2000)); // Wait for JS execution
      
      const images = await page.evaluate(() => {
        const imgs = Array.from(document.querySelectorAll('img')).map(img => img.src);
        
        // Also check background images in style sheets
        const divs = Array.from(document.querySelectorAll('*')).map(el => {
          const bg = window.getComputedStyle(el).backgroundImage;
          if (bg && bg !== 'none') {
            const match = bg.match(/url\("?([^"]+)"?\)/);
            return match ? match[1] : null;
          }
          return null;
        }).filter(Boolean);
        
        return [...new Set([...imgs, ...divs])];
      });
      
      const filtered = images.filter(u => u.startsWith('http'));
      console.log(`Found ${filtered.length} total image assets.`);
      
      const logoUrls = filtered.filter(u => u.toLowerCase().includes('logo') || u.toLowerCase().includes('icon'));
      console.log('Logo/Icon URLs:');
      logoUrls.forEach(u => console.log('  -', u));
      
      console.log('Top 15 other images:');
      filtered.slice(0, 15).forEach(u => console.log('  -', u));
      
    } catch (err) {
      console.error(`Error loading ${game}:`, err.message);
    } finally {
      await page.close();
    }
  }
  
  await browser.close();
}

findLogos();
