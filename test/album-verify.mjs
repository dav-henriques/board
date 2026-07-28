/**
 * Verifica o popup do álbum: a chave que liga, a que desliga, de onde a
 * capa vem em cada situação e a promessa de não incomodar duas vezes.
 *
 * O Spotify nunca é chamado de verdade: a rede é interceptada, e é isso
 * que permite testar também o dia em que ele estiver fora do ar.
 *
 *   node test/album-verify.mjs
 */
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const SRC = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const TYPES = { '.html':'text/html', '.png':'image/png', '.jpg':'image/jpeg', '.json':'application/json',
                '.svg':'image/svg+xml', '.ico':'image/x-icon', '.js':'text/javascript',
                '.webmanifest':'application/manifest+json' };

const ALBUM_ID  = '1A2GTWGtFfWp7KSQTwWOyo';
const ALBUM_URL = `https://open.spotify.com/intl-pt/album/${ALBUM_ID}`;

/* ── uma cópia do site que dá para editar sem sujar o original ────── */
const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'album-'));
fs.cpSync(SRC, ROOT, { recursive:true, filter:(s) => !/node_modules|__pycache__|\.git/.test(s) });

const INDEX = fs.readFileSync(path.join(SRC, 'index.html'), 'utf8');
const state = {};                       // as chaves vão se acumulando entre os casos
function config(patch){
  Object.assign(state, patch);
  let out = INDEX;
  for (const [k, v] of Object.entries(state)){
    const re = new RegExp(`(\\n    ${k}:\\s*)('[^']*'|true|false)`);
    if (!re.test(out)) throw new Error(`CONFIG.album.${k} não encontrado`);
    out = out.replace(re, `$1${typeof v === 'boolean' ? v : `'${v}'`}`);
  }
  fs.writeFileSync(path.join(ROOT, 'index.html'), out);
}
/* ── PNG de cor chapada, escrito na mão: serve de capa nos testes ── */
let CRC = null;
function crc32(buf){
  if (!CRC){
    CRC = new Int32Array(256);
    for (let n = 0; n < 256; n++){
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC[n] = c;
    }
  }
  let c = -1;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return c ^ -1;
}
function solidPng([r, g, b], side = 24){
  const raw = Buffer.alloc((side * 4 + 1) * side);
  for (let y = 0; y < side; y++){
    const row = y * (side * 4 + 1);
    for (let x = 0; x < side; x++){
      const i = row + 1 + x * 4;
      raw[i] = r; raw[i+1] = g; raw[i+2] = b; raw[i+3] = 255;
    }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(side, 0); ihdr.writeUInt32BE(side, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

const COVER_FILE = `album-${ALBUM_ID}.png`;
/** Escreve (ou apaga) a cópia local da capa. `accent` entra no JSON se vier. */
const localCover = (on, { rgb = [180, 20, 220], accent = '' } = {}) => {
  const img = path.join(ROOT, 'assets', COVER_FILE);
  const js  = path.join(ROOT, 'assets', `album-${ALBUM_ID}.json`);
  if (on){
    fs.writeFileSync(img, solidPng(rgb));
    fs.writeFileSync(js, JSON.stringify({
      title:'DISCO LOCAL', cover:`./assets/${COVER_FILE}`, ...(accent ? { accent } : {})
    }));
  } else {
    fs.rmSync(img, { force:true });
    fs.rmSync(js,  { force:true });
  }
};

const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
  const file = path.join(ROOT, rel);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()){
    res.writeHead(404).end('nope');
    return;
  }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, r));
const BASE = `http://127.0.0.1:${server.address().port}/`;

const browser = await chromium.launch();
let fails = 0;
const check = (ok, label, detail) => {
  if (!ok) fails++;
  console.log(`${ok ? '✓' : '✗'} ${label}${detail ? '  — ' + detail : ''}`);
};

