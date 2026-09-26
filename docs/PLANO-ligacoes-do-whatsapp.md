# Ligações de WhatsApp no fio da conversa (plano vivo)

Documento interno. Pedido do operador (25/09/2026): "às vezes a gente recebe
ligações pelo WhatsApp; a Evolution não transmite a ligação, mas recebe a
informação de que houve uma. Dá para pôr um aviso na conversa de que o lead
tentou ligar, para alguém ver e retornar?"

## Estado

| Fase | O quê | Estado |
| --- | --- | --- |
| 0 | Estudo de viabilidade (medido em produção) | ✅ 25/09/2026 |
| 1 | Back-end: assinar `CALL`, `cb_ligacoes`, desfecho, bolha, efeitos | ✅ código e testes (PR em rascunho) |
| 2 | Tela: faixa no fio, prévia na lista e no card, textos | ✅ código e testes (mesmo PR) |
| 3 | Aplicar a 1044 → teste ponta a ponta no preview → merge → deploy | ⏳ em andamento (autorizada em 26/09/2026) |
| 4 | "Ressincronizar" o Bancário - Comercial → ligações de teste do operador → conferir | ⏳ depois do deploy |
| 5 | "Ressincronizar" as outras conexões por QR Code | ⏳ depois da 4 |
| 6 | Pesquisa: atender e ligar pelo sistema (Wavoip) | ⏳ pedida para o fim |

## 1. O que foi medido (Fase 0, 25/09/2026, só leitura)

- **A Evolution avisa, o CRM ignorava.** No código da Evolution que roda em
  produção (commit `e273b904`, Baileys 7.0.0-rc13), cada ligação vira um
  webhook `CALL` (`sendDataWebhook(Events.CALL, call)` em
  `whatsapp.baileys.service.ts`) — e `CALL` é evento válido do enum da 2.4. A
  lista de eventos que o CRM assina (`WEBHOOK_EVENTS`) não o tinha.
- **O log da Evolution de 25/09** (das 11h às 21h; ele só guarda ~10 horas)
  registrou 5 ligações:

  | Hora | Quem | O que aconteceu |
  | --- | --- | --- |
  | 12:49 | cliente com conversa no Trabalhista - Jurídico | tocou 40 s, ninguém atendeu |
  | 13:28 | o mesmo cliente | tocou 63 s, ninguém atendeu (a primeira resposta da equipe saiu às 14:18, pelo celular) |
  | 14:32 | cliente do Bancário - Comercial | atendida no celular em 21 s |
  | 17:04 | cliente do Trabalhista - Comercial | atendida no celular em 9 s |
  | 17:04 | número que nunca escreveu a nenhuma conexão | tocou 19 s, ninguém atendeu |

  (Os nomes ficam de fora: o repositório é público.)
- **Perdida × atendida:** uma ligação gera `offer` → três `relaylatency` →
  `terminate`. Quando alguém atende no celular do escritório, chega também um
  `accept` vindo do PRÓPRIO aparelho (plataforma `smbi`, WhatsApp Business no
  iPhone), no mesmo segundo do `terminate`. Esteve nas 2 atendidas e em
  nenhuma das 3 perdidas.
- **Quem ligou:** as 5 vieram endereçadas por LID. O acervo do CRM
  (`resolverTelefoneDoLid`, 1010) resolveu 3 dos 4 números; o quinto nem a
  Evolution conhecia. Para esse caso a Baileys rc13 traz o `callerPn` (PR
  #2190 dela), com defeito relatado para telefone fixo (issue #2154: um zero a
  mais no fim).

## 2. Decisões

