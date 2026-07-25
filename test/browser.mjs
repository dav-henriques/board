/**
 * Testes de navegador: console limpo, entrada em cena, modal do QR,
 * QR apontando para a própria URL, service worker e capturas de tela.
 *
 *   node test/browser.mjs
 */
import { chromium, devices } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SHOTS = path.join(ROOT, 'test', 'shots');
fs.mkdirSync(SHOTS, { recursive: true });

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon'
};

const server = http.createServer((req, res) => {
  let file = decodeURIComponent(req.url.split('?')[0]);
  if (file === '/') file = '/index.html';
  const full = path.join(ROOT, file);
  if (!full.startsWith(ROOT) || !fs.existsSync(full) || fs.statSync(full).isDirectory()){
    res.writeHead(404); return res.end('404');
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(full)] || 'application/octet-stream' });
  fs.createReadStream(full).pipe(res);
});

const PORT = 8123;
await new Promise((r) => server.listen(PORT, r));
const BASE = `http://localhost:${PORT}/`;

const browser = await chromium.launch();
const problems = [];
const note = (m) => { problems.push(m); console.log('  ✗ ' + m); };
const pass = (m) => console.log('  ✓ ' + m);

async function run(name, opts, extra){
  console.log(`\n── ${name} ─────────────────────────────`);
  const ctx = await browser.newContext({ ...opts, colorScheme: 'dark' });
  const page = await ctx.newPage();
  // O sandbox de testes não tem saída para fonts.googleapis.com; a página
  // cai para a fonte do sistema por design, então isso não é um defeito.
  const external = (s) => /fonts\.(googleapis|gstatic)\.com|ERR_TUNNEL/.test(s);
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error' && !external(m.text())) errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('requestfailed', (r) => { if (!external(r.url())) errors.push('requisição falhou: ' + r.url()); });

  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForTimeout(2400);

  if (errors.length) errors.forEach((e) => note(`[${name}] ${e}`));
  else pass(`${name}: console limpo`);

  const ready = await page.evaluate(() => document.body.classList.contains('is-ready'));
  ready ? pass(`${name}: entrada concluída`) : note(`${name}: body.is-ready não aplicado`);

  const rows = await page.locator('.row').count();
  rows === 7 ? pass(`${name}: 7 links renderizados`) : note(`${name}: ${rows} links (esperado 7)`);

  const opacity = await page.locator('.row').first().evaluate((el) => getComputedStyle(el.parentElement).opacity);
  Number(opacity) > 0.99 ? pass(`${name}: links visíveis`) : note(`${name}: opacidade final ${opacity}`);

  // a cor de destaque tem que ter saído do avatar, não do valor padrão
  const accent = await page.evaluate(() => {
    const s = getComputedStyle(document.documentElement);
    return {
      h: parseFloat(s.getPropertyValue('--accent-h')),
      s: s.getPropertyValue('--accent-s').trim(),
      l: s.getPropertyValue('--accent-l').trim()
    };
  });
  accent.h > 10 && accent.h < 45
    ? pass(`${name}: acento extraído do logo — matiz ${accent.h}°, ${accent.s} ${accent.l}`)
    : note(`${name}: acento inesperado ${JSON.stringify(accent)}`);

  await page.screenshot({ path: path.join(SHOTS, `${name}-home.png`) });
  await page.screenshot({ path: path.join(SHOTS, `${name}-full.png`), fullPage: true });

  if (extra) await extra(page, name);
  await ctx.close();
}

