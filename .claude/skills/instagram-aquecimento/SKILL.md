---
name: instagram-aquecimento
description: Guia a criação e o aquecimento do Instagram do avatar — perfil BR ou gringo (EUA/Espanha), celular isolado, proxy residencial estática, cadastro, nicho, aquecimento de 2 dias com spy e separação de vídeos para React. Use quando o aluno falar em criar conta, Instagram novo, proxy, celular, nicho, aquecer perfil, spy, "o que eu sigo", ou escolher vídeos para replicar.
---

# Instagram: criar e aquecer

O agente orienta e registra; quem mexe no celular e na conta é o aluno. Nunca pedir senha, código ou dados de cartão. Ler `memoria/aluno.md` para saber o mercado.

## Perfil BR

- Pode criar no celular normal do aluno, sem proxy.
- Criar um e-mail para o cadastro (pessoal ou profissional) e usar no Instagram.

## Perfil gringo (Estados Unidos ou Espanha)

**Aparelho**
- Celular físico isolado, nunca o pessoal. Não precisa ser bom; fazer hard reset (restaurar de fábrica) antes.

**Proxy**
- Sempre **Static Residential** (residencial estática) do país do perfil. Nunca proxy BR para perfil gringo.
- Opções: Proxy-Cheap (pegar a *dedicated*): https://www.proxy-cheap.com/services/static-residential-proxies · Private Proxy: https://privateproxy.me/br/residential-static-proxies
- Antes de usar, conferir o IP no Scamalytics: nota máxima **25**. Acima disso, pedir outro IP.
- Instalar o app **Super Proxy** no celular e colocar a proxy nele. A proxy **nunca desliga**.
- Os dados de acesso da proxy ficam só no app, nunca nesta pasta ou no chat.

**Cadastro**
- Só com e-mail, **sem número de celular**.
- Verificar o e-mail e criar uma senha própria.

## Aquecimento + spy (2 dias)

1. **Nicho** (de `memoria/aluno.md`). Ângulo de receita: receitas/comida, receita saudável/emagrecimento, receitas medicinais. O vídeo pode ser de receita e a CTA de emagrecimento ("quer perder a pochete? comenta X que te mando no privado").
2. **Alimentar o algoritmo:** seguir perfis grandes do nicho e salvar vídeos deles, até o Explorar e o Reels mostrarem só o nicho.
3. **Spy:** enquanto aquece, anotar formatos, ângulos e ideias que se repetem nos vídeos que performam.
4. **Separar vídeos para React:** vídeos que já viralizaram, com animação ou ação acontecendo, onde dá para colocar o avatar na frente reagindo ou narrando. São a primeira leva de referências.

Registrar o que o aluno separar: cada link é importado no Reference Hub (tela Importar ou `bun app/InstagramReferenceHub/scripts/hub.ts importar --url "<link>" --expert <personagem>`, com o Hub aberto). Meta da primeira semana: **15 referências**. Anotações de spy (formatos/ângulos que se repetem) vão em `experts/<Nome>/09_pesquisa/spy.md`, com data.

## Depois

Com o perfil aquecendo e as 15 referências separadas: avatar (`expert-identidade-visual`) → replicação (`reference-hub` + `replicar-referencia`) → legendas e calendário de 30 posts (`legenda-versoes`, `calendario-postagens`).