| # | Decisão | De quem |
| --- | --- | --- |
| D1 | Número que nunca escreveu: a ligação cria ficha, conversa e card no funil | operador, 25/09 |
| D2 | Ligação atendida no celular também aparece no fio | operador, 25/09 |
| D3 | Retorno feito pelo celular não apaga o "em atraso" (o CRM não o vê); é aceitável | operador, 25/09 |
| D4 | A ligação (perdida ou atendida) cancela as esperas "parar se o cliente responder" do contato: o cliente procurou o escritório | implementação — **confirmar** |
| D5 | Robô, automações, IA e o webhook de saída `message.received` NÃO reagem à ligação (não há texto a responder). ⚠️ O CARD que a ligação abre (D1) segue o caminho de todo card novo: as automações da etapa de entrada e o `deal.created` ao n8n rodam, como na primeira mensagem de um lead. Medido em 26/09/2026: nenhuma automação ativa age nas etapas de entrada das conexões por QR Code; o n8n assina `deal.created` | implementação |
| D6 | Chamada de grupo é ignorada; ligação de um número do próprio escritório também | implementação |
| D7 | Quem ligou sem telefone resolvível (LID fora do acervo e sem `callerPn` válido) fica registrado em `cb_ligacoes` como `sem_telefone`, sem aparecer na tela | implementação — v1 |
| D8 | Os ajustes prontos da Evolution ficam DESLIGADOS: "rejeitar ligação" recusaria também nos celulares; "mensagem ao ligar" sai em toda ligação e o CRM a leria como resposta de gente | estudo |
| D9 | Número oficial da Meta fica fora (outro mecanismo) | estudo |

## 3. Como funciona

`src/lib/whatsapp/ligacoes/` — `evento.ts`, `desfecho.ts`, `telefone.ts` e
`previa.ts` são puros e testados; `registrar.ts` faz o I/O.

1. A rota do webhook da Evolution recebe o `CALL`, lê o aviso
   (`lerEventoDeLigacao`: só `offer`, `accept`, `reject`, `timeout`,
   `terminate`) e responde 200; o resto roda em `after()`.
2. Cada aviso grava as SUAS colunas na linha da ligação (`cb_ligacoes`, uma
   por conta + `call_id`), só se ainda estiverem vazias.
3. Depois de uma pausa (10 s + 1 s depois do fim e do `offer`; 2 s depois do
   `accept`), tenta decidir:
   - houve `accept` → **atendida**;
   - acabou de tocar sem `accept` e passou a FOLGA de 10 s desde que o CRM
     gravou o fim → **perdida**. A folga existe porque o `terminate` e o
     `accept` saem no mesmo segundo, em POSTs diferentes, e podem chegar fora de
     ordem.
4. Quem ligou: o JID de telefone, senão o acervo (LID → telefone), senão o
   `callerPn` conferido (fixo com o zero a mais é recusado, nunca "consertado").
5. Um UPDATE condicional (`desfecho IS NULL`) reivindica a linha: só um aviso
   grava. Depois: ficha e conversa por `resolverDestinatario` (dono durável da
   conta), a bolha (`content_type = 'call'`, `message_id = 'call:<id>'`,
   detalhes em `messages.ligacao`), reabre a encerrada, sobe a conversa, segue o
   canal, cancela as esperas e abre o card.
   - **perdida**: `sender_type = 'customer'` → não lida (+1, pela RPC atômica
     `bump_conversation_on_inbound`) e o gatilho da 972 acende "em atraso".
   - **atendida**: `sender_type = 'agent'` + `from_device` → sem não lida, e o
     gatilho da 972 apaga "em atraso" (é resposta de gente).
