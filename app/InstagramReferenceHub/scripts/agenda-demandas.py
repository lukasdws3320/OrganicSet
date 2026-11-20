#!/usr/bin/env python3
"""Mantém os blocos de trabalho do app Calendário iguais às tarefas (T-n) do Hub, que são a fonte única das demandas.

Roda sozinho quando uma tarefa muda de situação no Hub (server/tarefas.ts), de 10 em 10 minutos como rede de segurança,
e pode ser rodado à mão. Só mexe em eventos que citam um código T-n no título ou na descrição e que ainda não terminaram:
- bloco FUTURO com todas as T-n feitas (e nada além delas) = sai da agenda (fica guardado para voltar);
- bloco EM ANDAMENTO com todas as T-n feitas = é encerrado agora (fim = agora, título com ✓); reaberta = volta ao fim original;
- parte feita, ou o bloco tem mais coisa além das T-n = o bloco fica e as feitas ganham "✓" na descrição;
- horário liberado no dia = os próximos blocos de T-n ainda abertas do MESMO dia sobem para ocupá-lo (realoca);
- tarefa reaberta = o bloco guardado volta no mesmo horário, se ainda não passou.
Evento sem T-n (call, reunião, almoço) nunca é tocado nem movido. Fonte ilegível = não mexe em nada.
As tarefas vêm do CLI `scripts/tarefas.ts listar --todas` (fonte canônica do registro do vault), não do HTTP do Hub:
funciona com o Hub desligado. Leitura apenas; nenhuma regra de tarefa é reimplementada aqui.
Uso: agenda-demandas.py [--dry] [--db CAMINHO_FIXTURE]
"""
from __future__ import annotations

import datetime as dt
import fcntl
import json
import os
import pathlib
import re
import shutil
import subprocess
import sys
from zoneinfo import ZoneInfo

CLI_PADRAO = pathlib.Path(__file__).resolve().parent / "tarefas.ts"
PASTA = pathlib.Path.home() / "Library/Application Support/AgendaDemandas"
GUARDADOS = PASTA / "removidos.json"
TRAVA = PASTA / "sync.lock"
DIAS = 21
FUSO = ZoneInfo("America/Sao_Paulo")
COD = re.compile(r"\bT-(\d+)(?:\s*(?:a|até|-|–)\s*T-(\d+))?")
FEITO = "✓ "
MIN_LIVRE = dt.timedelta(minutes=10)  # sobra menor que isso não vale realocar

JXA = r"""
function run(argv) {
  const p = JSON.parse(argv[0]);
  const app = Application("Calendar");
  const ini = new Date(p.ini), fim = new Date(p.fim);
  if (p.ler) {
    const out = [];
    app.calendars().forEach(c => {
      let ws = false; try { ws = c.writable(); } catch (e) {}
      if (!ws) return;
      let evs = [];
      try { evs = c.events.whose({_and: [{endDate: {_greaterThan: ini}}, {startDate: {_lessThan: fim}}]})(); } catch (e) { return; }
      evs.forEach(x => {
        let dia = false; try { dia = x.alldayEvent(); } catch (e) {}
        if (dia) return;
        const s = x.summary() || "", d = x.description() || "";
        out.push({cal: c.name(), uid: x.uid(), titulo: s, desc: d, ini: x.startDate().toISOString(), fim: x.endDate().toISOString(), local: x.location() || ""});
      });
    });
    return JSON.stringify(out);
  }
  const achar = (cal, uid) => { const r = app.calendars.byName(cal).events.whose({uid: uid})(); return r.length ? r[0] : null; };
  (p.remover || []).forEach(e => { const x = achar(e.cal, e.uid); if (x) app.delete(x); });
  (p.descrever || []).forEach(e => { const x = achar(e.cal, e.uid); if (x) x.description = e.desc; });
  (p.ajustar || []).forEach(e => {
    const x = achar(e.cal, e.uid); if (!x) return;
    const a = new Date(e.ini), b = new Date(e.fim);
    if (a < x.endDate()) { x.startDate = a; x.endDate = b; } else { x.endDate = b; x.startDate = a; }
    if (e.titulo !== undefined) x.summary = e.titulo;
  });
  const criados = [];
  (p.criar || []).forEach(e => {
    const c = app.calendars.byName(e.cal);
    const n = app.Event({summary: e.titulo, startDate: new Date(e.ini), endDate: new Date(e.fim), description: e.desc, location: e.local});
    c.events.push(n);
    criados.push({chave: e.chave, uid: n.uid()});
  });
  return JSON.stringify({criados});
}
"""


