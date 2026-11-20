---
name: replicar-analise-visual
description: "Analisar referência com Watch e duas leituras visuais independentes, conciliar estados, camadas e fala antes dos prompts."
---

Ler [orquestrador](../../SKILL.md) antes desta etapa.

# Leitura visual e fala

A transcrição preferencial é AssemblyAI com timestamps por palavra; conferir nomes, unidades e números contra o áudio. Reaproveitar cache válido e registrar a origem/fallback. Watch é extração local de frames timestampados, não um modelo que assiste sozinho.

Executar pela fila `preparar` do Hub. O coletor `scripts/analisar-revisao.py` envia os mesmos quadros, em ordem e com timestamps, separadamente para **claude-opus-5-5** e **claude-sonnet-5-5**, ambos `--effort low`. Cada leitura é independente: não recebe a resposta da outra. Guardar modelo efetivo, esforço, arquivos/hashes de entrada, observações e erros. Não declarar vídeo contínuo assistido quando a evidência é amostrada.

Gemini pode complementar. Erro/cota do Gemini não descarta frames, transcrição ou leituras válidas e não bloqueia o caminho Opus/Sonnet. Uma falha de qualquer leitor preserva trabalho e diagnóstico para retomada localizada; não fabrica a segunda leitura. Reusar leituras somente com hashes de vídeo, transcrição e quadros iguais.

A síntese em `conferir-mapa.py` recebe ambas as leituras e os quadros. Para divergências que alteram ação, ingrediente, câmera ou montagem, rever a janela; registrar incerteza em vez de decidir pela maioria. A validação local confere ordem, cobertura, fala literal, timestamps e hashes. Evidência não fica falsamente rotulada como Gemini.

Resolver: quem aparece/fala, onde olha, ação/objeto/contato/antes/depois, cortes de câmera versus edição, inserções, camadas, formato e estilo por camada. React pode existir só no hook. Estilo 3D do avatar não transforma automaticamente um fundo real em 3D. Ângulo editorial vem da fala/texto e é separado do ângulo da câmera.

Entregar mapa e plano de camadas ao módulo de formato. Só uma indisponibilidade real de todas as rotas pertinentes ou evidência material insuficiente bloqueia a etapa dependente; continuar etapas independentes. Nunca liberar prompts que finjam resolver uma dúvida crítica.

### Autenticação local do leitor

A chamada é pelo Claude Code CLI local, não pelo navegador. Em serviço não interativo, `claude_environment()` completa USER/LOGNAME ausentes pela conta do processo para localizar a sessão existente no Keychain. Não copiar tokens, criar credenciais no vault ou pedir novo login antes de conferir esse ambiente. Corrigir o executor e retomar a mesma preparação; preservar vídeo, transcrição, quadros e leituras válidas. O mesmo helper atende as duas leituras e a síntese, sem mudar modelo, esforço ou independência.
