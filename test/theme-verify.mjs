/**
 * Verifica a promessa nova: uma cor no CONFIG e o site inteiro vira ela —
 * inclusive a arte, que tem a matiz girada até bater com o tema.
 *
 * Para cada cor de teste, abre a página, lê os tokens do CSS e depois mede
 * a cor dominante que a marca REALMENTE ficou na tela (não a que devia
 * ficar): desenha a imagem tingida num canvas e roda o mesmo histograma de
 * croma que o site usa para ler logos.
 *
 *   node test/theme-verify.mjs
 */
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const TYPES = { '.html':'text/html', '.png':'image/png', '.jpg':'image/jpeg',
                '.svg':'image/svg+xml', '.ico':'image/x-icon', '.js':'text/javascript',
                '.webmanifest':'application/manifest+json' };

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

/* ── medir a cor dominante de uma imagem já renderizada ──────────── */
function DOMINANT(sel){
  const img = document.querySelector(sel);
  const N = 96, cv = document.createElement('canvas');
  cv.width = cv.height = N;
  const cx = cv.getContext('2d', { willReadFrequently:true });
  cx.drawImage(img, 0, 0, N, N);
  const px = cx.getImageData(0, 0, N, N).data;
  const B = 36, w = new Float64Array(B), X = new Float64Array(B), Y = new Float64Array(B);
  const S = new Float64Array(B), L = new Float64Array(B);
  for (let i = 0; i < px.length; i += 4){
    if (px[i+3] < 128) continue;
    let r = px[i]/255, g = px[i+1]/255, b = px[i+2]/255;
    const mx = Math.max(r,g,b), mn = Math.min(r,g,b), l = (mx+mn)/2, d = mx-mn;
    if (!d) continue;
    const s = l > .5 ? d/(2-mx-mn) : d/(mx+mn);
    if (s < .16 || l < .08 || l > .95) continue;
    let h;
    if (mx === r) h = ((g-b)/d + (g<b?6:0)); else if (mx === g) h = (b-r)/d+2; else h = (r-g)/d+4;
    h *= 60;
    const ww = s * (1 - Math.abs(l*2-1)*.6), k = Math.floor(h/10) % B, rad = h*Math.PI/180;
    w[k]+=ww; X[k]+=Math.cos(rad)*ww; Y[k]+=Math.sin(rad)*ww; S[k]+=s*ww; L[k]+=l*ww;
  }
  let top = 0; for (let i=1;i<B;i++) if (w[i]>w[top]) top = i;
  let x=0,y=0,s=0,l=0,tw=0;
  for (let k=-1;k<=1;k++){ const i=(top+k+B)%B; x+=X[i]; y+=Y[i]; s+=S[i]; l+=L[i]; tw+=w[i]; }
  return tw ? { h:((Math.atan2(y,x)*180/Math.PI)%360+360)%360, s:s/tw, l:l/tw, flat:false }
            : { h:0, s:0, l:0, flat:true };   // imagem sem cor nenhuma
}

const hueGap = (a, b) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };

/* ── o que esperar de cada cor ───────────────────────────────────── */
const CASES = [
  { q:'',              want:{ h:21.9, s:100,  l:48.8 }, tinted:false, label:'padrão (#f95b00)' },
  { q:'?accent=00e0ff', want:{ h:187.3, s:100, l:50.0 }, tinted:true,  label:'ciano' },
  { q:'?accent=%23b400ff', want:{ h:282.4, s:100, l:50.0 }, tinted:true, label:'roxo' },
  { q:'?accent=1db954', want:{ h:141.2, s:73.4, l:42.0 }, tinted:true, label:'verde escuro (luz sobe ao piso)' },
  { q:'?accent=001f5b', want:{ h:219.6, s:100, l:42.0 }, tinted:true,  label:'azul-marinho (luz sobe ao piso)' },
  { q:'?accent=f0f0f0', want:{ h:0,    s:0,    l:68.0 }, tinted:true,  label:'quase branco (dessaturado)' },
];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport:{ width:420, height:900 } });
let bad = 0;

for (const c of CASES){
  await page.goto(BASE + c.q, { waitUntil:'load' });
  await page.waitForFunction(() => document.body.classList.contains('is-ready'), null, { timeout:8000 });
  await page.waitForFunction(() => !document.querySelector('img[data-tint].is-raw'), null, { timeout:8000 })
            .catch(() => {});

  const tok = await page.evaluate(() => {
    const cs = getComputedStyle(document.documentElement);
    return {
      h: parseFloat(cs.getPropertyValue('--accent-h')),
      s: parseFloat(cs.getPropertyValue('--accent-s')),
      l: parseFloat(cs.getPropertyValue('--accent-l')),
      qr: cs.getPropertyValue('--qr-ink').trim(),
      data: document.querySelector('#avatar').src.startsWith('data:'),
      raw:  !!document.querySelector('img[data-tint].is-raw')
    };
  });
  const sun  = await page.evaluate(DOMINANT, '#avatar');
  const core = await page.evaluate(DOMINANT, '#avatarCore');

  const fails = [];
  if (Math.abs(tok.h - c.want.h) > 1.2 && c.want.s > 1) fails.push(`token h ${tok.h} ≠ ${c.want.h}`);
  if (Math.abs(tok.s - c.want.s) > 1.2)                 fails.push(`token s ${tok.s} ≠ ${c.want.s}`);
  if (Math.abs(tok.l - c.want.l) > 1.2)                 fails.push(`token l ${tok.l} ≠ ${c.want.l}`);
  if (tok.data !== c.tinted)  fails.push(`arte ${tok.data ? '' : 'não '}foi redesenhada (esperado: ${c.tinted})`);
  if (tok.raw)                fails.push('sobrou imagem no filtro aproximado do CSS');
  // a marca precisa ter chegado na mesma matiz do tema
  if (c.want.s > 6){
    if (hueGap(sun.h,  c.want.h) > 6) fails.push(`matiz do sol ${sun.h.toFixed(1)}° ≠ ${c.want.h}°`);
    if (hueGap(core.h, c.want.h) > 6) fails.push(`matiz do miolo ${core.h.toFixed(1)}° ≠ ${c.want.h}°`);
  }

  bad += fails.length ? 1 : 0;
  console.log(`${fails.length ? '✗' : '✓'} ${c.label.padEnd(36)} ` +
              `token hsl(${tok.h} ${tok.s}% ${tok.l}%) · marca ${sun.h.toFixed(1)}° ` +
              `s${(sun.s*100).toFixed(0)}% l${(sun.l*100).toFixed(0)}% · qr ${tok.qr}`);
  fails.forEach((f) => console.log('    · ' + f));
}

/* ── 'auto' precisa continuar tirando a cor do próprio logo ──────── */
await page.goto(BASE + '?accent=auto', { waitUntil:'load' });
await page.waitForFunction(() => document.body.classList.contains('is-ready'), null, { timeout:8000 });
const auto = await page.evaluate(() => {
  const cs = getComputedStyle(document.documentElement);
  return { h:parseFloat(cs.getPropertyValue('--accent-h')),
           data:document.querySelector('#avatar').src.startsWith('data:') };
});
const autoOk = hueGap(auto.h, 21.7) < 3 && !auto.data;
bad += autoOk ? 0 : 1;
console.log(`${autoOk ? '✓' : '✗'} ${'auto (cor lida do logo)'.padEnd(36)} matiz ${auto.h}° · arte intacta: ${!auto.data}`);

await browser.close();
server.close();
console.log(bad ? `\n${bad} caso(s) com problema` : '\ntudo certo ✓');
process.exit(bad ? 1 : 0);