def vault() -> pathlib.Path:
    return pathlib.Path(os.path.expanduser(os.environ.get("BRAIN_VAULT") or os.environ.get("IRH_VAULT") or str(pathlib.Path(__file__).resolve().parents[3])))


def cli_tarefas() -> pathlib.Path:
    """CLI declarado no registro de fontes (entrada tarefas); sem registro legível, o deste repositório."""
    try:
        reg = json.loads((vault() / "01_Memoria/Brain/fontes.json").read_text())
        cli = next(f.get("cli") for f in reg["fontes"] if f.get("id") == "tarefas")
        if cli:
            p = pathlib.Path(os.path.expanduser(cli))
            return p if p.is_absolute() else vault() / p
    except Exception:
        pass
    return CLI_PADRAO


def ler_tarefas(db: str | None = None, timeout: float = 30) -> dict[int, dict]:
    """Lê todas as tarefas pelo CLI (argv, sem shell). Qualquer falha levanta RuntimeError: quem chama não mexe na agenda."""
    bun = shutil.which("bun") or str(pathlib.Path.home() / ".bun/bin/bun")
    argv = [bun, str(cli_tarefas()), "listar", "--todas", "--sem-agenda"] + (["--db", db] if db else [])
    try:
        r = subprocess.run(argv, capture_output=True, text=True, timeout=timeout)
    except (OSError, subprocess.TimeoutExpired) as e:
        raise RuntimeError(f"CLI de tarefas não rodou: {e}") from e
    if r.returncode != 0:
        raise RuntimeError("CLI de tarefas falhou: " + r.stderr.strip()[:300])
    try:
        dados = json.loads(r.stdout)
        lista = dados["tarefas"]
        if not isinstance(lista, list) or not all(isinstance(t.get("id"), int) and isinstance(t.get("status"), str) for t in lista):
            raise ValueError("formato inesperado")
    except Exception as e:
        raise RuntimeError(f"Resposta do CLI de tarefas inválida: {e}") from e
    return {t["id"]: t for t in lista}


def jxa(payload: dict):
    r = subprocess.run(["osascript", "-l", "JavaScript", "-e", JXA, json.dumps(payload)], capture_output=True, text=True, timeout=240)
    if r.returncode != 0:
        raise SystemExit("Calendário falhou: " + r.stderr.strip()[:300])
    return json.loads(r.stdout or "null")


def codigos(texto: str) -> list[int]:
    out: list[int] = []
    for a, b in COD.findall(texto):
        a = int(a)
        out += list(range(a, int(b) + 1)) if b and 0 < int(b) - a < 20 else [a]
    return sorted(set(out))


def resto(texto: str) -> str:
    """O que sobra do bloco tirando os códigos, a pontuação e palavras de ligação: se sobrar texto, o bloco tem outra coisa."""
    t = COD.sub(" ", texto.replace(FEITO, ""))
    t = re.sub(r"[\W_]+", " ", t).lower()
    return " ".join(w for w in t.split() if w not in {"e", "a", "o", "de", "da", "do", "com"})


def hora(s: str) -> dt.datetime:
    return dt.datetime.fromisoformat(s.replace("Z", "+00:00"))


def iso(d: dt.datetime) -> str:
    return d.astimezone(dt.timezone.utc).isoformat().replace("+00:00", "Z")


def dia(d: dt.datetime):
    return d.astimezone(FUSO).date()


def tirar(livres: list, a: dt.datetime, b: dt.datetime) -> list:
    """Remove [a, b) dos intervalos livres."""
    out = []
    for x, y in livres:
        if b <= x or a >= y:
            out.append((x, y))
            continue
        if x < a:
            out.append((x, a))
        if b < y:
            out.append((b, y))
    return [(x, y) for x, y in out if y - x >= MIN_LIVRE]