/**
 * Abre a página e conta o que aconteceu.
 *   spotify: 'ok' devolve um oEmbed válido · 'fora' derruba a requisição
 */
async function visit(ctx, { query = '', spotify = 'ok', wait = 1700 } = {}){
  const page = await ctx.newPage();
  const calls = [];
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));

  await page.route('**://open.spotify.com/oembed**', (route) => {
    calls.push('oembed');
    if (spotify === 'fora') return route.abort();
    route.fulfill({ status:200, contentType:'application/json', headers:{ 'access-control-allow-origin':'*' },
      body: JSON.stringify({ title:'DISCO AO VIVO', thumbnail_url:BASE + 'assets/mark.png',
                             thumbnail_width:300, thumbnail_height:300 }) });
  });
  page.on('request', (r) => { if (/album-.*\.json/.test(r.url())) calls.push('local'); });

  await page.goto(BASE + query, { waitUntil:'load' });
  await page.waitForFunction(() => document.body.classList.contains('is-ready'), null, { timeout:8000 });
  await page.waitForTimeout(wait);

  const out = await page.evaluate(() => {
    const sheet = document.querySelector('#albumSheet');
    return {
      aberto:  !!sheet && sheet.classList.contains('is-open'),
      selo:    !document.querySelector('#albumBadgeWrap').hidden,
      seloTxt: document.querySelector('#albumBadge').textContent.trim(),
      titulo:  document.querySelector('#albumTitle').textContent.trim(),
      capa:    document.querySelector('#albumArt').getAttribute('src') || '',
      capaOk:  document.querySelector('#albumArt').classList.contains('is-on'),
      cta:     document.querySelector('#albumCta').getAttribute('href') || '',
      travado: document.body.classList.contains('is-locked'),
      foco:    (document.activeElement.textContent || '').trim().slice(0, 12),
      // a cor DENTRO do popup versus a cor da página, para provar que
      // uma não contamina a outra
      hPopup:  parseFloat(getComputedStyle(sheet).getPropertyValue('--accent-h')),
      hPagina: parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--accent-h')),
      btnFg:   getComputedStyle(document.querySelector('#albumCta')).color,
      btnBg:   getComputedStyle(document.querySelector('#albumCta')).backgroundColor,
      selado:  getComputedStyle(document.querySelector('#albumBadge')).color
    };
  });
  await page.close();
  return { ...out, calls, errs };
}

const fresh = () => browser.newContext({ viewport:{ width:430, height:932 } });

/* ── 1. desligado: o módulo inteiro não existe ───────────────────── */
config({ on:false, url:ALBUM_URL });
localCover(true);
{
  const ctx = await fresh();
  const r = await visit(ctx);
  await ctx.close();
  check(!r.aberto && !r.selo && !r.calls.length && !r.errs.length,
        'on:false — sem popup, sem selo, sem uma requisição sequer',
        `chamadas: ${r.calls.length || 'nenhuma'}`);
}

/* ── 2. ligado, com a cópia local: o Spotify nem é chamado ───────── */
config({ on:true, url:ALBUM_URL, title:'', note:'novo álbum', badge:'novo álbum' });
{
  const ctx = await fresh();
  const r = await visit(ctx);
  await ctx.close();
  check(r.aberto && r.titulo === 'DISCO LOCAL' && !r.calls.includes('oembed'),
        'cópia local manda — nome e capa saem do disco, sem falar com o Spotify',
        `título "${r.titulo}"`);
  check(r.capa.includes(COVER_FILE) && r.capaOk, 'a capa local carregou de verdade', r.capa.slice(-24));
  check(r.travado && r.cta === ALBUM_URL, 'rolagem travada e botão apontando para o álbum');
  check(/Agora n/.test(r.foco), 'o foco começa no botão de fechar', `foco em "${r.foco}"`);
}

