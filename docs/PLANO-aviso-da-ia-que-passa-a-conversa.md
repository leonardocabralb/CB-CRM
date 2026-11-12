# Plano — aviso quando a IA passa a conversa para a equipe (1139)

Pedido do operador (11/11/2026): os agentes de IA do Trabalhista vão passar
MENOS conversas à equipe, mas as que passam (pedido de ligação, caso de
advogado, assinatura travada) precisam ser vistas na hora. Hoje a
transferência (`transferirParaGente`, `src/lib/ia-agentes/turno.ts`) pausa a
IA, deixa a conversa Pendente e escreve uma anotação sem menção — ninguém é
avisado, e nenhum agente tem "Transferir para" preenchido. O operador pediu
"uma notificação pop-up dentro do app quando a IA transferir para um humano,
clicável, levando direto à conversa".

Vale para TODO agente e todo motivo de transferência: a PENDÊNCIA dos agentes
do Trabalhista e do Previdenciário (campo + etapa "Pendências da IA" +
`[[TRANSFERIR]]`), o limite de respostas, o áudio que não se ouve, o envio
incerto (também o recolhido pela rede do cron), a reunião não marcada e as
respostas retidas (link inventado, ação/reunião prometida, pedido vazado).
A PASSAGEM entre agentes não é transferência para gente e não avisa.

## Decisões do operador (11/11/2026, todas as recomendações)

- **D1 — Quem recebe**: as pessoas escolhidas EM CADA AGENTE (campo novo
  "Avisar quando passar para a equipe", `cb_ia_agentes.avisar_ao_transferir`)
  e, sempre, quem é responsável pela conversa. Lista vazia (ou ninguém dela
  ainda ativo na conta) = o dono, os administradores e quem atende o número
  (os membros cujo perfil vê a conexão da conversa — a régua dos alarmes de
  conexão, 1122).
- **D2 — O texto**: título "IA passou <cliente> para a equipe"; embaixo, os
  campos que o agente preencheu na MESMA resposta que passou a conversa (no
  Trabalhista, "Pendência da IA: Pediu condição diferente"). Sem campo, o
  motivo do sistema (o mesmo texto da anotação da transferência).
- **D3 — A caixinha dentro do CRM** fica até a pessoa abrir a conversa ou
  fechar no X. Clicar abre `/inbox?c=<conversa>` e marca o aviso do sino como
  lido.
- **D4 — Tipo próprio no sino** (`ia_transferiu`), no Meu dia e no pop-up do
  navegador de quem o ligou; a caixinha dentro do CRM é SÓ deste tipo.

## Desenho

- **Migration 1139 (ADITIVA, antes do deploy)**: `ia_transferiu` no CHECK de
  `notifications.type` (os seis tipos de antes reescritos e conferidos) e
  `cb_ia_agentes.avisar_ao_transferir uuid[] NOT NULL DEFAULT '{}'` (até 50,
  CHECK com nome). Sem a coluna, `COLUNAS_DO_AGENTE` quebra toda leitura de
  agente; sem o tipo, o INSERT do aviso é recusado (o aviso é melhor esforço:
  a transferência segue).
- **Servidor** (`src/lib/ia-agentes/aviso-da-transferencia.ts`): depois da
  anotação da transferência — só quando a transferência ACONTECEU
  (`transferiu`; `nada_mudou` não avisa) —, lê a conversa (responsável,
  conexão, contato) e os membros ATIVOS (perfil incluso), decide quem recebe
  (`quemAvisarDaTransferencia`, puro) e grava uma linha por pessoa. Falha vira
  log; nunca derruba a transferência. Os campos preenchidos chegam do turno em
  memória (`executarAcoes` devolve `campos`): o registro do turno guarda o
  campo, não o valor.
- **Tela**:
  - o sino, o Meu dia e o pop-up do navegador já leem título e corpo gravados
    (ícone novo nos dois mapas exaustivos);
  - a caixinha (`useAvisoDaIaNaTela`, montado no `BrowserNotificationsListener`,
    depois do "Continuar") ouve os INSERTs do próprio login e abre um
    `toast.custom` sem prazo; some ao clicar, ao fechar, quando o aviso é lido
    por outro caminho (sino, pop-up, outra aba) ou quando a pessoa abre a
    conversa (`EVENTO_CONVERSA_ABERTA`);
  - com a aba EM FOCO, o pop-up do sistema cala para este tipo (a caixinha já
    está na tela) e a caixinha toca o som do CRM; fora de foco, o pop-up sai
    como os outros avisos do sino e o som é dele;
  - na tela do agente, "Avisar quando passar para a equipe" (caixas com os
    membros) na seção "Limites e passagem".

## Limites aceitos

- Com "Transferir para" preenchido e ninguém responsável, a pessoa do destino
  recebe também o "Conversa atribuída a você" do gatilho da 0027 (dois avisos
  da mesma passagem). Nenhum agente tem o campo preenchido em 11/11/2026.
- O resumo "Novidades" da porta do Meu dia não conta o tipo novo (como o
  `whatsapp_alert`): o aviso aparece no sino e no bloco de notificações.
- Pessoa escolhida cujo perfil não vê a conexão recebe o aviso e, no clique,
  cai na conversa "fora da sua área" — a escolha é do administrador.

## Estado

- 11/11/2026: decisões D1–D4; código, testes e doc no PR #510.
- 12/11/2026: 1139 aplicada na produção (histórico `20261112123108`) com a
  autorização do operador, depois do CI verde e do Codex sem achados no
  `b3cfb5c1`. Conferido no preview: o campo "Avisar quando passar para a
  equipe" na tela do agente (os 16 membros, nada salvo) e um aviso de TESTE
  no sino do operador (id `11390000-…`) — a caixinha apareceu em segundos
  pelo tempo real, o clique abriu `/inbox?c=` do lead de teste e marcou lido,
  o sino o mostrou com o ícone; o aviso foi apagado (contagem zero).
- Falta: marcar quem recebe nos dois agentes do Trabalhista (vazio = dono,
  admins e quem atende o número) e ver o 1º aviso real ao ligar um agente.
