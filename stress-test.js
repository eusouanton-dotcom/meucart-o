const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const PORT = 8000;
const ROOT = path.resolve(__dirname);

let serverInstance = null;

const server = http.createServer((req, res) => {
  let filePath = path.join(ROOT, req.url === '/' ? '/index.html' : req.url);
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.json': 'application/json',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
  }[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, {'Content-Type': 'text/plain'});
      res.end('Not found');
      return;
    }
    res.writeHead(200, {'Content-Type': contentType});
    res.end(data);
  });
});

serverInstance = server;

(async () => {
  serverInstance.listen(PORT, () => {
    console.log(`✓ Server running at http://localhost:${PORT}`);
  });

  await new Promise(resolve => setTimeout(resolve, 500)); // Esperar servidor inicializar

  const browser = await chromium.launch({ 
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  let passed = 0;
  let failed = 0;
  const outcomes = [];
  const errors = [];

  for (let i = 1; i <= 30; i++) {
    let context = null;
    let page = null;
    try {
      context = await browser.newContext({ 
        ignoreHTTPSErrors: true,
        javaScriptEnabled: true 
      });
      page = await context.newPage();
      
      // Load page
      await page.goto(`http://localhost:${PORT}`, { 
        waitUntil: 'networkidle', 
        timeout: 15000 
      }).catch(() => {});

      // Esperar DOM estar pronto
      await page.waitForSelector('body', { timeout: 5000 });
      await page.waitForTimeout(500);

      // Validações básicas
      const bodyExists = await page.$('body') !== null;
      if (!bodyExists) throw new Error('body element missing');

      const hasNav = await page.$('nav') !== null;
      if (!hasNav) throw new Error('nav element missing');

      const hasHomeSection = await page.$('#page-home') !== null;
      if (!hasHomeSection) throw new Error('home section missing');

      const pageTitle = await page.title();
      if (!pageTitle.toLowerCase().includes('antônio')) throw new Error(`title mismatch: "${pageTitle}"`);

      // Teste de navegação
      await page.click('button[onclick="navigateTo(\'home\')"]', { timeout: 2000 }).catch(() => {});
      await page.waitForTimeout(300);

      const homeActive = await page.evaluate(() => {
        const el = document.getElementById('page-home');
        return el ? el.classList.contains('active') : false;
      });
      if (!homeActive) throw new Error('home section not active after navigation');

      // Teste de mercado (se existir)
      const hasMktData = await page.evaluate(() => {
        const usd = document.getElementById('val-usd');
        const eur = document.getElementById('val-eur');
        const btc = document.getElementById('val-btc');
        return {
          usd: usd?.innerText?.trim() || '',
          eur: eur?.innerText?.trim() || '',
          btc: btc?.innerText?.trim() || ''
        };
      });

      if (!hasMktData.usd && !hasMktData.eur && !hasMktData.btc) {
        console.warn(`  run ${i}: warning - market data not loaded`);
      }

      passed += 1;
      outcomes.push(`run ${i}: ✓ ok`);
    } catch (error) {
      failed += 1;
      const msg = error.message || String(error);
      outcomes.push(`run ${i}: ✗ ${msg.substring(0, 50)}`);
      if (errors.length < 3) errors.push({ run: i, error: msg });
    } finally {
      try {
        if (page) await page.close().catch(() => {});
        if (context) await context.close().catch(() => {});
      } catch (e) {}
    }
  }

  // Summary
  console.log('\n╔════════════════════════════════════╗');
  console.log('║   STRESS TEST SUMMARY (30 RUNS)   ║');
  console.log('╠════════════════════════════════════╣');
  console.log(`║ ✓ PASSED: ${String(passed).padEnd(26)} ║`);
  console.log(`║ ✗ FAILED: ${String(failed).padEnd(26)} ║`);
  console.log('╚════════════════════════════════════╝\n');

  if (errors.length > 0) {
    console.log('First errors encountered:');
    errors.forEach(e => console.log(`  [run ${e.run}] ${e.error}`));
    console.log();
  }

  console.log('Latest 10 results:');
  outcomes.slice(-10).forEach(line => console.log(`  ${line}`));

  // Cleanup
  try {
    await browser.close().catch(() => {});
  } catch (e) {}
  
  serverInstance.close();
  
  process.exit(failed > 5 ? 1 : 0);
})().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});