/* ── 3. ligado, sem cópia local: busca ao vivo ───────────────────── */
localCover(false);
{
  const ctx = await fresh();
  const r = await visit(ctx);
  await ctx.close();
  check(r.aberto && r.titulo === 'DISCO AO VIVO' && r.calls.includes('oembed'),
        'sem cópia local — nome e capa vêm do Spotify, só com o link colado',
        `título "${r.titulo}"`);
  check(r.capaOk, 'a capa remota carregou de verdade');
}

/* ── 4. Spotify fora do ar: abre assim mesmo ─────────────────────── */
{
  const ctx = await fresh();
  const r = await visit(ctx, { spotify:'fora' });
  await ctx.close();
  check(r.aberto && !r.errs.length,
        'Spotify fora do ar — o popup abre igual, sem quebrar nada',
        `erros: ${r.errs.length}`);
}

/* ── 5. título escrito à mão vence tudo ──────────────────────────── */
config({ title:'MEU TÍTULO' });
{
  const ctx = await fresh();
  const r = await visit(ctx);
  await ctx.close();
  check(r.titulo === 'MEU TÍTULO', 'CONFIG.album.title tem a palavra final', `título "${r.titulo}"`);
}
config({ title:'' });

/* ── 6. abre uma vez só, e o selo fica ───────────────────────────── */
{
  const ctx = await fresh();                       // mesmo "navegador" nas duas visitas
  const a = await visit(ctx);
  const b = await visit(ctx);
  const c = await visit(ctx, { query:'?album=1' });
  await ctx.close();
  check(a.aberto, 'primeira visita — o popup sobe sozinho');
  check(!b.aberto && b.selo, 'segunda visita — não sobe de novo, mas o selo fica', `selo: "${b.seloTxt}"`);
  check(c.aberto, '?album=1 — abre mesmo para quem já viu');
}

/* ── 7. once:false — insiste em toda visita ──────────────────────── */
config({ once:false });
{
  const ctx = await fresh();
  await visit(ctx);
  const b = await visit(ctx);
  await ctx.close();
  check(b.aberto, 'once:false — volta a abrir em toda visita');
}
config({ once:true });

/* ── 8. link que não é do Spotify ────────────────────────────────── */
config({ url:'https://minhagravadora.com/album', title:'FORA DO SPOTIFY' });
{
  const ctx = await fresh();
  const r = await visit(ctx);
  await ctx.close();
  check(r.aberto && r.titulo === 'FORA DO SPOTIFY' && r.cta === 'https://minhagravadora.com/album',
        'link de fora do Spotify — abre com o que você escreveu', `título "${r.titulo}"`);
}

/* ── 9. o QR continua funcionando ao lado ────────────────────────── */
config({ on:true, url:ALBUM_URL, title:'' });
{
  const ctx = await fresh();
  const page = await ctx.newPage();
  await page.route('**://open.spotify.com/oembed**', (r) => r.abort());
  await page.goto(BASE + '?qr=1', { waitUntil:'load' });
  await page.waitForFunction(() => document.body.classList.contains('is-ready'), null, { timeout:8000 });
  await page.waitForTimeout(1700);
  const both = await page.evaluate(() => ({
    qr: document.querySelector('#sheet').classList.contains('is-open'),
    album: document.querySelector('#albumSheet').classList.contains('is-open'),
    selo: !document.querySelector('#albumBadgeWrap').hidden
  }));
  // abrir o álbum tem que fechar o QR: uma folha por vez
  await page.click('#closeBtn');
  await page.waitForTimeout(600);
  await page.click('#albumBadge');
  await page.waitForTimeout(600);
  const trocou = await page.evaluate(() => ({
    qr: document.querySelector('#sheet').classList.contains('is-open'),
    album: document.querySelector('#albumSheet').classList.contains('is-open')
  }));
  await ctx.close();
  check(both.qr && !both.album && both.selo,
        '?qr=1 abre só o QR — o álbum espera a vez, com o selo à mostra');
  check(trocou.album && !trocou.qr, 'o selo abre o álbum e o QR sai de cena');
}

