#!/usr/bin/env python3
"""Troca a voz de clipes já gerados pelo timbre clonado do expert, sem tocar no vídeo.

Problema que isto resolve: o Omni/Veo sorteia o timbre em cada geração — a fala literal
está no prompt, a voz não. O lote de 21/10 (REF-2026-10-0001) saiu com vozes diferentes
entre clipes e uma aguda/afeminada. Como a voz não é controlável por prompt, ela é refeita
em pós no VoiceStudio local (engine voxcpm2): TTS com o texto exato + duração da fala
original, remuxado por cima do vídeo copiado sem reencode.

Dois modos:
  --modo texto (padrão)  usa a fala literal do mapa. Determinístico, sem ASR no meio.
  --modo convert         usa /convert (speech-to-speech) do áudio do próprio clipe, para
                         fala desconhecida. Depende do ASR: pode trocar palavra.

Uso:
  python3 scripts/trocar-voz.py --clips <pasta> --perfil "Bruno Goytacaz" --ref audio.wav \
      --falas falas.json
  python3 scripts/trocar-voz.py --clips <pasta> --perfil "Bruno Goytacaz" --dry-run

--falas: JSON {"SHOT04": "texto literal", ...}. O id do shot é o prefixo do nome do clipe
(SHOT04_REF-...mp4 → SHOT04). Sem --falas, cai para --modo convert.

Requisitos: VoiceStudio.app instalado (backend sobe sozinho na porta 3900), ffmpeg/ffprobe.
Referência de voz: 20-30s de fala contínua SEM música (low/mid < 0,15), mono 24 kHz.
Reel com música: separar antes com o demucs do venv do VoiceStudio:
  VS/.venv/bin/python3 -m demucs --two-stems=vocals -n htdemucs -o stems entrada.wav
"""
import argparse
import json
import mimetypes
import re
import subprocess
import sys
import time
import urllib.request
import uuid
from pathlib import Path

VS_HOME = Path.home() / "Library/Application Support/VoiceStudio"
VS_BACKEND = VS_HOME / "runtime/project/backend/main.py"
VS_PYTHON = VS_HOME / "runtime/project/.venv/bin/python3"
API = "http://127.0.0.1:3900"


def rodar(cmd):
    return subprocess.run(cmd, check=True, capture_output=True, text=True)


def multipart(path, campos, arquivos=None):
    b = uuid.uuid4().hex
    partes = [
        f'--{b}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n'.encode()
        for k, v in campos.items()
    ]
    for nome, caminho in (arquivos or {}).items():
        caminho = Path(caminho)
        tipo = mimetypes.guess_type(caminho.name)[0] or "application/octet-stream"
        partes.append(
            f'--{b}\r\nContent-Disposition: form-data; name="{nome}"; filename="{caminho.name}"\r\n'
            f"Content-Type: {tipo}\r\n\r\n".encode() + caminho.read_bytes() + b"\r\n"
        )
    partes.append(f"--{b}--\r\n".encode())
    corpo = b"".join(partes)
    req = urllib.request.Request(f"{API}{path}", data=corpo,
                                 headers={"Content-Type": f"multipart/form-data; boundary={b}"})
    with urllib.request.urlopen(req, timeout=1800) as r:
        bruto = r.read()
    try:
        return json.loads(bruto)
    except Exception:
        return bruto  # /generate devolve o WAV direto


def backend_no_ar():
    try:
        with urllib.request.urlopen(f"{API}/health", timeout=3) as r:
            return json.loads(r.read()).get("status") == "ok"
    except Exception:
        return False