// ── iPhone (mobile-first) ───────────────────────────────────────
await run('iphone', { ...devices['iPhone 14 Pro'], isMobile: true, hasTouch: true }, async (page, name) => {
  await page.locator('#qrBtn').click();
  await page.waitForTimeout(900);

  const open = await page.locator('#sheet').evaluate((el) => el.classList.contains('is-open') && !el.hidden);
  open ? pass(`${name}: modal do QR aberto`) : note(`${name}: modal não abriu`);

  const svg = await page.locator('#qrCard svg').count();
  svg === 1 ? pass(`${name}: QR renderizado`) : note(`${name}: QR ausente`);

  const box = await page.locator('#qrCard').boundingBox();
  const vw = page.viewportSize().width;
  const ratio = box.width / vw;
  ratio > 0.6 && ratio < 0.95
    ? pass(`${name}: QR ocupa ${(ratio * 100).toFixed(0)}% da largura`)
    : note(`${name}: QR ocupa ${(ratio * 100).toFixed(0)}% da largura`);

  const shown = await page.locator('#qrUrl').innerText();
  shown.includes(`localhost:${PORT}`) ? pass(`${name}: URL exibida "${shown}"`) : note(`${name}: URL "${shown}"`);

  await page.screenshot({ path: path.join(SHOTS, `${name}-qr.png`) });
  await page.locator('#qrCard').screenshot({ path: path.join(SHOTS, 'qr-card.png') });

  await page.locator('#closeBtn').click();
  await page.waitForTimeout(800);
  const closed = await page.locator('#sheet').evaluate((el) => !el.classList.contains('is-open'));
  closed ? pass(`${name}: modal fechado`) : note(`${name}: modal não fechou`);

  // service worker + offline
  const sw = await page.evaluate(() => navigator.serviceWorker.getRegistration().then((r) => !!r));
  sw ? pass(`${name}: service worker registrado`) : note(`${name}: service worker não registrado`);

  await page.waitForTimeout(1200);
  await page.context().setOffline(true);
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(1600);
  const offlineRows = await page.locator('.row').count();
  offlineRows === 7 ? pass(`${name}: página funciona offline`) : note(`${name}: offline renderizou ${offlineRows} links`);
  await page.screenshot({ path: path.join(SHOTS, `${name}-offline.png`) });
  await page.context().setOffline(false);
});

// ── Desktop ─────────────────────────────────────────────────────
await run('desktop', { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 }, async (page, name) => {
  await page.locator('.row').first().hover();
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(SHOTS, `${name}-hover.png`) });

  await page.locator('#qrBtn').click();
  await page.waitForTimeout(900);
  await page.screenshot({ path: path.join(SHOTS, `${name}-qr.png`) });

  await page.keyboard.press('Escape');
  await page.waitForTimeout(700);
  const closed = await page.locator('#sheet').evaluate((el) => !el.classList.contains('is-open'));
  closed ? pass(`${name}: Esc fecha o modal`) : note(`${name}: Esc não fechou`);

  // Desempenho do fundo animado.
  // Este sandbox não tem GPU (rasterização por software), então o número
  // absoluto não vale muito; o que interessa é o custo relativo ao teto do
  // próprio ambiente, medido com o canvas oculto.
  const measure = () => page.evaluate(() => new Promise((resolve) => {
    let n = 0; const t0 = performance.now();
    const tick = () => { n++; performance.now() - t0 < 1500 ? requestAnimationFrame(tick) : resolve(Math.round(n / 1.5)); };
    requestAnimationFrame(tick);
  }));

  await page.waitForTimeout(3000);            // deixa a degradação adaptativa assentar
  const fps = await measure();
  await page.evaluate(() => { document.getElementById('waves').style.display = 'none'; });
  await page.waitForTimeout(400);
  const ceiling = await measure();
  await page.evaluate(() => { document.getElementById('waves').style.display = ''; });

  // Sem GPU, cada composição do canvas em tela cheia custa ~15ms de CPU —
  // num aparelho de verdade é uma textura pequena escalada pela GPU, de graça.
  // Por isso o piso aqui é baixo: o que se verifica é que a degradação
  // adaptativa segura o fundo num patamar estável em vez de derreter.
  const ratio = fps / ceiling;
  ratio >= 0.55
    ? pass(`${name}: ${fps} fps (teto do ambiente sem GPU: ${ceiling})`)
    : note(`${name}: ${fps} fps contra teto de ${ceiling} — só ${(ratio * 100).toFixed(0)}%`);
});

// ── Movimento reduzido ──────────────────────────────────────────
await run('reduced-motion', { viewport: { width: 430, height: 932 }, reducedMotion: 'reduce' });

// ── Atalho ?qr=1 ────────────────────────────────────────────────
{
  console.log('\n── atalho ?qr=1 ─────────────────────────');
  const ctx = await browser.newContext({ ...devices['iPhone 14 Pro'] });
  const page = await ctx.newPage();
  await page.goto(BASE + '?qr=1', { waitUntil: 'load' });
  await page.waitForTimeout(2600);
  const open = await page.locator('#sheet').evaluate((el) => el.classList.contains('is-open'));
  open ? pass('atalho abre o modal') : note('atalho não abriu o modal');
  const url = await page.locator('#qrUrl').innerText();
  !url.includes('qr=1') ? pass(`URL do QR sem o parâmetro: ${url}`) : note(`URL do QR contém ?qr=1: ${url}`);
  await ctx.close();
}

await browser.close();
server.close();

console.log('\n' + (problems.length ? `${problems.length} PROBLEMA(S)` : 'TODOS OS TESTES DE NAVEGADOR PASSARAM ✓'));
process.exit(problems.length ? 1 : 0);
