// Extrai o codificador QR do index.html e imprime a matriz para conferência.
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const block = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)]
  .map(m => m[1])
  .find(s => s.includes('const QR = (() =>'));
if (!block) throw new Error('bloco do QR não encontrado');

const QR = eval(block + '; QR');

const cases = JSON.parse(process.argv[2]);
const out = cases.map(({ text, ecc }) => {
  const qr = QR.build(text, ecc);
  return {
    text, ecc,
    version: qr.version,
    mask: qr.mask,
    size: qr.size,
    rows: qr.modules.map(r => Array.from(r).join(''))
  };
});
console.log(JSON.stringify(out));
