# Ponte Flow local

Pedido humano: reutilizar código Flow recente, criar conexão MCP/API interoperável com harnesses locais, usar sessão Chrome Flow já autenticada. O principal escolheu GTAI-1 SHA 7825125 após auditoria. Não gerar mídia neste trabalho de instalação.

Decisões locais: Node/TypeScript upstream; conexão WS direta porque Chrome privado não serve /json/version; identificação obrigatória por Target ID entre todos os contextos; falha fecha sem criar perfil ou selecionar conta alternativa. Wrapper absoluto descobre socket por DevToolsActivePort em cada invocação. API loopback 8791 porque 8787 pertence a QuizTemplate. Read-only padrão removendo mutações das ferramentas, bloqueando Core/API; fila única compartilhada só entre mesma conta alvo e modo. Nenhuma credencial extraída. Config e estado fora do vault, chmod 600/700.

Aceitação: testes endpoint válido/local e inválido/remoto, target correto entre contextos, alvo ausente/URL errada, bloqueio de todos métodos mutantes, build; handshake MCP e status real sem geração; API health real. Sem commits, push, deploy ou daemon, como solicitado pelo principal.
