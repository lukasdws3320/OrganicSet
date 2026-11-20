// Abre um arquivo/pasta no Finder (Mac) ou no Explorador (Windows). Adaptação do OrganicSet para Windows.
// revelar=true mostra o arquivo selecionado na pasta. Retorna o código de saída (Windows: sempre 0, o explorer.exe não informa sucesso).
export function abrirNoSistema(path: string, revelar = false): Promise<number> {
  if (process.platform === "darwin") return Bun.spawn(revelar ? ["open", "-R", path] : ["open", path]).exited;
  if (process.platform === "win32") {
    const p = path.replace(/\//g, "\\");
    Bun.spawn(revelar ? ["explorer.exe", "/select," + p] : ["explorer.exe", p]);
    return Promise.resolve(0);
  }
  return Promise.resolve(0);
}
