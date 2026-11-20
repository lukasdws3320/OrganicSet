#!/usr/bin/env python3
"""Confere a agenda contra repetição. Só lê. Saída 0 e "SEM REPETICAO" quando está tudo certo.

Regras (05/11/2026): só V1 e V2; mesma receita no mesmo perfil só depois de 4 dias; a mesma legenda
(receita + versão) só depois de 7; a mesma receita não sai no mesmo dia nos dois perfis; legenda até 1000 caracteres.
Par em que os dois já foram postados é histórico e não conta.
"""
import datetime as dt, json, sys, urllib.request

PERFIS = ("bruno-goytacaz", "mini-chefs-da-vovo")
itens = json.load(urllib.request.urlopen("http://127.0.0.1:4317/api/posts", timeout=20))["itens"]
vivos = [p for p in itens if p["perfil"]["slug"] in PERFIS and p["data"] and p["publicacao"] in ("postado", "a_publicar")]
dia = lambda p: dt.date.fromisoformat(p["data"])
erros = []
for p in vivos:
    if p["publicacao"] != "a_publicar":
        continue
    if (p["versao"] or "V1") not in ("V1", "V2"):
        erros.append(f"{p['id']}: versão {p['versao']}")
    if len(p["legenda"] or "") > 1000:
        erros.append(f"{p['id']}: legenda com {len(p['legenda'])} caracteres")
    for q in vivos:
        if q is p or not p["ref"] or q["ref"] != p["ref"] or (q["publicacao"] == "a_publicar" and q["id"] < p["id"]):
            continue
        gap = abs((dia(p) - dia(q)).days)
        if q["perfil"]["slug"] != p["perfil"]["slug"]:
            if gap == 0:
                erros.append(f"{p['id']} e {q['id']}: mesma receita no mesmo dia nos dois perfis ({p['data']})")
        elif (q["versao"] or "V1") == (p["versao"] or "V1") and gap < 7:
            erros.append(f"{p['id']} e {q['id']}: mesma legenda com {gap} dias")
        elif gap < 4:
            erros.append(f"{p['id']} e {q['id']}: mesma receita com {gap} dias")
print("\n".join(erros) or "SEM REPETICAO")
print(f"{sum(p['publicacao'] == 'a_publicar' for p in vivos)} posts a publicar conferidos · {len(erros)} problemas")
sys.exit(1 if erros else 0)
