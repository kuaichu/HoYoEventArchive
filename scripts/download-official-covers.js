import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const outputDir = path.join(__dirname, '..', 'public', 'images');

const imageMappings = {
  'genshin_cover.png': 'https://ys.mihoyo.com/main/_nuxt/img/logo-header-full.a71d70a.png',
  'hsr_cover.png': 'https://fastcdn.mihoyo.com/mi18n/hkrpg_cn/m20260511hy1g60n01s/upload/0a24215284a6a1051986b7d051a4c133_2549527314883550565.png',
  'zzz_cover.png': 'https://fastcdn.mihoyo.com/static-resource-v2/2024/04/02/af9fd2ec764d0af9c63b9762e6b32ef0_77819233022176362.png',
  'bh3_cover.png': 'https://uploadstatic.mihoyo.com/bh3/upload/officialsites/201909/game-tion-2-logo_1568108157_3779.png'
};

async function downloadImages() {
  console.log('Downloading high-resolution official miHoYo promotional wallpapers...\n');
  
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  for (const [filename, url] of Object.entries(imageMappings)) {
    const outputPath = path.join(outputDir, filename);
    console.log(`Downloading: ${url} -> ${outputPath}`);
    
    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Referer': 'https://www.mihoyo.com/'
        }
      });
      
      if (!response.ok) {
        throw new Error(`Failed to download ${url}: HTTP status ${response.status}`);
      }
      
      const buffer = await response.arrayBuffer();
      fs.writeFileSync(outputPath, Buffer.from(buffer));
      console.log(`Success! Saved ${filename} (${buffer.byteLength} bytes)`);
      
    } catch (err) {
      console.error(`Error downloading ${filename}:`, err.message);
    }
  }
  
  console.log('\nAll official cover updates completed.');
}

downloadImages();
