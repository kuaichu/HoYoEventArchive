import puppeteer from 'puppeteer';

async function testScrape() {
  const url = 'https://act.mihoyo.com/zzz/event/e20260606reunion-97ch1w/index.html';
  console.log('Visiting:', url);
  
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  
  // Set viewport to desktop size
  await page.setViewport({ width: 1280, height: 720 });
  
  try {
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
    
    // Wait an extra 2 seconds for JS execution
    await new Promise(r => setTimeout(r, 2000));
    
    const pageData = await page.evaluate(() => {
      const title = document.title;
      
      const metaDescEl = document.querySelector('meta[name="description"]') || document.querySelector('meta[property="og:description"]');
      const metaDesc = metaDescEl ? metaDescEl.getAttribute('content') : '';
      
      const metaKeywordsEl = document.querySelector('meta[name="keywords"]') || document.querySelector('meta[property="og:keywords"]');
      const metaKeywords = metaKeywordsEl ? metaKeywordsEl.getAttribute('content') : '';
      
      const bodyText = document.body.innerText;
      
      return { title, metaDesc, metaKeywords, bodyTextSnippet: bodyText.substring(0, 1000) };
    });
    
    console.log('--- SCRAPED DATA ---');
    console.log('Title:', pageData.title);
    console.log('Meta Description:', pageData.metaDesc);
    console.log('Meta Keywords:', pageData.metaKeywords);
    console.log('Body Text Snippet:', pageData.bodyTextSnippet);
  } catch (err) {
    console.error('Error during scraping:', err);
  } finally {
    await browser.close();
  }
}

testScrape();
