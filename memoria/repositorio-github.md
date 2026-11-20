# Repositório do OrganicSet no GitHub (20/11/2026)

- Repositório `lukasdws3320/OrganicSet`. **Público de forma temporária desde 20/11/2026**, para Tiago e Felipe instalarem. Quando o Lukas pedir para fechar: conferir que os dois são Collaborators e aceitaram o convite (`gh api repos/lukasdws3320/OrganicSet/collaborators`), senão o "Atualizar" deles quebra; depois `gh repo edit lukasdws3320/OrganicSet --visibility=private --accept-visibility-change-consequences`. Editores: Tiago e Felipe. A pasta OrganicSet do Lukas é o próprio repositório (branch `main`).
- Guia dos editores (Windows, do zero): https://claude.ai/artifact/6XK2adJ5FNHKcbLoFHTuge. O arquivo-fonte fica no scratchpad da sessão; para mudar, ler o artifact e republicar na mesma URL.
- **"Publica as mudanças do OrganicSet no GitHub"** (pedido do Lukas): `git status`, conferir que não há chave nem dado pessoal (`git grep --cached` por chaves e e-mails), commit em português e `git push`. Depois lembrar o Lukas de avisar o grupo.
- **"Atualiza o OrganicSet"** (pedido de editor): `git pull --rebase --autostash`, o mesmo que `Atualizar OrganicSet (Windows).bat`.
- `memoria/aluno.md` vai em branco no repositório (`status: nao-configurado`). No computador do Lukas ele está com `git update-index --skip-worktree`, então a configuração dele nunca sobe. Não desfazer.
- Ficam fora pelo `.gitignore`: dependências, `trabalhos/`, biblioteca do Hub, saídas do Flow, arquivos gerados pelo painel, `.agents/` e chaves.
