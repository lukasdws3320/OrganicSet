# InstagramReferenceHub — operação local

> Revisado em 2026-10-16. Documento não é status: cadastro não prova processo ou produção no ar.

Biblioteca local-first de referências de Reels. Bun + SQLite e front React/Vite. Vídeos e banco em `library/` dentro deste projeto. Incerteza: baixa.

## Fonte de verdade

Execução de produção (29/10): `server/production-service.ts` é a entrada comum UI/CLI; `production-workflow.ts` persiste decisões/posse dos jobs; `production-runner.ts` despacha e coleta pelo controlador existente; `scripts/chatgpt-image.ts` chama o motor nativo pelo Codex CLI autenticado, com cópia dos anexos e validação de hash. Não usa API faturada à parte nem opera o site ChatGPT. Na UI: Produção → referência → Shots → Execução compartilhada. Prompt manual inclui pacote completo de vídeo/legenda/anexos/prompts, além da entrega integral no chat. A fila não comprova edição concluída. Testes: `tests/production-{workflow,dispatch,api,padronizacao}.test.ts`.

Entrada compartilhada UI/chat: `.claude/skills/reference-hub/SKILL.md` → [contrato e comandos](docs/execucao-por-chat.md). A CLI `scripts/hub.ts` usa esta API; não inicia outro servidor nem banco. [Guia de uso em outro chat](docs/passo-a-passo-chat.html). Descoberta: `bun scripts/auditar-entrada.ts`. Pacotes exportados aparecem na ficha da referência; preparado é diferente de gerado/aprovado.

