"""Diferenças Mac/Windows do controlador do Flow (adaptação do OrganicSet para Windows)."""
import os, shutil, subprocess, sys
from pathlib import Path

WINDOWS = sys.platform == "win32"


def _conexao():
    try:
        import json
        cfg = Path(os.environ.get("FLOW_MCP_CONFIG", str(Path.home() / ".config/google-flow-mcp/connection.json")))
        return json.loads(cfg.read_text())
    except Exception:
        return {}


def chrome_exe():
    """Caminho do chrome.exe no Windows (None se não achar).
    `chromeExe` no connection.json (ou FLOW_CHROME_EXE) escolhe outro Chrome."""
    escolhido = os.environ.get("FLOW_CHROME_EXE") or _conexao().get("chromeExe")
    if escolhido and Path(escolhido).exists():
        return escolhido
    for base in (os.environ.get("PROGRAMFILES"), os.environ.get("PROGRAMFILES(X86)"), os.environ.get("LOCALAPPDATA")):
        if base:
            p = Path(base) / "Google/Chrome/Application/chrome.exe"
            if p.exists():
                return str(p)
    return shutil.which("chrome")


def abrir_chrome(profile, url):
    """Abre o Chrome no perfil de geração. Mac: em segundo plano (`open -g`). Windows: chrome.exe no perfil."""
    if WINDOWS:
        exe = chrome_exe()
        if not exe:
            raise RuntimeError("Google Chrome não encontrado no Windows; nada foi enviado.")
        extra = []
        dados = _conexao().get("chromeUserDataDir")
        if dados:
            # Chrome só de geração: pasta de dados própria + porta de depuração (o browser-harness acha na 9222).
            extra = ["--user-data-dir=" + dados, "--remote-debugging-port=" + str(_conexao().get("cdpPort", 9222)),
                     "--no-first-run", "--no-default-browser-check"]
        subprocess.Popen([exe, *extra, "--profile-directory=" + profile, url], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                         creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        return
    subprocess.run(["open", "-g", "-na", "Google Chrome", "--args", "--profile-directory=" + profile, url], check=True)


def aprovar_depuracao(popen=subprocess.Popen):
    """Mac: `browser-harness mac-approve` clica em Permitir sozinho. Windows: o aluno clica em Permitir no Chrome."""
    if WINDOWS:
        return None
    return popen(["browser-harness", "mac-approve"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def comando_flow_control():
    """Como chamar scripts/flow-control: direto no Mac; pelo Python no Windows (sem shebang)."""
    script = str(Path(__file__).with_name("flow-control"))
    return [sys.executable, script] if WINDOWS else [script]
