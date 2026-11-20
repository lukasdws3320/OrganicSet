"""Corta o áudio inteiro do MiniMax (a copy toda, com "Filha:"/"Mãe:") em um arquivo por fala e monta os cortes de até 8 s.

  py scripts\\audio.py --falas falas.json --audio "C:\\...\\minimax.mp3" --saida "C:\\...\\audios"

falas.json: [{"id": "F01", "corte": "SHOT01", "quem": "filha", "texto": "Mom, chocolate at ten at night?"}, ...]
Saída: <saida>\\F01.wav, F02.wav ... (só a fala, sem o rótulo falado), cortes.json e um resumo na tela.
Como funciona: transcreve o áudio com o tempo de cada palavra e alinha com o texto das falas, na ordem.
Rótulo falado ("Filha", "Mãe", "Daughter", "Mom:") fica de fora porque não faz parte do texto da fala.
"""
import argparse, difflib, json, os, re, subprocess, sys, unicodedata

TETO = 8.0


def sair(msg):
    print(json.dumps({"erro": msg}, ensure_ascii=False)); sys.exit(1)


def norm(w):
    w = unicodedata.normalize("NFD", w.lower())
    return re.sub(r"[^a-z0-9']", "", "".join(c for c in w if unicodedata.category(c) != "Mn"))


def transcrever(caminho):
    try:
        import numpy as np
        from faster_whisper import WhisperModel
    except ImportError:
        sair("Falta o faster-whisper. Rode de novo o Instalar.bat.")
    bruto = subprocess.run(["ffmpeg", "-v", "error", "-i", caminho, "-f", "f32le", "-ac", "1", "-ar", "16000", "pipe:1"], capture_output=True).stdout
    if not bruto: sair("Não consegui ler o áudio.")
    segs, info = WhisperModel("small", device="cpu", compute_type="int8").transcribe(np.frombuffer(bruto, dtype=np.float32), word_timestamps=True)
    return [{"w": w.word.strip(), "ini": w.start, "fim": w.end} for s in segs for w in (s.words or [])], len(bruto) / 4 / 16000


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--falas", required=True); ap.add_argument("--audio", required=True); ap.add_argument("--saida", required=True)
    a = ap.parse_args()
    falas = json.load(open(a.falas, encoding="utf8"))
    if not os.path.exists(a.audio): sair("Áudio não encontrado: " + a.audio)
    os.makedirs(a.saida, exist_ok=True)
    ouvidas, total = transcrever(a.audio)
    h = [norm(x["w"]) for x in ouvidas]
    roteiro, dono = [], []
    for i, f in enumerate(falas):
        for w in f["texto"].split():
            if norm(w): roteiro.append(norm(w)); dono.append(i)
    casa = {}
    for b in difflib.SequenceMatcher(None, roteiro, h, autojunk=False).get_matching_blocks():
        for k in range(b.size): casa[b.a + k] = b.b + k
    resultado, problemas = [], []
    for i, f in enumerate(falas):
        idx = [casa[j] for j, d in enumerate(dono) if d == i and j in casa]
        n_pal = sum(1 for d in dono if d == i)
        if not idx or len(idx) < max(1, n_pal // 2):
            problemas.append(f"{f['id']}: não encontrei esta fala no áudio ({len(idx)}/{n_pal} palavras)"); continue
        ini, fim = max(0.0, ouvidas[min(idx)]["ini"] - 0.08), min(total, ouvidas[max(idx)]["fim"] + 0.2)
        arq = os.path.join(a.saida, f["id"] + ".wav")
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", f"{ini:.3f}", "-to", f"{fim:.3f}", "-i", a.audio, "-ac", "1", "-ar", "44100", arq], check=True)
        resultado.append({**f, "ini": round(ini, 2), "fim": round(fim, 2), "duracao": round(fim - ini, 2), "arquivo": arq,
                          "palavras_achadas": f"{len(idx)}/{n_pal}"})
    # cortes: falas do mesmo corte original juntas enquanto couberem em 8 s; fala sozinha acima de 8 s vira corte próprio com aviso
    cortes, atual = [], None
    for r in resultado:
        if atual and atual["origem"] == r["corte"] and (r["fim"] - atual["ini"]) <= TETO:
            atual["falas"].append(r["id"]); atual["fim"] = r["fim"]; atual["quem"].append(r["quem"]); continue
        atual = {"origem": r["corte"], "ini": r["ini"], "fim": r["fim"], "falas": [r["id"]], "quem": [r["quem"]]}
        cortes.append(atual)
    for n, c in enumerate(cortes, 1):
        c["id"] = f"C{n:02d}"; c["duracao"] = round(c["fim"] - c["ini"], 2)
        if c["duracao"] > TETO: c["aviso"] = "fala com mais de 8 s: gere dois clipes ou encurte a fala"
    json.dump({"falas": resultado, "cortes": cortes, "problemas": problemas}, open(os.path.join(a.saida, "cortes.json"), "w", encoding="utf8"), ensure_ascii=False, indent=1)
    for r in resultado: print(f"{r['id']} {r['corte']} {r['quem']:<6} {r['ini']:7.2f}-{r['fim']:7.2f}  {r['duracao']:5.2f}s  ({r['palavras_achadas']})")
    print(f"{len(resultado)} falas cortadas, {len(cortes)} cortes de vídeo, {len(problemas)} problemas")
    for p in problemas: print("  ! " + p)


if __name__ == "__main__":
    main()
