#!/usr/bin/env python3
"""Recalcula o calendário de postagens: atrasados primeiro, mesma receita só depois de 4 dias, mesma legenda só depois de 7, e refaz os lembretes.

Só simula sem --aplicar. Com --aplicar grava pelo Hub, roda scripts/lembretes-postagens.py e confere os lembretes.
Horário fora da grade do perfil (ex.: Reels teste às 22:00) e post já postado não mudam.
Uso: agenda-recalcular.py [--perfis bruno-goytacaz,mini-chefs-da-vovo] [--de AAAA-MM-DD] [--primeiro id,id] [--aplicar]
     agenda-recalcular.py --conferir
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import pathlib
import re
import subprocess
import sys
import urllib.request

HUB = "http://127.0.0.1:4317"
AQUI = pathlib.Path(__file__).resolve().parent
VAULT = pathlib.Path(os.environ.get("IRH_VAULT") or pathlib.Path(__file__).resolve().parents[3]) / "experts"
NOTAS = {
    "bruno-goytacaz": "01_experts/Bruno Goytacaz",
    "mini-chefs-da-vovo": "02_experts-ia/Mini Chefs da Vovó",
    "nutri-giovana-castro": "02_experts-ia/Nutri Giovana Castro",
}
# Bruno: vídeo de IA nestes horários enquanto houver; repostagem no resto.
HORAS_IA = {"bruno-goytacaz": {"09:00", "15:00", "21:00"}}
ASSUNTOS = ("quem aí vai nos ajudar", "bonito pelado", "coca", "ovo")
FUSO = dt.timezone(dt.timedelta(hours=-3))


def api(metodo, rota, corpo=None):
    r = urllib.request.Request(HUB + rota, method=metodo, headers={"content-type": "application/json"},
                               data=json.dumps(corpo).encode() if corpo is not None else None)
    with urllib.request.urlopen(r, timeout=20) as res:
        return json.load(res)


def remarcados(slug):
    """{id: 'AAAA-MM-DD HH:MM'} dos posts que a agenda automática empurrou para o fim."""
    texto = (VAULT / NOTAS[slug] / "06_roadmap/Postagens.md").read_text(encoding="utf-8")
    saida = {}
    for sec in re.split(r"^## ", texto, flags=re.M):
        i, r = re.search(r"^id: (.+)$", sec, re.M), re.search(r"^remarcado_de: (.+)$", sec, re.M)
        if i and r:
            saida[i[1].strip()] = r[1].strip()
    return saida


def assunto(p):
    t = (p["titulo"] or "").lower()
    return next((a for a in ASSUNTOS if a in t), p["id"])


# Mesma receita no mesmo perfil só volta depois de FOLGA_REF dias; a mesma legenda (receita + versão), depois de FOLGA_LEGENDA.
FOLGA_REF, FOLGA_LEGENDA = 4, 7


def planejar(slug, itens, cfg, de, primeiro, agora, outros, hoje=None):
    """outros: {ref: set(datas)} do outro perfil, para não sair a mesma receita no mesmo dia nos dois."""
    horarios, meta = cfg["horarios"], cfg["meta"]
    meus = [p for p in itens if p["perfil"]["slug"] == slug]
    dia = lambda p: dt.date.fromisoformat(p["data"]) if p["data"] else None
    abertos = [p for p in meus if p["publicacao"] == "a_publicar"]
    grade = lambda d: hoje if hoje and d == de else horarios
    fixos = [p for p in abertos if p["data"] and p["hora"] not in grade(dia(p)) and dia(p) >= de and p["id"] not in primeiro]
    fila = [p for p in abertos if p not in fixos]
    voltas = remarcados(slug)
    atrasado = lambda p: p["id"] in primeiro or (p["data"] and dia(p) < de) or voltas.get(p["id"], "9") < de.isoformat()
    fila.sort(key=lambda p: (not atrasado(p), primeiro.index(p["id"]) if p["id"] in primeiro else 99,
                             voltas.get(p["id"], "") if atrasado(p) else "", p["data"] or "9", p["hora"] or ""))
    atrasados = [p["id"] for p in fila if atrasado(p)]
    dias_ref, dias_leg, ocupadas = {}, {}, {}
    leg = lambda p: (p["ref"], p["versao"] or "V1")
    def marca(p, d):
        if p["ref"]:
            dias_ref.setdefault(p["ref"], set()).add(d)
            dias_leg.setdefault(leg(p), set()).add(d)
            outros.setdefault(p["ref"], set()).add(d)
    for p in meus:
        if p["data"] and (p["publicacao"] == "postado" or p in fixos):
            marca(p, dia(p))
    for p in meus:
        if p["publicacao"] == "postado" and p["data"] and dia(p) >= de:
            ocupadas.setdefault(dia(p), set()).add(p["hora"])
    perto = lambda datas, d: min((abs((d - x).days) for x in datas), default=99)
    pode = lambda p, d: not p["ref"] or (perto(dias_ref.get(p["ref"], ()), d) >= FOLGA_REF
                                         and perto(dias_leg.get(leg(p), ()), d) >= FOLGA_LEGENDA)
    # Perfil só de receitas (Mini Chefs): espalhar por igual, no máximo receitas/FOLGA_REF por dia, para não ter dia cheio e dia vazio.
    if fila and all(p["ref"] for p in fila):
        meta = min(meta, -(-len({p["ref"] for p in fila}) // FOLGA_REF))
    plano, d = [], de
    while fila and d < de + dt.timedelta(days=60):
        usados = set()
        livres = [h for h in grade(d) if h not in ocupadas.get(d, set())]
        livres = livres[:max(0, meta - len(ocupadas.get(d, set())))]
        for h in livres:
            if d == agora.date() and h <= (agora + dt.timedelta(minutes=30)).strftime("%H:%M"):
                continue
            quer_ia = h in HORAS_IA.get(slug, ())
            opcoes = [p for p in fila if pode(p, d) and not (p["ref"] and d in outros.get(p["ref"], ()))]
            if not opcoes:
                continue
            def nota(p):
                tipo = bool(p["ref"]) == quer_ia or slug not in HORAS_IA
                mesmo_dia = bool(p["ref"]) and d in outros.get(p["ref"], ())
                return (not atrasado(p), assunto(p) in usados, not tipo)
            escolhido = min(opcoes, key=lambda p: (nota(p), fila.index(p)))
            fila.remove(escolhido)
            usados.add(assunto(escolhido))
            marca(escolhido, d)
            plano.append((escolhido, d, h))
        d += dt.timedelta(days=1)
    return plano, atrasados


def lembretes():
    return subprocess.run(["/opt/homebrew/bin/python3", str(AQUI / "lembretes-postagens.py")], capture_output=True, text=True, timeout=300).stdout.strip()


def conferir():
    """Todo horário futuro com um lembrete aberto, nada a mais, nada em dobro. Retorna True se está certo."""
    sys.path.insert(0, str(AQUI))
    import importlib.util
    sp = importlib.util.spec_from_file_location("lp", AQUI / "lembretes-postagens.py")
    m = importlib.util.module_from_spec(sp)
    sp.loader.exec_module(m)
    agora = dt.datetime.now(dt.timezone.utc)
    futuro = lambda s: dt.datetime.fromisoformat(s.replace("Z", "+00:00")) > agora
    quer = {s for s in m.horarios() if futuro(s)}
    abertos = [m.SLOT.search(r["body"])[1] for r in json.loads(m.lembretes(ler=True) or "[]") if not r["completed"] and m.SLOT.search(r["body"])]
    faltam, sobram = sorted(quer - set(abertos)), sorted(set(abertos) - quer)
    dobro = sorted({s for s in abertos if abertos.count(s) > 1})
    concl = subprocess.run([str(m.SEM_DATA), "--conferir"], capture_output=True, text=True, timeout=60).stdout.splitlines()
    print(f"Lembretes: {len(abertos)} abertos · {len(quer)} horários futuros · faltam {len(faltam)} · sobram {len(sobram)} · em dobro {len(dobro)}")
    print(concl[0] if concl else "sem-data não respondeu")
    return not (faltam or sobram or dobro) and bool(concl) and concl[0].startswith("concluidos com data: 0 ")


def main():
    a = argparse.ArgumentParser()
    a.add_argument("--perfis", default="bruno-goytacaz,mini-chefs-da-vovo")
    a.add_argument("--de")
    a.add_argument("--primeiro", default="")
    a.add_argument("--horarios-hoje", default="", help="grade só do primeiro dia, ex.: 17:00,19:00,21:00")
    a.add_argument("--aplicar", action="store_true")
    a.add_argument("--conferir", action="store_true")
    o = a.parse_args()
    if o.conferir:
        sys.exit(0 if conferir() else 1)
    agora = dt.datetime.now(FUSO).replace(tzinfo=None)
    de = dt.date.fromisoformat(o.de) if o.de else agora.date()
    primeiro = [x for x in o.primeiro.split(",") if x]
    itens = api("GET", "/api/posts")["itens"]
    ag = api("GET", "/api/agenda")
    mudancas, outros = [], {}
    for slug in o.perfis.split(","):
        cfg = ag["perfis"].get(slug) or {"meta": ag["meta"], "horarios": ag["horarios"]}
        plano, atrasados = planejar(slug, itens, cfg, de, primeiro, agora, outros, [x for x in o.horarios_hoje.split(",") if x])
        print(f"\n== {slug} · {cfg['meta']} por dia · atrasados na frente: {atrasados or 'nenhum'}")
        for p, d, h in plano:
            marca = "" if p["data"] == d.isoformat() and p["hora"] == h else f"  (era {p['data'] or 'sem data'} {p['hora'] or ''})"
            print(f"{d:%d/%m} {h}  {(p['ref'] or 'repost')[-6:]:6} {(p['personagem'] or '').rsplit('-', 1)[-1][:6]:6} {p['versao'] or '':3} {(p['titulo'] or '')[:42]}{marca}")
            if marca:
                mudancas.append((p["id"], f"{d.isoformat()}T{h}:00-03:00"))
    print(f"\n{len(mudancas)} posts mudam de horário")
    if not o.aplicar:
        print("Simulação: nada gravado. Para gravar, repetir com --aplicar.")
        return
    for pid, quando in mudancas:
        api("PATCH", f"/api/posts/{pid}", {"agendado_para": quando})
    print(lembretes() or "Lembretes: sem mudança")
    sys.exit(0 if conferir() else 1)


if __name__ == "__main__":
    main()