def juntar(livres: list) -> list:
    out = []
    for x, y in sorted(livres):
        if out and x <= out[-1][1]:
            out[-1] = (out[-1][0], max(out[-1][1], y))
        else:
            out.append((x, y))
    return out


def planejar(eventos: list, tarefas: dict, guardados: list, agora: dt.datetime) -> dict:
    """Decide o que muda na agenda. Função pura: recebe eventos e tarefas, devolve o plano (testável sem o Calendário)."""
    feita = lambda n: n in tarefas and tarefas[n]["status"] == "feito"
    agora = agora.replace(second=0, microsecond=0)
    remover, descrever, ajustar, criar, manter = [], [], [], [], []
    livres: list = []
    fixos: list = []  # eventos que não podem ser cobertos (sem T-n, ou com T-n que ficam onde estão)
    moviveis: list = []

    for g in guardados:
        cods = codigos(g["titulo"] + " " + g["desc"])
        if g.get("tipo") == "encerrado":
            fim_orig = hora(g["fim_original"])
            reaberta = any(not feita(n) for n in cods)
            if reaberta and fim_orig > agora:
                tit = g["titulo"][len(FEITO):] if g["titulo"].startswith(FEITO) else g["titulo"]
                ajustar.append({"cal": g["cal"], "uid": g["uid"], "ini": g["ini"], "fim": g["fim_original"], "titulo": tit, "motivo": "reaberta"})
            elif fim_orig > agora:
                manter.append(g)
            continue
        if hora(g["ini"]) <= agora:
            continue  # horário já passou: não volta, e sai da lista
        if any(not feita(n) for n in cods):
            criar.append({**g, "chave": g["uid"]})
        else:
            manter.append(g)
    reabrir_uids = {a["uid"] for a in ajustar}

    for e in eventos:
        ini, fim = hora(e["ini"]), hora(e["fim"])
        cods = codigos(e["titulo"] + " " + e["desc"])
        if not cods or e["uid"] in reabrir_uids:
            if fim > ini:  # lembrete de duração zero ("Postar 17:00") não ocupa horário
                fixos.append((ini, fim))
            continue
        feitas = [n for n in cods if feita(n)]
        linhas = []
        for ln in e["desc"].split("\n"):
            cs = codigos(ln)
            limpa = ln[len(FEITO):] if ln.startswith(FEITO) else ln
            linhas.append(FEITO + limpa if cs and all(feita(n) for n in cs) else limpa)
        nova = "\n".join(linhas)
        # bloco "só de demandas": cada frase da descrição com texto cita um T-n ("Mandar link (T-47). Responder Bianca." = misto, fica)
        frases = [f for ln in e["desc"].split("\n") for f in re.split(r"(?<=[.!?;])\s+", ln)]
        so_codigos = all(codigos(f) for f in frases if resto(f))
        tudo_feito = len(feitas) == len(cods) and so_codigos
        if tudo_feito and ini >= agora:
            remover.append(e)
            livres.append((ini, fim))
        elif tudo_feito and ini < agora < fim:
            # em andamento: encerra agora; o resto do horário fica livre
            ajustar.append({"cal": e["cal"], "uid": e["uid"], "ini": e["ini"], "fim": iso(max(agora, ini + dt.timedelta(minutes=5))),
                            "titulo": e["titulo"] if e["titulo"].startswith(FEITO) else FEITO + e["titulo"], "motivo": "encerrado"})
            manter.append({**e, "tipo": "encerrado", "fim_original": e["fim"]})
            livres.append((max(agora, ini + dt.timedelta(minutes=5)), fim))
            fixos.append((ini, agora))
        else:
            if nova != e["desc"]:
                descrever.append({**e, "desc": nova})
            if ini >= agora and len(feitas) < len(cods):
                moviveis.append(e)
            else:
                fixos.append((ini, fim))

    # Realocar: blocos abertos do mesmo dia sobem para o horário que ficou livre (nunca por cima de evento fixo).
    livres = juntar(livres)
    for a, b in fixos:
        livres = tirar(livres, a, b)
    movidos = []
    for e in sorted(moviveis, key=lambda x: x["ini"]):
        ini, fim = hora(e["ini"]), hora(e["fim"])
        dur = fim - ini
        alvo = next(((x, y) for x, y in livres if x < ini and dia(x) == dia(ini) and y - x >= dur), None)
        if not alvo:
            livres = tirar(livres, ini, fim)  # ele fica onde está: o horário dele não é livre
            continue
        novo_ini = alvo[0]
        livres = tirar(livres, novo_ini, novo_ini + dur)
        livres = juntar(livres + [(ini, fim)])
        for a, b in fixos:
            livres = tirar(livres, a, b)
        movidos.append({"cal": e["cal"], "uid": e["uid"], "titulo": e["titulo"], "de": e["ini"], "ini": iso(novo_ini), "fim": iso(novo_ini + dur), "motivo": "realocado"})
    ajustar += movidos
    return {"remover": remover, "descrever": descrever, "ajustar": ajustar, "criar": criar, "guardar": manter + remover}


