#!/usr/bin/env python3
"""Cria um expert/avatar do jeito que o Reference Hub espera.
Uso: python3 scripts/novo-expert.py "Nome do Perfil" [--personagem "Nome do Avatar"] [--instagram @x] [--mercado BR] [--idioma pt-BR] [--nicho receitas] [--estilo 3d|realista]
- copia experts/_modelo-expert para experts/<Nome do Perfil>/
- registra o perfil em experts/perfis.json (o Hub lê ao iniciar: reabrir o Hub depois)
- grava a ficha (mercado, nicho, horários) em experts/<Nome>/ficha.json
O contact sheet e o producao.json entram depois, pela skill expert-identidade-visual."""
import argparse, json, re, shutil, unicodedata
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent


def slug(nome):
    s = unicodedata.normalize("NFKD", nome).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", "-", s).strip("-")


p = argparse.ArgumentParser()
p.add_argument("nome"); p.add_argument("--personagem")
for k in ("instagram", "mercado", "idioma", "nicho", "estilo", "cta_tema"):
    p.add_argument("--" + k.replace("_", "-"), dest=k, default="")
a = p.parse_args()
pasta = RAIZ / "experts" / a.nome
if pasta.exists():
    raise SystemExit(f"Já existe: experts/{a.nome}")
shutil.copytree(RAIZ / "experts/_modelo-expert", pasta)
nota = pasta / "_modelo-expert.md"
if nota.exists():
    nota.rename(pasta / f"{a.nome}.md")
for d in ("Contact Sheet", "Fotos", "Conteúdo", "07_entregas/videos-finais"):
    (pasta / d).mkdir(parents=True, exist_ok=True)
(pasta / "06_roadmap").mkdir(exist_ok=True)
pf = pasta / "06_roadmap/Postagens.md"
if not pf.exists():
    pf.write_text(f"# Postagens — {a.nome}\n\nperfil: {a.instagram}\n\nFonte única do calendário (o Reference Hub lê e grava aqui). Uma seção `##` por post.\n", encoding="utf-8")
s, ps = slug(a.nome), slug(a.personagem or a.nome)
cad = json.loads((RAIZ / "experts/perfis.json").read_text(encoding="utf-8"))
cad.append({"slug": s, "name": a.nome, "tipo": "operacao_propria_dr", "aliases": [], "vault_path": f"experts/{a.nome}",
            "painel_slug": None, "clients": [ps], "nomes": {ps: a.personagem or a.nome}})
(RAIZ / "experts/perfis.json").write_text(json.dumps(cad, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
ficha = {k: getattr(a, k) for k in ("instagram", "mercado", "idioma", "nicho", "estilo", "cta_tema")}
ficha["horarios"] = ["10:00", "15:00", "20:00"]
(pasta / "ficha.json").write_text(json.dumps(ficha, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(f"Expert criado: experts/{a.nome} (perfil {s}, personagem {ps}). Reabra o Hub para ele aparecer.")