/* ── 10. a cor do popup sai da capa ──────────────────────────────── */
const gap = (a, b) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };
const lum = (css) => {
  const [r, g, b] = css.match(/[\d.]+/g).slice(0, 3).map(Number);
  const f = (v) => (v /= 255) <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4;
  return .2126 * f(r) + .7152 * f(g) + .0722 * f(b);
};
const contrast = (a, b) => {
  const x = lum(a), y = lum(b);
  return (Math.max(x, y) + .05) / (Math.min(x, y) + .05);
};

config({ on:true, url:ALBUM_URL, title:'', accent:'auto' });

/* 10a. cor já calculada pelo build, guardada no JSON */
localCover(true, { rgb:[180, 20, 220], accent:'#1db954' });   // verde, de propósito ≠ da capa
{
  const ctx = await fresh();
  const r = await visit(ctx);
  await ctx.close();
  check(gap(r.hPopup, 141) < 4 && gap(r.hPagina, 21.9) < 2,
        'a cor do JSON do build manda no popup, e só nele',
        `popup ${r.hPopup}° · página ${r.hPagina}°`);
}

/* 10b. sem cor no JSON: lida da própria capa, aqui mesmo */
localCover(true, { rgb:[180, 20, 220] });                     // magenta ≈ 291°
{
  const ctx = await fresh();
  const r = await visit(ctx);
  await ctx.close();
  check(gap(r.hPopup, 291) < 8, 'sem cor pronta, o popup lê a capa e se pinta',
        `popup ${r.hPopup}° (capa magenta ≈ 291°)`);
  check(gap(r.hPagina, 21.9) < 2 && /rgb\(2[45][0-9]/.test(r.selado),
        'a página e o selo continuam na cor do site', `selo ${r.selado}`);
  check(contrast(r.btnFg, r.btnBg) >= 4.5, 'o botão continua legível na cor da capa',
        `${contrast(r.btnFg, r.btnBg).toFixed(2)}:1`);
}

/* 10c. capas de várias cores — a cor do popup segue, o contraste aguenta */
for (const [nome, rgb, hue] of [['amarela', [250, 214, 10], 51],
                                ['azul-escura', [10, 30, 120], 229],
                                ['vermelha', [200, 20, 20], 0],
                                ['cinza', [130, 130, 132], null]]){
  localCover(true, { rgb });
  const ctx = await fresh();
  const r = await visit(ctx);
  await ctx.close();
  const corOk = hue === null ? gap(r.hPopup, 21.9) < 2      // capa sem cor: fica no tema
                             : gap(r.hPopup, hue) < 8;
  check(corOk && contrast(r.btnFg, r.btnBg) >= 4.5,
        `capa ${nome}`,
        `popup ${r.hPopup}° · botão ${contrast(r.btnFg, r.btnBg).toFixed(2)}:1`);
}

/* 10d. as saídas manuais */
localCover(true, { rgb:[180, 20, 220] });
config({ accent:'tema' });
{
  const ctx = await fresh();
  const r = await visit(ctx);
  await ctx.close();
  check(gap(r.hPopup, 21.9) < 2, "accent:'tema' — o popup fica na cor do site", `popup ${r.hPopup}°`);
}
config({ accent:'#00e0ff' });
{
  const ctx = await fresh();
  const r = await visit(ctx);
  await ctx.close();
  check(gap(r.hPopup, 187.3) < 2, "accent:'#00e0ff' — a cor que você escreveu vence a capa",
        `popup ${r.hPopup}°`);
}

await browser.close();
server.close();
fs.rmSync(ROOT, { recursive:true, force:true });
console.log('\n' + (fails ? `${fails} FALHA(S)` : 'O POPUP DO ÁLBUM SE COMPORTA EM TODOS OS CASOS ✓'));
process.exit(fails ? 1 : 0);