def main(dry: bool, db: str | None = None):
    PASTA.mkdir(parents=True, exist_ok=True)
    with open(TRAVA, "w") as trava:
        fcntl.flock(trava, fcntl.LOCK_EX)
        try:
            tarefas = ler_tarefas(db)
        except RuntimeError as e:  # fonte ilegível: não mexe em nada
            print("Tarefas indisponíveis, nada feito:", e, file=sys.stderr)
            return 1
        agora = dt.datetime.now(dt.timezone.utc)
        janela = {"ini": iso(agora), "fim": iso(agora + dt.timedelta(days=DIAS))}
        eventos = jxa({"ler": True, **janela}) or []
        guardados = json.loads(GUARDADOS.read_text()) if GUARDADOS.exists() else []
        p = planejar(eventos, tarefas, guardados, agora)

        local = lambda s: hora(s).astimezone(FUSO).strftime("%d/%m %H:%M")
        print(f"{sum(1 for e in eventos if codigos(e['titulo'] + ' ' + e['desc']))} blocos com T-n · sai: {len(p['remover'])} · ✓: {len(p['descrever'])} · "
              f"ajusta/realoca: {len(p['ajustar'])} · volta: {len(p['criar'])}")
        for e in p["remover"]:
            print("  sai:", local(e["ini"]), e["titulo"])
        for e in p["ajustar"]:
            print(f"  {e['motivo']}:", e.get("titulo", ""), local(e["ini"]), "→", local(e["fim"]))
        for e in p["descrever"]:
            print("  ✓  :", local(e["ini"]), e["titulo"])
        for e in p["criar"]:
            print("  volta:", local(e["ini"]), e["titulo"])
        if dry:
            return 0
        mexe = p["remover"] or p["descrever"] or p["ajustar"] or p["criar"]
        res = jxa({k: p[k] for k in ("remover", "descrever", "ajustar", "criar")} | janela) if mexe else {"criados": []}
        GUARDADOS.write_text(json.dumps(p["guardar"], ensure_ascii=False, indent=1))
        # confere: o que devia sair saiu, e o que devia mudar de horário mudou
        depois = {e["uid"]: e for e in (jxa({"ler": True, **janela}) or [])}
        erros = [e["titulo"] for e in p["remover"] if e["uid"] in depois]
        erros += [e.get("titulo", e["uid"]) for e in p["ajustar"] if e["uid"] in depois and hora(depois[e["uid"]]["fim"]) != hora(e["fim"])]
        if erros:
            print("ERRO: não aplicou:", erros)
            return 1
        print("ok", len(res.get("criados", [])), "devolvidos")
        return 0


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="Sincroniza blocos da agenda a partir da fonte canônica de tarefas.")
    parser.add_argument("--dry", action="store_true", help="Calcula o plano sem alterar eventos.")
    parser.add_argument("--db", help="Banco já inicializado de fixture (não cria banco).")
    args = parser.parse_args()
    sys.exit(main(args.dry, args.db))
