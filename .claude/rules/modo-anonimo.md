---
paths:
  - "src/lib/inbox/modo-anonimo*"
  - "src/hooks/use-modo-anonimo*"
  - "src/hooks/use-conversa-aberta*"
  - "src/hooks/use-acoes-da-agendada*"
  - "src/components/inbox/scheduled-bar.tsx"
  - "src/components/layout/header.tsx"
  - "src/app/*/inbox/page.tsx"
  - "src/components/inbox/message-thread.tsx"
  - "src/components/inbox/conversa-em-painel.tsx"
  - "src/lib/inbox/ordem-da-lista*"
---

# Modo anônimo — regras

Decisão do operador (01/10/2026): o ADMINISTRADOR (admin ou dono) liga no
menu do nome, no cabeçalho, e abre conversas sem deixar rastro para a equipe:
as não lidas não zeram e ele não aparece na presença da conversa (os avatares
do cabeçalho do fio e a frase acima do compositor). RESPONDER zera. Dura até
ele desligar, neste navegador. Regra pura em `src/lib/inbox/modo-anonimo.ts`,
estado em `useModoAnonimo`; pinos `modo-anonimo.test.ts` e
`modo-anonimo.chamadores.test.ts`. A presença em si: `inbox-conversa.md`.

- ⚠️⚠️ **Todo caminho que zera as não lidas ou marca a presença passa pelo
  modo.** A página deriva `conversaLida` — nula no modo e FORA DO PERFIL
  (`foraDoPerfil`, a mesma variável do cartão `ConversaForaDaArea` e da ficha
  que some: quem vê o bloqueio não está lendo) — e a usa no escritor da
  presença (`useMarcarConversaAberta(conversaLida)`) e nos dois espelhos da
  lista do tempo real (UPDATE da conversa e `comMensagemNova`); o clique e o
  link (`?c=`) conferem `!modoAnonimo` antes de esvaziar o espelho; o fio grava
  o zero só por `zerarNaoLidas`. Espelho zerado no modo mentiria "lida" até o
  próximo reload. O pino faz o INVENTÁRIO de quem zera: arquivo novo reprova
  até alguém decidir se ele roda quando a pessoa só LÊ (abrir conversa por
  uma tela nova, pelo Meu dia).
- ⚠️ **O fio fora da caixa de entrada repete a régua da página.** O painel
  lateral (`conversa-em-painel.tsx`, a conversa por cima da pauta de
  reuniões) é o SEGUNDO escritor da presença: deriva `foraDoPerfil` e
  `conversaLida` com as mesmas linhas, e fora do perfil não monta o fio. O
  pino cobra as duas cópias; tela nova que monte o `MessageThread` entra no
  inventário do mesmo jeito.
- ⚠️ **Responder zera em `marcarEnviada`, depois de o servidor confirmar**, na
  conversa PARA a qual a mensagem saiu (`conversationIdDoEnvio`, parâmetro
  obrigatório; o pino casa cada `fetch` da rota de envio com um
  `marcarEnviada`). O "Executar agora" da agendada, DENTRO da conversa,
  também é resposta (`aoEnviarAgora` da `ScheduledBar`); na tela `/agendadas`
  não zera, como fora do modo. Agendar, reagir, anotar e executar automação
  não zeram; enviar pela ficha de `/contatos` também não.
- **A lista aprende o zero da resposta e do desligar pelo TEMPO REAL**
  (aceito): evento perdido deixa o número até o resync da reconexão, e a
  resposta do próprio admin pisca a linha (+1 de `comMensagemNova`) até o
  UPDATE chegar.
- ⚠️ **`modoAnonimo` nas dependências do efeito de zerar é load-bearing**:
  desligar o modo com a conversa aberta zera na hora. O UPDATE fica
  INCONDICIONAL (sem `unread_count > 0`): é o zero devolvido pelo tempo real
  que derruba `hasUnread` e deixa a próxima mensagem re-rodar o efeito.
- ⚠️ **Papel REAL (`profile.account_role`), não a lente "Ver como"**: o modo
  é da pessoa, como a presença e as escritas dela durante a lente. Chave
  plantada à mão por quem não é admin é ignorada, e quem deixa de ser admin
  perde o modo (`modoAnonimoAtivo`). ⚠️ Papel DESCONHECIDO (o perfil não
  carregou) MANTÉM o modo de quem o ligou — o erro não pode virar rastro — e
  o cabeçalho mostra o item para desligar (`disponivel || ativo`).
- ⚠️ **`localStorage` com o `user.id` de quem ligou como VALOR, e NÃO se
  apaga ao sair** ("até eu desligar"): a amarra ao login impede outra pessoa
  no mesmo navegador de herdar o modo. Armazenamento bloqueado lê como
  desligado e o interruptor avisa — nunca pastilha acesa sobre modo que não
  vale. A troca numa aba chega às outras pelo evento `storage`.
- **A pastilha é ESCURA (`bg-foreground text-background`)**, ao lado do nome,
  em toda tela; no celular, só o olho riscado. Violeta, âmbar e verde já dizem
  outra coisa na conversa (situação, presença).
- **O que o modo NÃO esconde:** o status online do membro (`member_presence`).
  ABRIR a conversa não manda confirmação de leitura ao cliente, em modo
  nenhum (o `markRead` do transporte não tem chamador); quem marca como lida é
  o "digitando…" do agente de IA na Meta (`src/lib/ai/digitando.ts`, P6).
