# Arquitetura — Instagram Reference Hub

App local-first: um processo Bun serve a API e a interface em `http://127.0.0.1:4317`. Tudo (banco, vídeos, capas) fica na biblioteca em disco; a internet só é usada para importar e atualizar métricas.

## Módulos

```
                 navegador (React + Vite build em web/dist)
                         │  fetch /api/*  ·  SSE /api/import/events  ·  GET /media/* (Range 206)
┌────────────────────────▼─────────────────────────────────────────────────┐
│ server/index.ts     Bun.serve: tabela de rotas, guarda de Host/Origin,     │
│                     mídia com Range, estáticos da interface                │
│ server/db.ts        abre SQLite (WAL, FKs), migrações versionadas, FTS5   │
│ server/refs.ts      referências: consulta com filtros, CRUD, relações     │
│ server/catalog.ts   clientes, projetos, categorias, tags, coleções        │
│ server/importer.ts  fila serial, downloader (yt-dlp), ffprobe, cortes,    │
│                     CTA, nomes de arquivo, upload manual                  │
│ server/fake-downloader.ts  downloader falso (IRH_DOWNLOADER=fake) p/ testes│
│ server/archive.ts   export CSV/XLSX, zip de coleção, backup e restauração │
│ server/library.ts   caminhos da biblioteca, slug, IDs REF-, shortcode     │
└────────────────────────┬─────────────────────────────────────────────────┘
                         │
  library/   (dentro do projeto; IRH_LIBRARY sobrescreve só em teste)
    database/irh.sqlite · videos/AAAA/MM/*.mp4 · thumbnails/*.jpg · exports/ · backups/
```

Ferramentas externas (todas locais): `yt-dlp`, `ffmpeg`, `ffprobe`, `zip`/`unzip` (nativos do macOS), `open -R` (Finder).

## Modelo de dados (SQLite)

| Tabela | Campos principais | Observação |
|---|---|---|
| `refs` | `id` TEXT PK (`REF-AAAA-MM-NNNN`), `seq_month`, `seq`, `shortcode` UNIQUE, `url`, `kind` (`video`/`imagem`/`carrossel`), `source` (`instagram`/`manual`), `username`, `display_name`, `caption`, `hashtags`, `cta_keyword`, `published_at`, `imported_at`, `duration`, `width`, `height`, `video_path`, `thumb_path`, `filmstrip_path`, `file_hash`, `file_size`, `cuts`, `avg_shot`, `status` (`disponivel`/`producao`/`usada`), `favorite`, `notes`, `hook`, `script_structure`, `editing_technique`, `save_reason`, `adaptation`, `derived_ideas`, `updated_at` | Um arquivo físico por referência. Caminhos relativos à biblioteca. |
| `metric_snapshots` | `ref_id` FK, `views`, `likes`, `comments`, `collected_at`, `source` (`yt-dlp`/`manual`) | Cada leitura é uma linha. `NULL` = não disponível. A UI usa a mais recente e sempre mostra a data. |
| `clients` | `name` UNIQUE, `segment`, `color`, `notes` | "Identidade visual" = cor + observação. |
| `projects` | `client_id` FK, `name`, `status` (`ativo`/`pausado`/`concluido`), `notes` | |
| `categories` | `name` UNIQUE, `slug`, `position` | 15 iniciais do brief semeadas na migração 1. |
| `tags` | `name` UNIQUE | Criadas sob demanda. |
| `ref_clients`, `ref_projects`, `ref_categories`, `ref_tags` | PK composta | Junções N:N. Categoria primária = primeira inserida (menor `rowid`). |
| `client_categories` | `client_id`, `category_id` | Categorias de conteúdo da cliente. |
| `collections` | `name`, `description`, `kind` (`manual`/`smart`), `filters` (JSON) | Inteligente = filtro salvo, avaliado na hora. |
| `collection_refs` | `collection_id`, `ref_id`, `position` | Só coleções manuais. |
| `markers` | `ref_id`, `t` (s), `label` | Marcadores de momento do visualizador. |
| `import_jobs` / `import_items` | lote → itens com `url`, `status` (`pendente`/`baixando`/`ok`/`duplicado`/`erro`), `error`, `ref_id` | Histórico de importação. |
| `settings` | `key`, `value` | Cookies do navegador (off), intervalo entre downloads. |
| `refs_fts` | FTS5 `unicode61 remove_diacritics 2` sobre legenda, hashtags, @usuário, nome, notas e análise | Mantida por triggers em `refs`. |
| `schema_migrations` | `version` | Migrações aplicadas em transação. |

Todas as FKs com `ON DELETE CASCADE`. `PRAGMA foreign_keys=ON`, `journal_mode=WAL`.

## Fluxo de importação

