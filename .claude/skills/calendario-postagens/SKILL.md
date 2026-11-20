---
name: calendario-postagens
description: "Recalcula o calendário de postagens dos perfis (Bruno, Mini Chefs) e refaz os lembretes junto. Use SEMPRE que o Matheus pedir para arrumar, recalcular, reorganizar ou atualizar o calendário ou a agenda de posts, mudar a quantidade de posts por dia, encaixar post que não saiu, ou reclamar de lembrete antigo ou duplicado na agenda, mesmo sem citar lembretes."
---

# Calendário de postagens

Calendário e lembretes são uma coisa só: nunca terminar um sem o outro. A fonte é o `06_roadmap/Postagens.md` de cada perfil, gravado pelo Hub (`127.0.0.1:4317`). Fonte técnica: `app/InstagramReferenceHub`.

## Regras dele
- Bruno e Mini Chefs: 5 posts por dia, às 09, 12, 15, 18 e 21h. Muda em `agenda_perfis` (`PATCH /api/settings`) quando ele pedir outra meta.
- Post que não saiu vai para o próximo dia, na frente da fila, não para o fim. A agenda automática do Hub empurra para o fim; o recálculo traz de volta.
- Carrossel das Mini Chefs está arquivado; não voltar.
- Sem repetição (05/11/2026): só V1 e V2, nunca V3. Mesma receita no mesmo perfil só volta depois de 4 dias; a mesma legenda (receita + versão, Loira e Morena contam igual), depois de 7; a mesma receita não sai no mesmo dia nos dois perfis. Legenda até 1000 caracteres. O recálculo já respeita isso e deixa horário vazio quando não há receita livre: menos post é melhor que post repetido.
- Mini Chefs (só receitas) fica com no máximo receitas ÷ 4 posts por dia. Para voltar a 5 por dia, é preciso produzir receitas novas.
- Post extra (Reels teste) é horário fora da grade: fica onde ele pediu.
- Não apagar lembrete. Concluído sai da lista Postagens e perde a data, senão continua no app Calendário.

## Fazer
Rodar em `app/InstagramReferenceHub`:

1. Simular: `python3 scripts/agenda-recalcular.py` (`--de AAAA-MM-DD` se ele pedir outro dia; `--primeiro id,id` para pôr posts na frente; `--perfis` para limitar).
2. Olhar a saída: atrasados no primeiro dia. Dia com grade diferente só hoje: `--horarios-hoje 17:00,19:00,21:00`.
3. Gravar: repetir com `--aplicar`. Depois, `python3 scripts/agenda-repeticao.py` tem de dizer "SEM REPETICAO". Isso muda os horários, refaz os lembretes e confere. Saída 1 ou "faltam", "sobram", "em dobro" diferentes de 0 = não terminou.
4. Gerar o checklist: `python3 scripts/agenda-html.py`, e trocar a linha da agenda vigente em `experts/03_cronograma-postagens/03_cronograma-postagens.md`.
5. Faltando posts para fechar a meta: criar variação com `POST /api/posts` (`replicacao`, `versao`, `canal`, `agendado_para`). V2 = 1º e 2º parágrafos da V1 trocados, resto igual, até 1000 caracteres; legenda nova sem `legendas-post.json` vai em bloco ```legenda na seção. Dizer quais criou.

Mudança pontual (um post, um horário): `PATCH /api/posts/<id>` com `agendado_para`; depois `python3 scripts/agenda-recalcular.py --conferir`. O Hub refaz os lembretes sozinho 2 s depois de marcar ou mudar a data. Edição direta na nota não dispara: rodar `python3 scripts/lembretes-postagens.py`.

## Entregar
O que muda para ele hoje, até quando vai a fila de cada perfil, o que foi criado e o link da agenda.