- Regras: `AGENTS.md` desta pasta ou do ancestral mais próximo; `CLAUDE.md` importa a mesma fonte.
- Execução: cadastro privado `~/.config/agentos/projetos.json`. O painel não executa Markdown.
- Runtime/saúde: [MarcolinoOS / Projetos](http://127.0.0.1:8777/#/projetos). Processo, porta e HTTP são evidências diferentes.
- Memória curada descreve contexto, nunca uptime. Decisão durável só por `brain save` quando solicitada; não criar arquivo manual em `_memoria/`.

## Como rodar / parar

Use [MarcolinoOS / Projetos](http://127.0.0.1:8777/#/projetos): **Iniciar → Abrir em nova guia → Parar**. O catálogo privado `~/.config/agentos/projetos.json` é a especificação; a URL efetiva vem do runtime.

Os comandos abaixo são **modelos do cadastro**, não instruções para executar `{porta}` literalmente. Serviços portáveis recebem a porta reservada pelo controlador. A URL preferencial não prova disponibilidade; se houver remapeamento, use o botão Abrir do painel. Reservas em `~/.config/agentos/projetos.portas.json`.

### Aplicação (`local-1`) — serviço único

- Porta fixa: `4317`. Um processo só serve a interface **e** a API.
- URL: http://127.0.0.1:4317/
- Comando (`package.json` → `app`): compila a interface (`web/dist`, <1 s) e sobe o servidor, então a tela aberta é sempre a do código atual.

```sh
bun run app
```

Desenvolvimento da tela com recarga ao vivo (opcional, só para quem programa): `bun run dev` (Vite na 5191 com proxy para a 4317). Não é necessário para usar o app.

## Links e HTML

- [Aplicação](http://127.0.0.1:4317) — endereço cadastrado, não prova de disponibilidade.

## Limites / pré-requisitos

### Transcrição

**Motor primário: AssemblyAI (desde 26/10/2026, pedido do Matheus).** `server/assemblyai.ts` envia o áudio 16 kHz e grava os timestamps por palavra em `transcricao.json` com `fonte: "assemblyai"`. Chave só em `ASSEMBLYAI_API_KEY` ou em `~/.config/instagram-reference-hub/assemblyai.env` (600, fora do repositório); nunca em nota, argumento ou commit. Motivo: o Whisper small errou fala real (REF-0187 SHOT06 "entre ângulos" → "em triângulos", conferido no AssemblyAI). Sem chave, o Hub usa o Whisper local; se a API falhar, cai no Whisper e registra `fallback_de`/`motivo` no próprio `transcricao.json`. `IRH_TRANSCRIBER=assemblyai|whisper` força um motor (forçado não tem fallback). Testes: `bun test tests/assemblyai.test.ts`. Vale para transcrições novas; as existentes continuam reaproveitadas até serem refeitas.

**Fallback local (Whisper).** `whisper-cli` precisa estar no PATH. O modelo padrão do Hub é `~/.local/share/instagram-reference-hub/models/ggml-small.bin`. `IRH_WHISPER_MODEL` permite indicar outro arquivo absoluto; configuração explícita inválida gera erro, sem troca silenciosa de modelo. Sem configuração explícita, `server/whisper.ts` também reconhece o small já instalado no cache do Hyperframes e o caminho legado do Concat. A instalação local de 25/10/2026 usa uma cópia própria do small, sem depender do diretório desses aplicativos.

Transcrições existentes são reaproveitadas. Falha de configuração/transcrição preserva frames anteriores; a substituição dos frames só começa depois das verificações da transcrição. Testes da descoberta: `bun test tests/whisper-model.test.ts`. Evidência de transcrição/segmentação real: `docs/evidencias/whisper-2026-10-25/smoke.json`.

- O painel não instala pacotes, configura segredos, cria banco, aplica migrações ou faz deploy.
- HTTP 2xx não atesta login, pagamento, banco, tracking ou integridade dos dados.
- Porta ocupada por outro app é conflito: nunca liberar matando o ocupante automaticamente.
- Produção é somente observação e continua sob as regras da operação dona e da infra.

- Uso normal = 1 serviço (`bun run app`). `scripts.dev` (2 processos) é só para desenvolver a interface. Não há README na raiz. Outros docs citados no AGENTS: docs/BRIEF.md, docs/DELEGACAO-CLAUDE.md.
- Sem URL pública no AGENTS.
- HTML no disco: app/InstagramReferenceHub/web/index.html

## Evidências

- `AGENTS.md`
- `package.json`
- `server/index.ts`
- `web/vite.config.ts`

[Hub do painel](http://127.0.0.1:8777/#/projetos) · [Guia no vault](obsidian://open?vault=Claude&file=08_Sistema%2FDocumentacao%2FAgentOS%2FProjetos%20%E2%80%94%20opera%C3%A7%C3%A3o%20e%20governan%C3%A7a)

## Criação de replicações em segundo plano (26/10/2026)

`POST /api/replicacoes` registra o pedido e responde **202** com `id` e `preparacao`, ou `existente: true` para um trabalho já criado. Expert, avatar, formato, engine e arquivo da referência são validados antes da aceitação. A resposta não espera transcrição, extração de frames ou a leitura visual. O formulário fecha após salvar; em Referências, conserva a URL e a rolagem.

`server/replication-preparation.ts` processa uma fila serial persistida em `library/replicacoes/<REF>/<slug>/preparacao.json` (sem expert, na raiz da REF). Estados: `fila`, `preparando`, `aguardando_conferencia`, `pronto`, `erro`. O board e o detalhe exibem o estado e consultam o andamento enquanto houver trabalho pendente. Pedidos repetidos do mesmo par REF + expert reutilizam o registro. Reiniciar o serviço retoma pedidos em fila/interrompidos; falhas registradas não são repetidas automaticamente.

A preparação completa executa, em sequência: transcrição AssemblyAI (fallback registrado) e frames preliminares → coleta Watch + Opus/Sonnet 5.5 low (reaproveitando evidências existentes) → conferência automática do mapa → validação de hashes, janelas e fala literal → takes por estado visual → prompts do expert. `server/automatic-analysis.ts` chama `scripts/conferir-mapa.py`, que concilia duas leituras visuais independentes dos frames Watch e registra a origem e o tipo automático da conferência em `analise.json`. A coleta sozinha não conclui a preparação e não deve deixar um pedido normal parado em `aguardando_conferencia`.

O estado temporário é Análise enquanto a preparação trabalha; **Prompts prontos exige trechos, frames, mapa validado e prompts sem erro de lint**. Nenhum card é movido apenas para aparentar conclusão. Um mapa inválido tem uma tentativa de reparo, com o erro real enviado como feedback, antes de registrar a falha. Falha mantém o pedido e as evidências; não libera prompts incompletos. A importação manual de mapa continua disponível para revisões específicas, sem ser uma etapa obrigatória da criação normal. Pedidos legados em `aguardando_conferencia` são retomados pela preparação completa ao iniciar o serviço.

A criação pela interface prepara o trabalho local; ela não envia shots pagos ao Flow. Testes: `tests/replication-preparation.test.ts` cobre aceitação com análise bloqueada, pedidos consecutivos, duplicatas, persistência, falha isolada e retomada. `tests/api.test.ts` confere a criação real após importar evidências e mantém os bloqueios de exportação quando elas são alteradas.

## Direção de produção e cadência — 26/10/2026

Execução eficiente (27/10): ler `GoogleFlowMCP/docs/execucao-eficiente.md`. CLI/MCP oferecem progresso compacto, fila por abas isoladas, coleta em rodízio com prazo por shot e auditoria de revisão por hash. O Hub separa `reviewStatus` de arquivo baixado; a interface mostra revisão pendente quando não há recibo da versão final. O contrato não modifica manifestos antigos nem atribui revisão por uma frase em prosa. Ativação em [passo a passo](docs/passo-a-passo-execucao-eficiente.html).

A skill `replicar-referencia` resolve a personagem e carrega contexto, formato, cadência e revisão antes do envio. Prompts exibidos no Hub não comprovam que a direção vocal ou o vídeo tenham sido revisados. `copy.versoes[].direcao_voz` pertence à personagem/versão e permanece independente de voz cadastrada no Flow; timbre livre não significa locutora adulta genérica.

`bun run scripts/revisar-cadencia.ts --replication /pasta/replicacao.json` lê os timestamps locais, propõe grupos e resegmentação e não modifica a biblioteca. Uma proposta bloqueada sai com código 2. O exportador de novos planos exige contexto vocal para fala gerada e usa medições por palavra; uma fala longa não é comprimida em 8s. POV/inserto com locução na edição continua separado do áudio gerado.

As alterações de código não reescrevem planos nem estados existentes. Sessões abertas precisam reler a skill/módulos antes de um novo lote; o processo do servidor precisa recarregar o código para a interface servir os novos prompts. A atualização de runtime deve ocorrer em uma pausa da produção, pelo controlador do MarcolinoOS.

Destino comum confirmado pelo Matheus: imagens no Nano Banana/ChatGPT conforme o trabalho → Flow, principalmente Veo 3; Frames é a preferência habitual, Elements/Ingredients depende da composição. Voz cadastrada é opcional por padrão, com exigências específicas no perfil como a do Bruno. Podcast e demais formatos ainda não registrados exigem análise/mapeamento próprios; não são convertidos silenciosamente em apresentador frontal. [Retomada da sessão e recarga segura](docs/passo-a-passo-atualizar-skill-replicacao.html) · [Revisão e evidências](docs/revisoes/2026-10-26-contexto-cadencia/relatorio.md).

## Fila de postagem (02/11/2026)

`/postar` reúne posts por dia → horário → perfil. `GET /api/postagem/fila?dia=AAAA-MM-DD&profile=slug` projeta `listarPosts`/`Postagens.md` sem persistência paralela. A interface abre mídia no Finder com `POST /api/posts/:id/revelar`, copia legenda e confirma pelo PATCH existente de posts, com avanço dentro do horário e desfazer. Arquivos ausentes ficam bloqueados; abrir/copiar nunca publica. Envio ao celular e publicação são manuais. A fila relê ao focar e a cada 30 s. [Guia de uso](docs/passo-a-passo-postagem.html). Testes isolados: `bun test tests/posting-queue.test.ts` e `bun test tests/posting-api.test.ts`.

O cadastro do serviço usa o caminho absoluto do Bun instalado (`~/.bun/bin/bun`); o script `app` inclui esse diretório no PATH dos filhos. O ambiente não interativo do controlador não herda o PATH do terminal. Assim build, servidor e fila iniciam pelo mesmo cadastro sem exigir uma sessão de shell pessoal.

## Autenticação do leitor visual em serviço (05/11/2026)

O Claude Code é chamado localmente por `scripts/visual_analysis.py`, tanto nas duas leituras quanto na síntese. Serviço não interativo pode herdar `HOME` e omitir `USER`/`LOGNAME`; no macOS isso faz o CLI deixar de localizar a sessão válida no Keychain. `claude_environment()` completa somente essas variáveis ausentes com a conta real do processo (`pwd.getpwuid(os.getuid())`), preservando as demais opções e sem copiar credenciais. Vale para chamadas feitas pela UI, CLI ou diretamente pelo coletor. Não criar token em arquivo ou exigir novo login como primeira correção. Teste: `python3 -m unittest discover -s tests -p visual_runner_test.py`. A validação real deve conferir uma chamada de leitura, porque autenticação no terminal não prova autenticação no serviço.
