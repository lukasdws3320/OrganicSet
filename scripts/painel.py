#!/usr/bin/env python3
"""Atualiza hub/dados.js, que o `Reference Hub.html` lê (abas Experts e Prompts).
Lê as mesmas fontes do Reference Hub: experts/perfis.json, a pasta de cada expert
(Contact Sheet/, Fotos/, 06_roadmap/Postagens.md, 07_entregas/) e app/InstagramReferenceHub/library/replicacoes/.
Uso: python3 scripts/painel.py"""
import datetime as dt, json, re
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
LIB = RAIZ / "app/InstagramReferenceHub/library"
IMAGEM = {".png", ".jpg", ".jpeg", ".webp"}


def ler(p, padrao=None):
    try:
        return json.loads(Path(p).read_text(encoding="utf-8"))
    except Exception:
        return padrao


def rel(p):
    return Path(p).relative_to(RAIZ).as_posix()


def imagens(d):
    return [rel(x) for x in sorted(d.glob("*")) if x.is_file() and x.suffix.lower() in IMAGEM] if d.exists() else []


def postagens(pasta):
    f = pasta / "06_roadmap/Postagens.md"
    if not f.exists():
        return []
    posts = []
    for sec in re.split(r"^## ", f.read_text(encoding="utf-8"), flags=re.M)[1:]:
        campos = dict(re.findall(r"^([a-z_]+):[ \t]*(.*)$", sec, flags=re.M))
        leg = re.search(r"```legenda\n(.*?)```", sec, re.S)
        if campos.get("tipo", "video") != "video" and "ref" not in campos:
            continue
        status = campos.get("publicacao") or campos.get("status") or "planejado"
        if status == "arquivado":
            continue
        posts.append({"data": campos.get("data", ""), "hora": campos.get("hora", ""), "ref": campos.get("ref", ""),
                      "versao": campos.get("versao", ""), "status": status, "legenda": leg.group(1).strip() if leg else ""})
    posts = [p for p in posts if p["data"]]
    posts.sort(key=lambda p: (p["data"], p["hora"]))
    for i, p in enumerate(posts, 1):
        p["n"] = i
    return posts


def main():
    experts = []
    for perfil in ler(RAIZ / "experts/perfis.json", []) or []:
        pasta = RAIZ / perfil.get("vault_path", "")
        clientes = perfil.get("clients") or [perfil.get("slug")]
        contact, fotos = imagens(pasta / "Contact Sheet"), imagens(pasta / "Fotos")
        finais = [x for x in (pasta / "07_entregas").rglob("*.mp4")] if (pasta / "07_entregas").exists() else []
        refs = []
        for rep in sorted(LIB.glob("replicacoes/REF-*/*/replicacao.json")):
            if rep.parent.name not in clientes:
                continue
            r = ler(rep, {}) or {}
            ref = r.get("ref") or rep.parent.parent.name
            refs.append({"id": ref, "formato": r.get("formato", ""), "status": r.get("status") or ("prompts-prontos" if r.get("shots") else "importada"),
                         "personagem": rep.parent.name, "final": [rel(x) for x in finais if ref in x.name]})
        ficha = ler(RAIZ / "experts" / (perfil.get("vault_path", "").split("/")[-1]) / "ficha.json", {}) or {}
        experts.append({"nome": perfil.get("name"), "slug": perfil.get("slug"), "pasta": perfil.get("vault_path"),
                        "instagram": ficha.get("instagram", ""), "mercado": ficha.get("mercado", ""), "idioma": ficha.get("idioma", ""),
                        "nicho": ficha.get("nicho", ""), "cta_tema": ficha.get("cta_tema", ""), "estilo": ficha.get("estilo", ""),
                        "horarios": ficha.get("horarios", []),
                        "capa": next((c for c in contact if "contactsheet" in c.lower()), (contact or fotos or [None])[0]),
                        "contact": contact, "fotos": fotos, "refs": refs, "calendario": postagens(pasta)})
    cat = ler(RAIZ / "prompts/catalogo.json", {}) or {}
    ex = ler(RAIZ / "prompts/exemplos.json", {}) or {}
    dados = {"gerado_em": dt.datetime.now().isoformat(timespec="minutes"), "experts": experts,
             "prompts": cat.get("prompts", []), "prompts_aviso": cat.get("aviso", ""),
             "objetivos": ex.get("objetivos", []), "atribuicao": ex.get("atribuicao", {}), "exemplos": ex.get("exemplos", {})}
    (RAIZ / "hub").mkdir(exist_ok=True)
    (RAIZ / "hub/dados.js").write_text("// Gerado por scripts/painel.py. Não editar à mão.\nwindow.HUB_DADOS = "
                                       + json.dumps(dados, ensure_ascii=False) + ";\n", encoding="utf-8")
    print(f"Painel atualizado: {len(experts)} expert(s), {len(dados['prompts'])} prompts.")


if __name__ == "__main__":
    main()
