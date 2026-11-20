# Execução compartilhada do Reference Hub

Pedido: usar o mesmo processo por UI, Codex, Claude e outros agentes, inclusive preparar uma entrega autossuficiente para chat web.

Diagnóstico: skill replicar-referencia global só no Claude; roteamento do vault/experts ainda favorece dtcwinner de 16/10; UI já chama filas/API, mas chat não tem entrada comum para contexto e pacote de carrossel. A pasta da sessão não explica sozinha a falha: faltam ponteiros e um contrato executável.

Correção: manter código/dados técnicos no Hub, identidade e entregas com o expert, método de DTC no setup. Skill reference-hub com fonte única no app e links nos harnesses. Adaptadores antigos encaminham produção atual à entrada comum, preservando módulos históricos. CLI chama a API existente para importar/preparar/consultar; consulta de contexto resolve explicitamente REF e expert. Pacote para chat de carrossel valida todos os originais, legenda e contact sheet antes de exportar arquivos, papéis dos anexos e prompt. Pacote não aprova nem gera imagens.

Verificação: teste HTTP e CLI na mesma biblioteca isolada; exportação completa e bloqueio de originais/identidade ausentes; ZIP reaberto e hashes conferidos; descoberta por links; typecheck, suíte e build. Não mover acervos, alterar credenciais ou produzir mídia paga.
