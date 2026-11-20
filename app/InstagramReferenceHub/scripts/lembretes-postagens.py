#!/usr/bin/env python3
"""Espelha os posts agendados do Hub no app Lembretes (lista "Postagens"), um lembrete por horário.

Roda uma vez quando um post é marcado ou muda de data no Hub (server/posts.ts); não há rotina periódica. Hub desligado = não mexe em nada,
e os lembretes já criados continuam tocando. Só toca em lembretes desta lista que têm a linha [slot ...].
Horário sem post pendente (postado ou movido) é concluído e vai para a lista "Postagens antigos", para não ficar nesta. Concluído perde a data (sem-data), senão continua no app Calendário. Lembrete concluído à mão não volta; concluído por aqui volta se o horário ganhar post de novo.
Uso: lembretes-postagens.py [--dry]
"""
from __future__ import annotations

import collections
import datetime as dt
import fcntl
import hashlib
import json
import pathlib
import re
import subprocess
import sys
import urllib.request

HUB = "http://127.0.0.1:4317"
LISTA = "Postagens"
ANTIGOS = "Postagens antigos"
ESTADO = pathlib.Path.home() / "Library/Application Support/LembretesPostagens/ultimo.txt"
AUTO = ESTADO.with_name("concluidos-auto.json")
TRAVA = ESTADO.with_name("sync.lock")
SEM_DATA = ESTADO.with_name("sem-data")
SLOT = re.compile(r"\[slot (\S+)\]")

JXA = r"""
function run(argv) {
  const { lista, antigos, criar, atualizar, concluir, mover, ler } = JSON.parse(argv[0]);
  const app = Application("Reminders");
  let l = app.lists.whose({ name: lista })();
  if (!l.length) { app.lists.push(app.List({ name: lista })); l = app.lists.whose({ name: lista })(); }
  const alvo = l[0];
  if (ler) {
    // Lê cada propriedade em bloco: lembrete por lembrete leva minutos.
    const rs = alvo.reminders, nomes = rs.name(), corpos = rs.body(), feitos = rs.completed();
    return JSON.stringify(rs.id().map((id, i) => ({ id, name: nomes[i], body: corpos[i] || "", completed: feitos[i] })));
  }
  for (const c of criar) {
    const d = new Date(c.quando);
    alvo.reminders.push(app.Reminder({ name: c.name, body: c.body, dueDate: d, remindMeDate: d }));
  }
  for (const a of atualizar) { const r = alvo.reminders.byId(a.id); r.name = a.name; r.body = a.body; }
  for (const id of concluir) alvo.reminders.byId(id).completed = true;
  if (mover.length) {
    let d = app.lists.whose({ name: antigos })();
    if (!d.length) { app.lists.push(app.List({ name: antigos })); d = app.lists.whose({ name: antigos })(); }
    for (const id of mover) app.move(alvo.reminders.byId(id), { to: d[0] });
  }
  return "ok";
}
"""


def lembretes(**op):
    base = {"lista": LISTA, "antigos": ANTIGOS, "criar": [], "atualizar": [], "concluir": [], "mover": [], "ler": False, **op}
    r = subprocess.run(["osascript", "-l", "JavaScript", "-e", JXA, json.dumps(base)], capture_output=True, text=True, timeout=120)
    if r.returncode:
        raise RuntimeError(r.stderr.strip())
    return r.stdout.strip()


def horarios():
    """{agendado_para: {name, body, quando}} dos posts pendentes."""
    with urllib.request.urlopen(f"{HUB}/api/posts", timeout=8) as res:
        itens = json.load(res)["itens"]
    por_slot = collections.defaultdict(list)
    for p in itens:
        if p.get("stage") == "agendada" and p.get("agendado_para"):
            por_slot[p["agendado_para"]].append(p)
    saida = {}
    for slot, posts in sorted(por_slot.items()):
        nomes = list(dict.fromkeys((p["perfil"] or {}).get("name") or "Perfil" for p in posts))
        hora = dt.datetime.fromisoformat(slot.replace("Z", "+00:00")).astimezone().strftime("%H:%M")
        linhas = [f"• {(p['perfil'] or {}).get('name')}: {' '.join((p.get('titulo') or 'post').split())[:90]}" for p in posts]
        saida[slot] = {"name": f"Postar {hora} · {', '.join(nomes)}", "quando": slot,
                       "body": "\n".join([*linhas, "", f"Legenda e vídeo: {HUB}/postar", f"[slot {slot}]"])}
    return saida


def tirar_da_agenda():
    r = subprocess.run([str(SEM_DATA)], capture_output=True, text=True, timeout=60)
    if r.stdout.strip() or r.stderr.strip():
        print(r.stdout.strip() or r.stderr.strip())


def main():
    dry = "--dry" in sys.argv
    ESTADO.parent.mkdir(parents=True, exist_ok=True)
    trava = TRAVA.open("w")
    fcntl.flock(trava, fcntl.LOCK_EX)  # duas rodadas juntas criariam lembrete em dobro
    try:
        queridos = horarios()
    except OSError:
        print("Hub desligado: nada alterado")
        return
    resumo = hashlib.sha256(json.dumps(queridos, sort_keys=True).encode()).hexdigest()
    if not dry:
        tirar_da_agenda()  # também pega lembrete concluído à mão, que não muda o resumo
    if not dry and ESTADO.exists() and ESTADO.read_text() == resumo:
        return
    existentes = {}
    mover = []
    todos = json.loads(lembretes(ler=True) or "[]")
    abertos = {m[1] for r in todos if not r["completed"] and (m := SLOT.search(r["body"]))}
    for r in todos:
        m = SLOT.search(r["body"])
        if m and r["completed"] and (m[1] not in queridos or m[1] in abertos):
            mover.append(r["id"])
        if m and (m[1] not in existentes or existentes[m[1]]["completed"]):
            existentes[m[1]] = r
    auto = set(json.loads(AUTO.read_text())) if AUTO.exists() else set()
    agora = dt.datetime.now(dt.timezone.utc)
    futuro = lambda s: dt.datetime.fromisoformat(s.replace("Z", "+00:00")) > agora
    voltam = {s for s in queridos if s in existentes and existentes[s]["completed"] and s in auto and futuro(s)}
    criar = [q for s, q in queridos.items() if (s not in existentes or s in voltam) and futuro(s)]
    atualizar = [{"id": r["id"], "name": queridos[s]["name"], "body": queridos[s]["body"]} for s, r in existentes.items()
                 if s in queridos and not r["completed"] and (r["name"], r["body"]) != (queridos[s]["name"], queridos[s]["body"])]
    saindo = {s for s, r in existentes.items() if s not in queridos and not r["completed"]}
    concluir = [existentes[s]["id"] for s in saindo]
    mover += concluir
    print(f"{dt.datetime.now():%d/%m %H:%M} criar {len(criar)} · atualizar {len(atualizar)} · concluir {len(concluir)} · mover {len(mover)}")
    if dry:
        for c in criar[:5]:
            print(" ", c["quando"], c["name"])
        return
    if criar or atualizar or concluir or mover:
        lembretes(criar=criar, atualizar=atualizar, concluir=concluir, mover=mover)
    tirar_da_agenda()
    AUTO.write_text(json.dumps(sorted((auto | saindo) - voltam)))
    ESTADO.write_text(resumo)


if __name__ == "__main__":
    main()
