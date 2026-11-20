#!/usr/bin/env python3
"""Transcreve áudio/vídeo com a API do AssemblyAI (só stdlib).

Uso:
  transcrever.py ARQUIVO_OU_URL [...] [--out DIR] [--lang pt|en|auto] [--speakers]
  transcrever.py --check            # só confere se a chave funciona (não gasta crédito)

Chave: variável de ambiente ASSEMBLYAI_API_KEY ou o .env da skill (chmod 600,
gitignored). Nunca passe a chave por argumento nem grave em nota.
Saída por arquivo: <nome>.txt, <nome>.json, <nome>.srt (+ jobs.json pra retomar).
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

BASE = "https://api.assemblyai.com"
SKILL_DIR = Path(__file__).resolve().parent.parent


def load_key() -> str:
    key = os.environ.get("ASSEMBLYAI_API_KEY", "").strip()
    env = SKILL_DIR / ".env"
    if not key and env.exists():
        for line in env.read_text(encoding="utf-8").splitlines():
            if line.startswith("ASSEMBLYAI_API_KEY="):
                key = line.split("=", 1)[1].strip().strip('"').strip("'")
    if not key or key == "cole_sua_chave_aqui":
        sys.exit("Sem chave: exporte ASSEMBLYAI_API_KEY ou preencha o .env da skill (chmod 600).")
    return key


def call(url: str, key: str, *, method="GET", body: bytes | None = None,
         ctype="application/json", raw=False, timeout=900):
    req = urllib.request.Request(url, data=body, method=method)
    req.add_header("Authorization", key)
    if body is not None:
        req.add_header("Content-Type", ctype)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            data = r.read().decode("utf-8")
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"HTTP {e.code} em {url.split('?')[0]}: {e.read().decode('utf-8', 'replace')[:300]}")
    return data if raw else json.loads(data)


def main() -> None:
    ap = argparse.ArgumentParser(description="Transcrição via AssemblyAI")
    ap.add_argument("entradas", nargs="*", help="arquivos locais (mp3/m4a/wav/mp4...) ou URLs públicas")
    ap.add_argument("--out", default="transcricoes", help="pasta de saída (padrão: ./transcricoes)")
    ap.add_argument("--lang", default="pt", help="pt | en | auto (detecção automática)")
    ap.add_argument("--speakers", action="store_true", help="separar falantes (speaker labels)")
    ap.add_argument("--check", action="store_true", help="só valida a chave")
    a = ap.parse_args()
    key = load_key()

    if a.check:
        call(f"{BASE}/v2/transcript?limit=1", key)
        print("OK — chave AssemblyAI válida.")
        return
    if not a.entradas:
        ap.error("informe ao menos um arquivo ou URL")

    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    jobs_path = out / "jobs.json"
    jobs = json.loads(jobs_path.read_text(encoding="utf-8")) if jobs_path.exists() else {}

    for ent in a.entradas:
        nome = Path(ent.split("?")[0]).stem or "audio"
        if jobs.get(nome, {}).get("id"):
            print(f"RETOMANDO {nome}")
            continue
        if ent.startswith(("http://", "https://")):
            audio_url = ent
        else:
            p = Path(ent)
            if not p.is_file():
                sys.exit(f"Arquivo não encontrado: {ent}")
            print(f"UPLOAD {p.name}", flush=True)
            audio_url = call(f"{BASE}/v2/upload", key, method="POST", body=p.read_bytes(),
                             ctype="application/octet-stream", timeout=1800)["upload_url"]
        payload = {"audio_url": audio_url, "punctuate": True, "format_text": True,
                   "speaker_labels": a.speakers}
        if a.lang == "auto":
            payload["language_detection"] = True
        else:
            payload["language_code"] = a.lang
        r = call(f"{BASE}/v2/transcript", key, method="POST", body=json.dumps(payload).encode())
        jobs[nome] = {"id": r["id"], "fonte": ent, "status": r.get("status")}
        jobs_path.write_text(json.dumps(jobs, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"ENVIADO {nome}", flush=True)

    pend = {n for n, j in jobs.items() if j.get("status") != "salvo"}
    while pend:
        for nome in sorted(pend):
            j = jobs[nome]
            t = call(f"{BASE}/v2/transcript/{j['id']}", key)
            st = t.get("status")
            if st == "error":
                raise RuntimeError(f"AssemblyAI falhou em {nome}: {t.get('error')}")
            if st != "completed":
                continue
            (out / f"{nome}.json").write_text(json.dumps(t, ensure_ascii=False, indent=2), encoding="utf-8")
            if a.speakers and t.get("utterances"):
                txt = "\n\n".join(f"Falante {u['speaker']}: {u['text']}" for u in t["utterances"])
            else:
                txt = (t.get("text") or "").strip()
            (out / f"{nome}.txt").write_text(txt + "\n", encoding="utf-8")
            srt = call(f"{BASE}/v2/transcript/{j['id']}/srt?chars_per_caption=42", key, raw=True)
            (out / f"{nome}.srt").write_text(srt, encoding="utf-8")
            j["status"] = "salvo"
            jobs_path.write_text(json.dumps(jobs, ensure_ascii=False, indent=2), encoding="utf-8")
            pend.discard(nome)
            print(f"SALVO {nome}: TXT, JSON, SRT", flush=True)
        if pend:
            print(f"aguardando {len(pend)}...", flush=True)
            time.sleep(10)
    print(f"PRONTO — saída em {out.resolve()}")


if __name__ == "__main__":
    main()
