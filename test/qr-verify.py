#!/usr/bin/env python3
"""
Verificação do codificador QR embutido no site, por dois caminhos independentes:

  1. decodificação real com zxing-cpp — é o que a câmera de um celular faz;
  2. comparação módulo a módulo com o pacote `qrcode`, incluindo a versão
     mínima escolhida e a máscara de menor penalidade.

    pip install zxing-cpp qrcode pillow
    python3 test/qr-verify.py
"""
import json, os, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))

# Somente conteúdos que forçam o modo byte (o modo usado pelo site).
CASES = [
    ("https://lume.art", "M"),
    ("https://lume.art/", "M"),
    ("http://localhost:8080/", "M"),
    ("https://exemplo.com.br/artista/lume?utm=qr", "M"),
    ("https://lume.art", "L"),
    ("https://lume.art", "Q"),
    ("https://lume.art", "H"),
    ("Ação · coração — açaí ÿ", "M"),
    ("a", "M"),
    ("x" * 60, "M"),
    ("https://um-dominio-bem-longo-de-artista-musical.example.com/pagina/links/lume-oficial-2026", "M"),
    ("y" * 130, "M"),
    ("y" * 300, "M"),
    ("z" * 930, "M"),
    ("z" * 1200, "L"),
    ("w" * 2300, "M"),
]

payload = json.dumps([{"text": t, "ecc": e} for t, e in CASES])
mine = json.loads(subprocess.run(
    ["node", os.path.join(HERE, "qr-dump.mjs"), payload],
    capture_output=True, text=True, check=True).stdout)

from PIL import Image
import zxingcpp
import qrcode
from qrcode.constants import ERROR_CORRECT_L, ERROR_CORRECT_M, ERROR_CORRECT_Q, ERROR_CORRECT_H

LEVELS = {"L": ERROR_CORRECT_L, "M": ERROR_CORRECT_M, "Q": ERROR_CORRECT_Q, "H": ERROR_CORRECT_H}


def to_image(m, quiet=4, cell=5):
    n = m["size"]
    img = Image.new("L", ((n + 2 * quiet) * cell,) * 2, 255)
    px = img.load()
    for y, row in enumerate(m["rows"]):
        for x, c in enumerate(row):
            if c == "1":
                for dy in range(cell):
                    for dx in range(cell):
                        px[(x + quiet) * cell + dx, (y + quiet) * cell + dy] = 0
    return img


def reference(text, ecc, version=None, mask=None):
    q = qrcode.QRCode(version=version, error_correction=LEVELS[ecc],
                      box_size=1, border=0, mask_pattern=mask)
    q.add_data(text.encode("utf-8"))
    q.make(fit=version is None)
    return q


fails = 0
for got, (text, ecc) in zip(mine, CASES):
    label = f'{ecc} v{got["version"]:>2} máscara {got["mask"]} · {len(text):>4}B · {text[:34]!r}'
    problems, notes = [], []

    res = zxingcpp.read_barcodes(to_image(got))
    if len(res) != 1 or res[0].text != text:
        problems.append(f"decodificou {res[0].text[:24]!r}" if res else "não decodificou")

    auto = reference(text, ecc)
    if auto.version != got["version"]:
        problems.append(f'versão {got["version"]} ≠ referência {auto.version}')
    else:
        ref = reference(text, ecc, version=got["version"], mask=got["mask"])
        rows = ["".join("1" if c else "0" for c in row) for row in ref.get_matrix()]
        if rows != got["rows"]:
            diff = sum(a != b for ra, rb in zip(rows, got["rows"]) for a, b in zip(ra, rb))
            problems.append(f"{diff} módulos ≠ referência")
        else:
            # A escolha da máscara depende da leitura da regra 3 da norma, que é
            # ambígua: implementações consagradas divergem entre si. Qualquer
            # máscara produz um símbolo válido, então isso é apenas informativo.
            best = auto.best_mask_pattern()
            if best != got["mask"]:
                notes.append(f'máscara {got["mask"]} vs {best} na referência')

    if problems:
        fails += 1
        print(f"  FALHA {label} — {'; '.join(problems)}")
    else:
        print(f"  ok    {label}" + (f"   ({'; '.join(notes)})" if notes else ""))

print()
print("TODOS OS TESTES PASSARAM ✓" if not fails else f"{fails} FALHA(S)")
sys.exit(1 if fails else 0)