1. Entrada: um link, texto com dezenas de links (extração por regex), CSV (qualquer coluna com URL) ou upload manual de arquivo.
2. Cada URL vira `import_item`. Shortcode canônico (`/p/`, `/reel/`, `/reels/`, `/tv/`, com/sem `@perfil/`, query, barra final). Link inválido → `erro` na hora; shortcode já existente → `duplicado` (aponta para a referência existente). Repetido dentro do mesmo lote → `duplicado`.
3. Fila **serial** em memória (retomada no boot: itens `pendente`/`baixando` voltam para a fila). Intervalo configurável entre downloads (padrão 4 s); erro de limite de taxa → espera 60 s e tenta mais uma vez.
4. Downloader `yt-dlp --write-info-json --write-thumbnail` para pasta temporária, `--merge-output-format mp4`. Cookies do navegador só com a opção ligada.
5. Pós-processamento: `ffprobe` (duração/dimensão), SHA-256, detecção de cenas `select='gt(scene,0.3)'` (nº de cortes e duração média do plano), tira de quadros, capa (thumbnail do post ou quadro de 1 s), CTA da legenda (`Comente "X"`, `mande "X"`).
6. Gera ID `REF-AAAA-MM-NNNN` (sequência por mês de importação) e move para `videos/AAAA/MM/REF-…_usuario_categoria.mp4`. Insere referência + snapshot de métrica numa transação.
7. Qualquer exceção fica isolada no item (`erro` + motivo legível + stderr resumido); o lote continua. Progresso vai por SSE.

Publicação sem vídeo (foto/carrossel de imagens): quando o yt-dlp responde "sem vídeo", o item é refeito com `--ignore-no-formats-error --skip-download`, que ainda entrega legenda, capa e métricas; a referência é gravada como `kind=imagem`. Se isso também falhar, o item fica `erro` com o motivo real. (O embed público `/embed/captioned/` foi testado e descartado: hoje é um app JS sem dados no HTML.)

## Duplicados

1. Shortcode canônico (UNIQUE no banco). 2. SHA-256 do arquivo (upload manual com mesmo hash → 409 com o ID existente). 3. "Possível duplicado": mesmo criador + duração ±0,5 s + mesma dimensão (listado em Configurações e no visualizador).

## API (prefixo `/api`)

| Método | Rota | Função |
|---|---|---|
| GET | `/stats` | Dashboard |
| GET | `/refs?f=<json>` | Lista com filtros combinados + total |
| GET/PATCH/DELETE | `/refs/:id` | Detalhe, edição (status, favorito, notas, análise, categorias, clientes, projetos, tags), exclusão |
| POST | `/refs/:id/metrics` | Atualizar métricas (novo snapshot) |
| POST | `/refs/:id/reveal` | Abrir no Finder |
| POST/DELETE | `/refs/:id/markers`, `/markers/:id` | Marcadores de momento |
| GET | `/duplicates` | Possíveis duplicados |
| GET/POST, PATCH/DELETE | `/clients`, `/clients/:id` | Clientes |
| POST, PATCH/DELETE | `/projects`, `/projects/:id` | Projetos |
| GET/POST, PATCH/DELETE | `/categories`, `/categories/:id` | Categorias |
| GET | `/tags` | Tags |
| GET/POST, GET/PATCH/DELETE | `/collections`, `/collections/:id` | Coleções manuais e inteligentes |
| POST | `/collections/:id/refs` | Adicionar/remover referências |
| GET | `/collections/:id/export` | Zip com vídeos, capas e metadados |
| POST | `/import` | Links (texto ou lista) |
| POST | `/import/csv`, `/import/manual` | CSV, upload manual (multipart) |
| GET | `/import/jobs`, `/import/events` | Histórico, progresso (SSE) |
| GET | `/export.csv?f=`, `/export.xlsx?f=` | Exportar metadados |
| GET/POST | `/backups`, `/backup` | Listar / criar backup |
| POST | `/restore` | Restaurar (nome em `backups/` ou upload) |
| GET | `/storage` | Espaço ocupado |
| GET/PATCH | `/settings` | Preferências do servidor |

Mídia: `GET /media/<caminho relativo>` com HTTP Range (206), restrito à pasta da biblioteca.

## Decisões

- **Sem framework de servidor nem ORM.** `Bun.serve` + SQL direto: menos dependências, consultas de filtro explícitas.
- **Router próprio (~40 linhas)** com History API: URLs compartilháveis (`/ref/REF-2026-10-0001`, `/clientes/3`). O visualizador abre sobre a lista atual (estado `background` no histórico).
- **Zip via `zip`/`unzip` do sistema:** backups com vídeos grandes não passam pela memória. XLSX gerado à mão (XML mínimo + zip), sem dependência.
- **Ícones:** `lucide-react`. Gráficos do dashboard: barras em HTML/CSS, sem biblioteca.
- **Segurança local:** servidor só em `127.0.0.1`; requisições com `Host` diferente de `127.0.0.1/localhost` são recusadas (DNS rebinding) e mutações com `Origin` de outro site são recusadas (CSRF). Caminhos de mídia normalizados e presos à biblioteca. Cookies nunca gravados — só a flag `--cookies-from-browser`.
- **Métricas:** nunca sobrescritas; cada coleta é um snapshot. Engajamento = (curtidas + comentários) / visualizações, só quando há visualizações.
- **Restauração segura:** valida manifesto (SHA-256 de cada arquivo) e `PRAGMA integrity_check` antes de trocar; a biblioteca atual é movida para `backups/antes-da-restauracao-<data>/`, nunca apagada.
- **Testes:** `bun test` com biblioteca temporária e downloader falso; `scripts/verify-acceptance.ts` sobe o servidor real como processo e prova os 9 critérios.

## Empacotar com Tauri depois

A UI já é estática (`web/dist`) e toda a lógica fica atrás da API HTTP. Caminho: instalar Rust, `bun build --compile server/index.ts` para gerar binário do servidor, registrá-lo como *sidecar* no Tauri, abrir a janela em `http://127.0.0.1:4317`. Nenhuma mudança no React é necessária.
