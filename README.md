# sunn — cartão digital de artista

Página pessoal em HTML, CSS e JavaScript puro. Sem frameworks, sem
bibliotecas, sem build. É só subir a pasta.

Fundo preto com ondas inspiradas na XMB do PlayStation 3, botões de vidro
com a física de toque do iOS, QR Code gerado na hora apontando para a
própria URL e suporte completo a PWA com modo offline.

**A cor do site sai do avatar.** Quando a página carrega, o logo é lido
pixel a pixel e a cor mais viva dele vira o acento de tudo: o brilho atrás
da marca, o ponto antes da cidade, as ondas do fundo, a borda dos botões
no toque, o anel de foco, o brilho do QR Code. Trocou a foto, trocou a
identidade — sem editar uma linha de CSS.

---

## Estrutura

```
index.html                 tudo: marcação, estilos, gerador de QR e lógica
manifest.webmanifest       manifesto do PWA
sw.js                      service worker (cache offline dos assets)
assets/
  avatar.jpg               SEU LOGO — a única imagem que você precisa trocar
  mark.png                 gerado: o logo recortado do fundo preto
  og.png                   gerado: imagem de compartilhamento (1200×630)
icons/                     gerados: favicons e ícones de PWA
splash/                    gerados: 12 telas de abertura de iPhone
build-assets.py            gera tudo que está marcado como "gerado"
test/                      QR Code, extração de cor e testes de navegador
```

---

## Trocar o logo

Substitua `assets/avatar.jpg` pelo seu (quadrado, fundo preto, de 512px
para cima) e rode:

```bash
pip install pillow
python3 build-assets.py
```

O script recorta a marca do fundo preto preservando os vazados internos,
detecta a cor dominante e regera ícones, favicons, splash screens e a
imagem de compartilhamento já nessa cor. O site em si não precisa de nada:
ele descobre a cor sozinho no navegador.

Para fixar uma cor à mão em vez de deixar o site decidir, edite os três
valores no `:root` do `index.html` e apague a chamada a `readAccent()` na
função `paint()`:

```css
--accent-h: 22;      /* matiz  0–360 */
--accent-s: 100%;    /* saturação */
--accent-l: 52%;     /* luminosidade */
```

### Como a cor é escolhida

Cada pixel entra num balde de matiz (10° cada) com peso igual ao seu croma
— o quanto a cor é colorida de verdade. Preto, branco e cinza não contam.
Vence o matiz de maior peso somado, não o mais frequente: senão o fundo
ganharia sempre. A saturação recebe um piso e a luminosidade é normalizada
para uma faixa legível, senão um vinho escuro ou um pastel claro viraria
um brilho ilegível sobre preto.

Casos cobertos por teste: logo cinza (mantém o laranja padrão), imagem
faltando, e imagem de outro domínio — em que o navegador bloqueia a
leitura do canvas e o site simplesmente segue com a cor padrão.

---

## Personalizar

### Textos e links

Um único bloco no fim do `index.html`, dentro do segundo `<script>`:

```js
const CONFIG = {
  name:    'sunn',
  eyebrow: 'Belo Horizonte · MG',
  bio:     '',                      // opcional — vazio some da página
  avatar:  './assets/mark.png',
  shape:   'mark',                  // 'mark' = logo solto · 'circle' = foto recortada
  footer:  '© 2026 sunn.',

  links: [
    { icon:'spotify', label:'Spotify', note:'Ouça meus lançamentos',
      url:'https://open.spotify.com/artist/…' },
    …
  ]
};
```

`note` é opcional. Ícones prontos: `spotify`, `applemusic`, `youtube`,
`instagram`, `tiktok`, `soundcloud`, `bandcamp`, `link`, `mail`. Para
adicionar outro, copie um `<symbol id="i-…">` do sprite no fim do arquivo
e use o id sem o prefixo `i-`.

Links `mailto:` e `tel:` são detectados e abrem na mesma aba.

`shape: 'circle'` volta ao recorte circular com aro de vidro — é o formato
certo se um dia você usar uma foto no lugar do logo.

