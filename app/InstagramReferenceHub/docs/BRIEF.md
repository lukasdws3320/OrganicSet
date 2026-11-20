# PROJETO: INSTAGRAM REFERENCE HUB — Biblioteca Inteligente de Referências

Act like um engenheiro de software sênior, arquiteto de sistemas, designer UX/UI especialista em interfaces SaaS, desenvolvedor full-stack e especialista em gestão de conteúdo para redes sociais.

Sua missão é desenvolver um sistema completo, funcional e visualmente sofisticado chamado **Instagram Reference Hub**, destinado a organizar, armazenar, visualizar, pesquisar e analisar referências de vídeos do Instagram.

Não quero apenas um protótipo visual. Quero um aplicativo realmente funcional, com persistência de dados, gerenciamento de arquivos, organização por clientes, filtros avançados e reprodução local dos vídeos.

## ETAPA 1 — Objetivo principal

Criar um painel privado de referências do Instagram para uso profissional, permitindo que eu:

1. Cadastre links de Reels e vídeos do Instagram.
2. Importe os vídeos e armazene os arquivos no meu computador, quando o download for permitido.
3. Registre as métricas públicas disponíveis: curtidas, comentários e visualizações.
4. Armazene a legenda original integral, preservando quebras de linha, emojis, hashtags e espaçamento.
5. Visualize os vídeos em uma interface semelhante à experiência do Instagram.
6. Organize referências por clientes, projetos, temas, nichos e categorias.
7. Pesquise e filtre vídeos rapidamente.
8. Adicione observações estratégicas e ideias para adaptar cada referência.
9. Utilize a mesma biblioteca para diferentes clientes, sem duplicar arquivos desnecessariamente.

## ETAPA 2 — Importação dos vídeos

Desenvolva um módulo de importação contendo:

- Campo para inserir um link individual.
- Área para colar dezenas de links simultaneamente.
- Importação de links por arquivo CSV.
- Detecção de URLs duplicadas.
- Histórico de importações.
- Indicador de progresso.
- Tratamento de links inválidos, publicações privadas e vídeos indisponíveis.

Quando tecnicamente possível e autorizado, o sistema deve importar:

- Arquivo original do vídeo.
- Imagem de capa.
- Nome do perfil responsável.
- @usuário do criador.
- URL original.
- Data de publicação.
- Número de visualizações.
- Número de curtidas.
- Número de comentários.
- Legenda original completa.
- Data e horário da coleta das métricas.

Utilize APIs oficiais ou métodos de importação autorizados. Caso determinado conteúdo ou métrica não esteja acessível, apresente o campo como "Não disponível", sem inventar informações.

Ofereça também importação manual de vídeos obtidos legitimamente.

## ETAPA 3 — Armazenamento local obrigatório

Os vídeos devem permanecer armazenados no meu computador, e não depender exclusivamente do Instagram para reprodução.

Implemente uma estrutura organizada:

Instagram Reference Hub/
- database/
- videos/
- thumbnails/
- exports/
- backups/

Dentro de videos/, adote uma organização por ano e mês.

Use uma nomenclatura padronizada:

**REF-AAAA-MM-NNNN_usuario_categoria.mp4**

Exemplo:

REF-2026-10-0001_perfilmarketing_storytelling.mp4

Cada referência deve receber um ID único e permanente, independentemente de alterações no nome do arquivo.

Armazene os metadados em um banco de dados local, preferencialmente SQLite, com relações consistentes entre vídeos, clientes, categorias e projetos.

Evite duplicar vídeos quando uma referência estiver associada a várias clientes.

## ETAPA 4 — Interface visual inspirada no Instagram

Crie uma interface moderna, elegante, intuitiva e responsiva.

Estética desejada:

- Interface premium de plataforma SaaS.
- Modo escuro e modo claro.
- Miniaturas grandes.
- Navegação lateral.
- Layout em grade semelhante ao Instagram.
- Cartões com informações importantes.
- Tipografia moderna.
- Ícones minimalistas.
- Excelente legibilidade.

Ao clicar em um vídeo, abra um visualizador com:

**Coluna esquerda**
- Vídeo em formato vertical 9:16.
- Reprodução local.
- Controles de play e pause.
- Volume.
- Barra de progresso.
- Opção de tela cheia.

**Coluna direita**
- Foto ou identificação do perfil.
- @usuário.
- Legenda integral formatada.
- Curtidas.
- Comentários.
- Visualizações.
- Data de publicação.
- Link original.
- Categorias.
- Clientes associados.
- Notas e análise estratégica.

A apresentação deve se aproximar visualmente da experiência do Instagram, sem se passar pelo aplicativo oficial.

## ETAPA 5 — Organização por clientes

Crie um módulo chamado "Clientes".

Cada cliente deve possuir:

- Nome.
- Segmento de mercado.
- Identidade visual.
- Projetos ativos.
- Categorias de conteúdo.
- Referências associadas.
- Observações.

Uma referência pode pertencer simultaneamente a diferentes clientes.

Exemplo:

Um Reel sobre storytelling poderá ser associado a uma cliente do nicho de estética e outra do nicho de moda.

Disponibilize uma visão "Todas as referências" e visões específicas para cada cliente.

## ETAPA 6 — Sistema de classificação

Implemente categorias e tags personalizáveis.

Categorias iniciais sugeridas:

- Storytelling
- Ganchos virais
- Vendas
- Autoridade
- Conteúdo educativo
- Bastidores
- Humor
- Trends
- Lifestyle
- Prova social
- Depoimentos
- Edição criativa
- Transições
- Roteiros
- Conteúdo emocional

Permita múltiplas categorias por referência.

Adicione um campo de classificação estratégica:

- Gancho utilizado.
- Estrutura do roteiro.
- Técnica de edição.
- Principal motivo para salvar.
- Como adaptar para uma cliente.
- Ideias derivadas.

## ETAPA 7 — Filtros e pesquisa inteligente

Crie filtros combináveis por:

- Cliente.
- Projeto.
- Categoria.
- Tag.
- Criador.
- Data de publicação.
- Data de importação.
- Quantidade de visualizações.
- Quantidade de curtidas.
- Quantidade de comentários.
- Taxa de engajamento, quando houver dados suficientes.
- Favoritos.
- Conteúdos já utilizados.
- Conteúdos ainda não utilizados.

Permita ordenar por relevância, mais recentes, mais antigos, mais visualizados e mais curtidos.

Adicione busca textual em legendas, hashtags, nomes de perfis e observações.

Permita salvar combinações de filtros como coleções inteligentes.

## ETAPA 8 — Dashboard de desempenho

Na página inicial, apresente:

- Total de referências cadastradas.
- Total de vídeos salvos localmente.
- Número de clientes.
- Categorias mais utilizadas.
- Referências adicionadas recentemente.
- Vídeos favoritos.
- Vídeos com mais visualizações.
- Distribuição de referências por cliente.

Exiba as métricas de forma visual, incluindo gráficos e indicadores.

Não apresente uma métrica como atual se ela foi capturada em uma data anterior.

## ETAPA 9 — Recursos de produtividade

Implemente:

1. Favoritar referências.
2. Copiar legendas preservando sua formatação.
3. Copiar links originais.
4. Criar coleções temáticas.
5. Adicionar notas privadas.
6. Marcar referências como "Usada", "Em produção" ou "Disponível".
7. Exportar metadados em CSV ou Excel.
8. Exportar coleções com seus arquivos e metadados, quando autorizado.
9. Fazer backup e restauração da biblioteca.
10. Detectar vídeos duplicados.
11. Exibir o espaço de armazenamento ocupado.
12. Abrir o arquivo original diretamente na pasta local.

## ETAPA 10 — Arquitetura e implementação

Priorize um aplicativo local-first, que funcione no computador do usuário.

Sugestão de tecnologias:

- React e TypeScript para a interface.
- Tailwind CSS para estilização.
- Tauri para distribuição como aplicativo desktop.
- SQLite para armazenamento dos metadados.
- Sistema de arquivos local para os vídeos e miniaturas.

A implementação deve incluir:

- Estrutura de diretórios.
- Modelo de dados.
- Componentes reutilizáveis.
- CRUD completo.
- Importação em lote.
- Validação de entradas.
- Tratamento de erros.
- Gerenciamento de downloads autorizados.
- Persistência de dados após reiniciar o aplicativo.
- Rotina de backup e restauração.
- Testes das principais funcionalidades.

Não utilize dados fictícios como substitutos permanentes de funcionalidades reais.

## ETAPA 11 — Experiência do usuário

A navegação principal deve conter:

**Dashboard | Todas as referências | Clientes | Coleções | Favoritos | Importar vídeos | Configurações**

O fluxo deve permitir que o usuário:

1. Cole os links.
2. Inicie a importação.
3. Acompanhe o resultado individual de cada link.
4. Confira o vídeo e as informações importadas.
5. Escolha categorias e clientes.
6. Salve a referência.
7. Encontre posteriormente qualquer vídeo por filtros ou pesquisa.

O sistema deve permanecer útil mesmo sem internet para todos os vídeos e dados previamente armazenados localmente.

## ETAPA 12 — Entregáveis

Entregue:

1. Aplicativo funcional.
2. Código-fonte organizado.
3. Interface completa e responsiva.
4. Banco de dados local.
5. Sistema de armazenamento de vídeos.
6. Sistema de importação.
7. Manual de instalação e uso.
8. Instruções para backup e migração para outro computador.
9. Testes das funcionalidades principais.
10. Explicação clara de eventuais limitações de acesso a dados do Instagram.

Caso o ambiente de desenvolvimento não permita criar o instalador diretamente, entregue o projeto executável localmente com os comandos necessários para instalar suas dependências, iniciar e compilar o aplicativo.

## ETAPA 13 — Critérios de aceite

O projeto somente poderá ser considerado concluído quando:

- Um vídeo salvo puder ser reproduzido sem internet.
- Uma referência puder ser relacionada a várias clientes.
- Legendas preservarem quebras de linha e emojis.
- Os filtros puderem ser combinados.
- Os dados continuarem disponíveis após fechar e reabrir o aplicativo.
- Vídeos duplicados forem identificados.
- Os arquivos puderem ser localizados no computador.
- Importações com erro não comprometerem os demais registros.
- Backups puderem ser restaurados corretamente.

Priorize funcionalidades reais, segurança dos dados, organização e facilidade de uso.

Comece apresentando a arquitetura do sistema, depois implemente as funcionalidades por etapas, verificando cada uma antes de avançar.

Take a deep breath and work on this problem step-by-step.