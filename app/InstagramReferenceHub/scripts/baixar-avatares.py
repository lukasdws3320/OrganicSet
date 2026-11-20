#!/usr/bin/env python3
"""Baixa a foto de perfil pública (og:image) de cada @criador para library/avatars/<username>.jpg.

Só lê o banco. Pula quem já tem foto; use --forcar para rebaixar.
Uso: python3 -I scripts/baixar-avatares.py [--forcar]
"""
import html, os, re, sqlite3, sys, time, urllib.request
from pathlib import Path

LIB = Path(os.environ.get("IRH_LIBRARY") or Path(__file__).resolve().parent.parent / "library")
OUT = LIB / "avatars"
UA = {"User-Agent": "facebookexternalhit/1.1"}


def og_image(username):
    req = urllib.request.Request(f"https://www.instagram.com/{username}/", headers=UA)
    page = urllib.request.urlopen(req, timeout=15).read().decode("utf-8", "replace")
    m = re.search(r'og:image" content="([^"]+)', page)
    return html.unescape(m.group(1)) if m else None


def main():
    forcar = "--forcar" in sys.argv
    OUT.mkdir(exist_ok=True)
    db = sqlite3.connect(f"file:{LIB / 'database' / 'irh.sqlite'}?mode=ro", uri=True)
    nomes = [r[0] for r in db.execute("SELECT DISTINCT username FROM refs WHERE username IS NOT NULL AND username <> '' ORDER BY 1")]
    ok = pulou = falhou = 0
    for u in nomes:
        if not re.fullmatch(r"[A-Za-z0-9._]{1,30}", u):
            continue
        dest = OUT / f"{u}.jpg"
        if dest.exists() and not forcar:
            pulou += 1
            continue
        try:
            url = og_image(u)
            if not url:
                raise ValueError("sem og:image")
            data = urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=15).read()
            dest.write_bytes(data)
            ok += 1
        except Exception as e:  # perfil privado, removido ou bloqueio temporário
            falhou += 1
            print(f"falhou @{u}: {e}")
        time.sleep(0.6)
    print(f"{ok} baixadas · {pulou} já existiam · {falhou} falharam · em {OUT}")


if __name__ == "__main__":
    main()