### Título, descrição e Open Graph

No `<head>`: `<title>`, `meta[name=description]` e o bloco `og:` /
`twitter:`. São estáticos de propósito — é o que WhatsApp, Instagram e
Twitter leem antes de rodar qualquer JavaScript.

### Aparência

Os tokens ficam no `:root`, no topo do `<style>`: cores, raios, curvas de
easing e durações. Trocar `--radius-row` muda o arredondamento de todos os
botões; trocar `--ease` muda a personalidade de todas as animações.

As ondas são configuradas no array `BANDS`, dentro do módulo `Waves`. Cada
faixa tem posição vertical (`y`), amplitude (`amp`), comprimento de onda
(`len`), velocidade (`spd`), espessura (`thick`) e as opacidades do
preenchimento (`fill`) e do contorno (`line`) — tudo em frações da tela.

---

## Publicar

Qualquer hospedagem estática serve: GitHub Pages, Netlify, Vercel,
Cloudflare Pages ou um `public_html` comum.

Para o PWA funcionar por completo:

- **HTTPS** (ou `localhost`) — sem isso o service worker não registra;
- os arquivos ficam na **mesma pasta** uns dos outros; todos os caminhos
  são relativos (`./`), então funciona também em subdiretório.

Teste local:

```bash
python3 -m http.server 8000
# http://localhost:8000
```

Ao publicar uma atualização, incremente `VERSION` no `sw.js` — é o que faz
os aparelhos já instalados baixarem os arquivos novos.

### Instalar no iPhone

Safari → Compartilhar → **Adicionar à Tela de Início**. Abre em tela
cheia, com a tela de abertura preta e sem barra do navegador.

---

## Detalhes de implementação

**QR Code.** Codificador completo escrito do zero (modo byte, Reed-Solomon
sobre GF(256), seleção automática da menor versão e da máscara de menor
penalidade, versões 1 a 40). Gera SVG, então fica nítido em qualquer
tamanho, e funciona offline. O conteúdo é sempre a URL atual da página,
sem hash e sem parâmetros internos — abrir o site em outro domínio já gera
o QR certo, sem configurar nada.

**Ondas.** Desenhadas num canvas fora de tela em resolução baixa (~⅓ da
viewport) e borradas de uma vez só antes de ir para a tela. Borrar um
bitmap pequeno custa uma fração do que custaria um `filter` de CSS sobre a
viewport inteira — é o que sustenta os 60fps. Se ainda assim o aparelho
não acompanhar, o fundo reduz sozinho a cadência e a resolução. A cor é a
do acento puxada para o branco: vira luz quente, não tinta.

**Movimento.** Todas as transições usam `cubic-bezier(.32,.72,0,1)`, a
curva das folhas modais do iOS: começa rápido e assenta devagar, sem
ricochete. `prefers-reduced-motion` desliga a animação do fundo e a
entrada escalonada.

**Offline.** O service worker guarda o app shell na instalação. Navegação
tenta a rede primeiro e cai para o cache; os demais arquivos vêm do cache
e revalidam em segundo plano.

**Tipografia.** SF Pro Display quando disponível (iPhone, iPad, Mac),
Inter como alternativa nos demais sistemas.

---

## Testes

```bash
# QR Code: decodificação real + comparação com implementação de referência
pip install zxing-cpp qrcode pillow
python3 test/qr-verify.py

# a cor acompanha o avatar: nove logos de cores diferentes + casos-limite
node test/accent-verify.mjs

# navegador: console, animações, modal, offline, service worker, capturas
npm i playwright && npx playwright install chromium
node test/browser.mjs
```

`test/browser.mjs` salva capturas em `test/shots/`.

---

## Acessibilidade

Contraste conferido nos textos principais, foco visível pelo teclado,
`Esc` e clique no fundo fecham o modal, foco preso enquanto ele está
aberto e devolvido ao botão de origem ao fechar, `aria-label` nos botões
só de ícone, e respeito a `prefers-reduced-motion` e `prefers-contrast`.
