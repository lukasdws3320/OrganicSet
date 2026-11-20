#!/usr/bin/env python3
"""Confere uma legenda antes de entregar. Uso: checar_legenda.py --perfil @handle [--palavra "EU QUERO"] [--max 1000] arquivo.txt|-"""
import argparse, re, sys

HANDLES_ERRADOS = {"@otimedasestrelas": ["@onutridasestrelas"], "@minichefsdavovo": ["@cozinheirasdavovo"]}
SAUDE = re.compile(r"(?i)emagre|secar|queima|detox|caloria|kcal|sem culpa|\bcura\b|trata(r)? (a|o)")
GENERICO = re.compile(r"(?i)quer comer gostoso")

def main():
    p = argparse.ArgumentParser(); p.add_argument("--perfil", required=True); p.add_argument("--palavra"); p.add_argument("--max", type=int, default=1000); p.add_argument("arquivo")
    a = p.parse_args()
    t = sys.stdin.read() if a.arquivo == "-" else open(a.arquivo, encoding="utf-8").read()
    t = t.strip("\n"); n = len(t.encode("utf-16-le")) // 2; erros, avisos = [], []
    if n > a.max: erros.append(f"{n} caracteres, acima de {a.max}: corta no caractere {a.max}")
    for h in re.findall(r"@[\w.]+", t):
        if h.lower() != a.perfil.lower(): (erros if h.lower() in [x.lower() for x in HANDLES_ERRADOS.get(a.perfil.lower(), [])] else avisos).append(f"@ diferente do perfil: {h}")
    if a.palavra and a.palavra.lower() not in t.lower(): erros.append(f"palavra de comentário ausente: {a.palavra}")
    if "—" in t: avisos.append("travessão no texto")
    for m in SAUDE.finditer(t): avisos.append(f"possível promessa de saúde: '{m.group(0)}'")
    if GENERICO.search(t): avisos.append("bloco genérico antigo do Cardápio")
    print(f"{n} caracteres")
    for x in erros: print("ERRO", x)
    for x in avisos: print("AVISO", x)
    sys.exit(1 if erros else 0)

if __name__ == "__main__":
    main()
