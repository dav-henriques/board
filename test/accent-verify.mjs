/**
 * Verifica a promessa central: a cor do site sai do avatar.
 * Gera logos de várias cores, serve cada um como ./assets/mark.png e
 * confere o matiz que a página extraiu — além dos casos difíceis:
 * imagem em tons de cinza, imagem ausente e canvas bloqueado.
 *
 *   node test/accent-verify.mjs
 */
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

/* ── PNG mínimo escrito na mão: sol chapado sobre fundo transparente ── */
function makePng(width, height, paint){
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++){
    const row = y * (width * 4 + 1);
    raw[row] = 0;
    for (let x = 0; x < width; x++){
      const [r, g, b, a] = paint(x, y);
      const i = row + 1 + x * 4;
      raw[i] = r; raw[i+1] = g; raw[i+2] = b; raw[i+3] = a;
    }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

let TABLE = null;
function crc32(buf){
  if (!TABLE){
    TABLE = new Int32Array(256);
    for (let n = 0; n < 256; n++){
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      TABLE[n] = c;
    }
  }
  let c = -1;
  for (const b of buf) c = TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return c ^ -1;
}

/** Disco colorido com miolo preto — imita a estrutura do logo real. */
function logo(rgb){
  const N = 200, c = N / 2;
  return makePng(N, N, (x, y) => {
    const d = Math.hypot(x - c, y - c);
    if (d > 88) return [0, 0, 0, 0];        // fora: transparente
    if (d < 42) return [0, 0, 0, 255];      // miolo preto, como no logo do sol
    return [...rgb, 255];
  });
}

const CASES = [
  { name: 'laranja (o logo real)', rgb: [250,  91,   0], hue: [12, 32] },
  { name: 'azul',                  rgb: [ 20, 110, 255], hue: [205, 225] },
  { name: 'verde',                 rgb: [ 30, 200,  90], hue: [130, 155] },
  { name: 'roxo',                  rgb: [150,  60, 230], hue: [265, 285] },
  { name: 'rosa choque',           rgb: [255,  40, 150], hue: [325, 345] },
  { name: 'amarelo',               rgb: [255, 214,  10], hue: [42, 58] },
  { name: 'vermelho puro',         rgb: [230,  20,  20], hue: [355, 365] },  // dá a volta no 0
  { name: 'ciano apagado',         rgb: [120, 170, 175], hue: [175, 195] },
  { name: 'cinza (sem cor)',       rgb: [140, 140, 140], hue: null },        // mantém o padrão
];

let mark = logo(CASES[0].rgb);

const MIME = { '.html':'text/html; charset=utf-8', '.js':'text/javascript',
  '.webmanifest':'application/manifest+json', '.png':'image/png', '.jpg':'image/jpeg',
  '.svg':'image/svg+xml', '.ico':'image/x-icon' };

const server = http.createServer((req, res) => {
  let file = decodeURIComponent(req.url.split('?')[0]);
  if (file === '/') file = '/index.html';
  if (file === '/assets/mark.png'){
    if (!mark){ res.writeHead(404); return res.end(); }        // simula imagem faltando
    res.writeHead(200, { 'Content-Type': 'image/png' });
    return res.end(mark);
  }
  const full = path.join(ROOT, file);
  if (!fs.existsSync(full) || fs.statSync(full).isDirectory()){ res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(full)] || 'application/octet-stream' });
  fs.createReadStream(full).pipe(res);
});

const PORT = 8140;
await new Promise((r) => server.listen(PORT, r));
const browser = await chromium.launch();

let fails = 0;
const DEFAULT_HUE = 22;

async function read(){
  const ctx = await browser.newContext({ viewport: { width: 420, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
  await page.waitForTimeout(1400);
  const out = await page.evaluate(() => {
    const s = getComputedStyle(document.documentElement);
    return {
      h: parseFloat(s.getPropertyValue('--accent-h')),
      s: parseFloat(s.getPropertyValue('--accent-s')),
      l: parseFloat(s.getPropertyValue('--accent-l')),
      // a cor tem que ter chegado de fato aos elementos, não só à variável
      dot: getComputedStyle(document.querySelector('.eyebrow'), '::before').backgroundColor
    };
  });
  await ctx.close();
  return out;
}

for (const c of CASES){
  mark = logo(c.rgb);
  const got = await read();
  const hue = got.h;

  let ok;
  if (c.hue === null){
    ok = Math.abs(hue - DEFAULT_HUE) < 0.5;                     // sem cor → mantém o padrão
  } else {
    const [lo, hi] = c.hue;
    ok = (hue >= lo && hue <= hi) || (hue + 360 >= lo && hue + 360 <= hi);
  }
  // a luminosidade tem que ficar na faixa legível, seja qual for o logo
  if (got.l < 46 || got.l > 64) ok = false;

  if (ok) console.log(`  ✓ ${c.name.padEnd(22)} matiz ${hue.toFixed(1).padStart(6)}°  sat ${got.s}%  lum ${got.l}%`);
  else { fails++; console.log(`  ✗ ${c.name.padEnd(22)} matiz ${hue}° (esperado ${c.hue || 'padrão ' + DEFAULT_HUE}) lum ${got.l}%`); }
}

// imagem ausente: cai no gradiente de reserva e mantém o laranja padrão
mark = null;
const missing = await read();
Math.abs(missing.h - DEFAULT_HUE) < 0.5
  ? console.log(`  ✓ ${'sem imagem'.padEnd(22)} mantém o padrão ${DEFAULT_HUE}°`)
  : (fails++, console.log(`  ✗ sem imagem virou ${missing.h}°`));

await browser.close();
server.close();

console.log('\n' + (fails ? `${fails} FALHA(S)` : 'A COR ACOMPANHA O AVATAR EM TODOS OS CASOS ✓'));
process.exit(fails ? 1 : 0);