6. Na tela: faixa no meio da conversa ("Ligação de voz perdida · 12:49 · tocou
   40 s"), sem ações; na lista e no card do funil, "📞 Ligação" no lugar do
   marcador `[call]` que o banco guarda.

**Ajustes em volta** (achados pelo levantamento de quem lê `content_type`):

- `message-thread.tsx`: a ligação sai do `MessageActions`, como o aviso de
  grupo (sem isso havia "apagar para todos" numa ligação atendida).
- Radar: a ligação vira linha do transcrito (antes cairia em "mídias sem
  texto").
- Meu dia e Painel: a ligação atendida não conta como mensagem enviada; o
  gráfico de mensagens e o feed de atividade não a contam.
- `comMensagemNova` (tempo real da lista): a prévia da ligação é o marcador,
  não vazio.

## 4. Migration 1044 (`1044_cb_ligacoes.sql`)

- `cb_ligacoes`, FECHADA ao navegador (RLS sem policy; REVOKE das duas
  metades; service role).
- `messages.content_type` aceita `'call'` (CHECK do upstream, estendido pela
  0010 e pela 0906).
- `messages.ligacao jsonb`.
- Conferência só de CATÁLOGO (a trava exclusiva de `messages` fica presa até
  o fim da transação): exige UM CHECK sobre `content_type`. A prova de que a
  bolha entra e os gatilhos a aceitam é o teste ponta a ponta.
- Testada num Postgres 16 descartável (26/09/2026): aplica duas vezes, chave,
  CHECKs, SET NULL das três FKs e privilégios; com um segundo CHECK sobre
  `content_type`, a conferência reprova.
- Aditiva; **aplicar ANTES do deploy**. Sem ela, o INSERT da bolha leva
  23514/42703 e a ligação some (a Evolution já recebeu 200).
- ⚠️ 1044, e não 1042: a 1042 e a 1043 estão reservadas pelos PRs #294/#295
  (agentes de IA). **A ordem de merge importa:** se este PR entrar ANTES deles,
  a 1042 e a 1043 ficam abaixo da 1044 já aplicada, e a instalação que atualiza
  por `supabase db push` recusa número menor que o maior já aplicado — eles
  teriam de ser renumerados no merge deles. Entrando depois deles, nada muda.
  Conferir no merge.

## 5. Implantação e teste (Fases 3 a 5)

1. Autorização do operador → aplicar a 1044 pela Management API → conferir no
   catálogo.
2. Teste ponta a ponta no preview (o preview usa o banco de produção): avisos
   sintéticos no webhook LOCAL da Evolution, SÓ com o lead de teste autorizado
   (conversa `00cc34a4…`): perdida, atendida, reentrega e fora de ordem.
   Conferir a faixa, a lista, a não lida e o "em atraso"; limpar no fim (a
   bolha, a linha de `cb_ligacoes` e o retrato da conversa).
3. Merge → deploy.
4. **Ressincronizar SÓ o Bancário - Comercial.** O operador liga do celular
   dele para esse número:
   - deixar tocar até cair;
   - desligar em 5 s;
   - atender no celular;
   - recusar no celular;
   - chamada de vídeo;
   - o escritório liga de volta pelo celular (para saber se o CRM enxerga a
     ligação feita).

   Conferir `cb_ligacoes` (sequência, `telefone_informado`, desfecho) e o fio.
   ⚠️ O telefone do operador era a conexão "Pessoal Leonardo" (apagada): se ela
   voltar, ele deixa de servir de teste.
5. Ressincronizar as demais conexões por QR Code.

## 6. Limites conhecidos (v1)

- **Quem liga sem telefone resolvível não aparece** (D7). Religar quando o
  número aparecer (como as retidas da 1010) fica para depois, se o registro
  mostrar que acontece.
- **`accept` atrasado mais que a folga** (10 s): a ligação atendida sai como
  perdida. Raro; a Evolution emite os dois no mesmo segundo.
- **Ligação que cria a ficha não dispara "Novo contato criado"**, e uma
  ligação perdida antes da primeira mensagem faz a "Primeira mensagem" não
  disparar para aquela conversa (a contagem é por linha do cliente). Medido em
  25/09/2026: nenhuma automação desta conta usa esses gatilhos. Excluir a
  ligação da contagem quebrava os dublês de 4 arquivos de teste da entrada, e
  ficou de fora por proporção.
- **O nome da ficha criada pela ligação é o telefone** — o aviso `CALL` não
  traz o nome do perfil. A primeira mensagem do cliente o preenche (e o card
  segue, pelo gatilho da 1007).
- **"Origem do contato"** de uma conversa nascida de ligação atendida diz
  "equipe pelo celular".
- **A API v1** lista a ligação com `content_type: "call"` (documentado em
  `docs/public-api.md`); o webhook de saída não emite nada para ela.
- **`callerPn` ambíguo é recusado**: com DDD 31 em diante, 13 dígitos
  terminados em 0 podem ser o defeito da Baileys sobre um celular antigo (o
  número de OUTRA pessoa). Se o defeito valer para todo número de 12 dígitos,
  quem liga de DDD 83 sem estar no acervo fica `sem_telefone`. O valor cru
  fica em `cb_ligacoes.telefone_informado`: as ligações da Fase 4 mostram o
  formato real, e a régua se ajusta com esse dado.
- **`sem_telefone` e `falhou` não aparecem para ninguém** (só em
  `cb_ligacoes`); nem a ligação cujo fim chega nos ~11 s antes de um deploy
  (a espera passa da graça do SIGTERM), nem a perdida sem bolha de um
  processo morto no meio. Recolher isso (varredura no cron, contagem no Meu
  dia) fica para depois, se o registro mostrar que acontece.
- **Resposta por TEXTO nos ~11 s entre o fim do toque e a decisão**: a bolha
  perdida, gravada depois, acende "em atraso" sobre cliente já respondido
  (a 972 decide pela ordem de inserção). Janela pequena, aceita.
- **Robô de "primeira mensagem"**: a perdida conta como linha do cliente, e
  um fluxo com esse gatilho não iniciaria para quem ligou antes de escrever.
  Medido em 26/09/2026: a conta não tem fluxo nenhum.

## 7. Registro das fases

- **Fase 0** (25/09/2026): estudo acima.
- **Fases 1 e 2** (25/09/2026): branch `feat/ligacoes-do-whatsapp`. Arquivos:
  `supabase/migrations/1044_cb_ligacoes.sql`, `src/lib/whatsapp/ligacoes/*`,
  a rota do webhook da Evolution, `evolution-provision.ts` (`CALL`),
  `aviso-de-ligacao.tsx`, `message-bubble.tsx`, `message-thread.tsx`,
  `conversation-list.tsx`, `deal-card.tsx`, `ordem-da-lista.ts`,
  `cb-radar/worker.ts`, `dashboard/queries.ts`, `use-area-de-trabalho.ts`,
  `types/index.ts`, os dois dicionários, `docs/public-api.md` e os pinos
  (`ligacoes.chamadores.test.ts`, `ligacoes-1044.test.ts` e as allowlists de
  funil, reabertura e esperas). Testes: 18 das regras + 16 da orquestração +
  os estruturais. Regra de área: `.claude/rules/ligacoes.md`.
- **Revisão independente** (26/09/2026, um revisor sobre o diff): sem P1.
  Corrigidos: o separador de canal que a ligação abria mudo; a régua do
  `callerPn` (celular antigo de DDD 31+ com o zero a mais); a nova tentativa
  sem canal que não reconhecia a FK composta; o acervo que não responde
  deixou de virar `sem_telefone` (`falhou`, com o motivo); o LID com
  `:aparelho`; citar uma ligação pela API (400); o aviso do navegador sem
  corpo (o ouvinte JÁ está montado); regras e docs que contradiziam os pinos;
  pinos dos filtros do Painel, do Meu dia e do Radar. Registrados como
  limite: os itens da seção 6.
- **Fase 3** (26/09/2026): 1044 aplicada (histórico `20260926112303`) e
  conferida no catálogo. Ponta a ponta no preview, com avisos sintéticos no
  webhook LOCAL da Evolution e só o lead de teste: perdida com o telefone
  pelo acervo LID (reabriu a encerrada, 1 não lida, "em atraso" aceso,
  prévia `[call]`); atendida com o fim chegando ANTES do `accept` (resposta
  da equipe, "em atraso" apagado, não lida mantida); reentrega sem bolha
  dupla; fim antes do `offer` + vídeo + LID fora do acervo com `callerPn`
  (perdida, telefone "pelo whatsapp"); LID sem acervo e sem `callerPn`
  (`sem_telefone`, sem bolha); chamada de grupo (nada gravado); e uma perdida
  com a conversa aberta (a faixa e a linha da lista mudaram sem recarregar).
  Nenhuma automação, robô, aviso, trilha nem card mexido. Limpo no fim, com a
  conversa devolvida ao retrato (menos `updated_at`).