def subir_backend(timeout_s=180):
    if backend_no_ar():
        return
    if not VS_BACKEND.exists():
        sys.exit(f"VoiceStudio não encontrado em {VS_HOME}. Instale o app.")
    print("subindo backend do VoiceStudio…")
    log = open("/tmp/voicestudio-backend.log", "w")
    subprocess.Popen([str(VS_PYTHON), str(VS_BACKEND)], cwd=VS_BACKEND.parent.parent,
                     stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
    limite = time.time() + timeout_s
    while time.time() < limite:
        if backend_no_ar():
            print("backend ok")
            return
        time.sleep(2)
    sys.exit(f"backend não respondeu em {timeout_s}s — ver /tmp/voicestudio-backend.log")


def duracao(arquivo):
    saida = rodar(["ffprobe", "-v", "error", "-show_entries", "format=duration",
                   "-of", "csv=p=0", str(arquivo)]).stdout
    return float(saida.strip())


def span_fala(wav):
    """(início, fim) da fala no áudio, por detecção de silêncio."""
    p = subprocess.run(["ffmpeg", "-v", "info", "-i", str(wav), "-af",
                        "silencedetect=noise=-32dB:d=0.25", "-f", "null", "-"],
                       capture_output=True, text=True)
    ini = [float(m) for m in re.findall(r"silence_start: ([\d.]+)", p.stderr)]
    fim = [float(m) for m in re.findall(r"silence_end: ([\d.]+)", p.stderr)]
    dur = duracao(wav)
    inicio_fala = fim[0] if ini and ini[0] < 0.05 and fim else 0.0
    fim_fala = ini[-1] if ini and ini[-1] > dur - 0.4 else dur
    return (round(inicio_fala, 3), round(fim_fala, 3)) if fim_fala > inicio_fala else (0.0, dur)


def perfil_por_nome(nome):
    d = multipart
    with urllib.request.urlopen(f"{API}/profiles", timeout=30) as r:
        perfis = json.loads(r.read())
    for p in perfis if isinstance(perfis, list) else perfis.get("profiles", []):
        if p.get("name") == nome:
            return p["id"], None
    return None, perfis


def criar_perfil(nome, ref, idioma="pt", ref_texto=""):
    if not ref_texto:
        d = multipart("/transcribe", {}, {"audio": ref})
        ref_texto = d.get("text", "") if isinstance(d, dict) else ""
    d = multipart("/profiles", {"name": nome, "language": idioma, "kind": "clone", "ref_text": ref_texto},
                  {"ref_audio": ref})
    print(f"perfil criado: {d['id']} ({d['name']})")
    return d["id"]


def trocar_por_texto(clipe, fala, perfil_id, tmp, destino):
    audio = tmp / f"{clipe.stem}.orig.wav"
    rodar(["ffmpeg", "-y", "-v", "error", "-i", str(clipe), "-vn", "-ac", "1", "-ar", "24000", str(audio)])
    ini, fim = span_fala(audio)
    dur_clipe = duracao(clipe)
    voz = tmp / f"{clipe.stem}.voz.wav"
    bruto = multipart("/generate", {"text": fala, "profile_id": perfil_id, "language": "pt",
                                    "duration": f"{fim - ini:.2f}", "engine": "voxcpm2"})
    voz.write_bytes(bruto if isinstance(bruto, bytes) else json.dumps(bruto).encode())
    atraso = int(ini * 1000)
    mix = tmp / f"{clipe.stem}.mix.wav"
    rodar(["ffmpeg", "-y", "-v", "error", "-i", str(voz), "-af",
           f"adelay={atraso}|{atraso},apad=whole_dur={dur_clipe:.3f}", "-t", f"{dur_clipe:.3f}", str(mix)])
    rodar(["ffmpeg", "-y", "-v", "error", "-i", str(clipe), "-i", str(mix), "-map", "0:v", "-map", "1:a",
           "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-shortest", str(destino)])
    return duracao(voz)


def trocar_por_convert(clipe, perfil_id, tmp, destino):
    audio = tmp / f"{clipe.stem}.orig.wav"
    rodar(["ffmpeg", "-y", "-v", "error", "-i", str(clipe), "-vn", "-ac", "1", "-ar", "24000", str(audio)])
    d = multipart("/convert", {"profile_id": perfil_id, "match_duration": "true"}, {"audio": audio})
    voz = tmp / f"{clipe.stem}.voz.wav"
    with urllib.request.urlopen(f"{API}{d['audio_url']}", timeout=120) as r:
        voz.write_bytes(r.read())
    rodar(["ffmpeg", "-y", "-v", "error", "-i", str(clipe), "-i", str(voz), "-map", "0:v", "-map", "1:a",
           "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-af", "apad", "-shortest", str(destino)])
    return duracao(voz)


def main():
    ap = argparse.ArgumentParser(description="troca a voz de clipes pelo timbre clonado (VoiceStudio local)")
    ap.add_argument("--clips", required=True)
    ap.add_argument("--out")
    ap.add_argument("--perfil", required=True)
    ap.add_argument("--ref", help="áudio de referência (necessário se o perfil não existe)")
    ap.add_argument("--ref-texto", default="")
    ap.add_argument("--falas", help="JSON {SHOTnn: fala literal}")
    ap.add_argument("--modo", choices=["texto", "convert"], default="texto")
    ap.add_argument("--glob", default="*.mp4")
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()

    pasta = Path(a.clips).expanduser()
    clipes = sorted(p for p in pasta.glob(a.glob) if not p.stem.startswith("_"))
    if not clipes:
        sys.exit(f"nenhum {a.glob} em {pasta}")
    falas = json.loads(Path(a.falas).expanduser().read_text()) if a.falas else {}
    modo = a.modo if (falas or a.modo == "convert") else "convert"
    saida = Path(a.out).expanduser() if a.out else pasta / "_voz"
    print(f"{len(clipes)} clipe(s) · modo {modo} · → {saida}")
    if a.dry_run:
        for c in clipes:
            sid = c.stem.split("_")[0]
            print(f"  {c.name}  {duracao(c):.2f}s  fala={'sim' if falas.get(sid) else 'não'}")
        return

    subir_backend()
    perfil_id, _ = perfil_por_nome(a.perfil)
    if not perfil_id:
        if not a.ref:
            sys.exit(f"perfil '{a.perfil}' não existe — passe --ref com o áudio de referência")
        perfil_id = criar_perfil(a.perfil, Path(a.ref).expanduser(), ref_texto=a.ref_texto)

    saida.mkdir(parents=True, exist_ok=True)
    tmp = saida / "_tmp"
    tmp.mkdir(exist_ok=True)
    t0 = time.time()
    for i, clipe in enumerate(clipes, 1):
        destino = saida / clipe.name
        if destino.exists() and destino.stat().st_mtime >= clipe.stat().st_mtime:
            print(f"[{i}/{len(clipes)}] {clipe.name} já feito")
            continue
        fala = falas.get(clipe.stem.split("_")[0])
        if modo == "texto" and not fala:
            print(f"[{i}/{len(clipes)}] {clipe.name} sem fala no --falas — pulando")
            continue
        antes = duracao(clipe)
        voz = (trocar_por_texto(clipe, fala, perfil_id, tmp, destino) if modo == "texto"
               else trocar_por_convert(clipe, perfil_id, tmp, destino))
        print(f"[{i}/{len(clipes)}] {clipe.name}  {antes:.2f}s → voz {voz:.2f}s")
    print(f"pronto em {(time.time()-t0)/60:.1f} min · {saida}")


if __name__ == "__main__":
    main()
