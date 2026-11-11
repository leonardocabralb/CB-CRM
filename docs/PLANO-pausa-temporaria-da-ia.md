# Plano — pausa temporária da IA (revisa a D26)

Branch `feat/ia-pausa-temporaria`. Vale para TODOS os agentes de IA
(Trabalhista, Previdenciário, Bancário), como configuração da CONTA.
Estado: **P1–P7 decididas e IMPLEMENTADAS nesta branch (11/11/2026)**; a
1138 NÃO aplicada (espera o "pode" do operador). A regra viva é
`.claude/rules/ia-pausa.md`; este plano guarda o desenho e as decisões.

## 1. Como é hoje

- A pausa é PERMANENTE: `conversations.ai_autoreply_disabled` +
  `ia_pausada_por`, com quatro motivos — `gente` (gatilho
  `cb_pausar_ia_por_gente`, 1049/1118: resposta pelo CRM, pelo celular,
  agendada, ligação atendida no celular), `botao` (o Pausar da faixa),
  `transferencia` (a IA passou para a equipe) e `automacao` (`set_ai`).
- Só "Retomar IA" (`POST /api/ai/autoreply/[id]`, `{ paused: false }`) desfaz;
  encerrar (`cb_encerrar_limpa_ia`) também limpa; mover o card não retoma.
- Com a conversa pausada, a mensagem do cliente nem abre turno
  (`quemResponde` → `pausada`), e a retomada (follow-ups) para quando gente
  escreve (`equipe_respondeu`).
- **O problema real:** a equipe assume, deixa uma dúvida sem resposta e some.
  A IA nunca volta, e os follow-ups morrem.
- Medido em 11/11/2026 (leitura): **23 conversas 1:1 pausadas, todas por
  `gente`** (17 abertas, 6 pendentes; de 20/10 a hoje); nenhuma por `botao`,
  `transferencia` ou `automacao`. Todos os agentes estão DESLIGADOS.

## 2. A proposta do operador (11/11/2026)

- Dois controles na faixa: **"Pausar"**, temporário, e **"Desativar IA"**,
  permanente até "Retomar IA".
- Na pausa temporária (a de `gente` e a do Pausar): se a cliente mandar
  mensagem e **ninguém da equipe responder em N minutos** (configuração da
  conta, padrão 15), a IA retoma e responde. A retomada (follow-ups) volta a
  se armar a partir dessa resposta.

## 3. Decisões do operador

Tudo é configuração da CONTA e vale para todo agente (Trabalhista,
Previdenciário, Bancário): nada por agente, por funil ou por conexão
(operador, 11/11/2026).

| # | Pergunta | Decisão |
| --- | --- | --- |
| P1 | Valor padrão de N; 0 desliga? | **15 min; 0 = desligado** (tudo como hoje: pausa até "Retomar IA", sem follow-up depois da equipe). Aceita 0 a 1440. — DECIDIDO 11/11 |
| P2 | `transferencia` (a IA pediu ajuda) continua permanente? | **Sim**, e `automacao` também (só o `set_ai` "ligar" ou o Retomar a desfazem). — DECIDIDO 11/11 |
| P3 | Mover o card para uma etapa com agente limpa a pausa temporária? | **Não** (mantém a D26 nessa parte); quem quer a IA na hora clica "Retomar IA". — DECIDIDO 11/11 |
| P4 | A IA faz follow-up quando a última fala foi da EQUIPE e a cliente sumiu? | **Sim** (contra a recomendação inicial), com a cadência do agente da etapa, ancorada na fala da equipe (4.11). — DECIDIDO 11/11 |
| P5 | Como fica com o horário do agente? | **Os N min correm no relógio**; vencidos fora do horário, o turno espera a abertura (a regra de 25/10) e só responde se ninguém da equipe respondeu no meio-tempo. O follow-up já respeita o horário. — DECIDIDO 11/11 |
| P6 | Rotular as falas da equipe no contexto do modelo? | **Sim**, `[Team member]` SEM o nome da pessoa (4.7). — DECIDIDO 11/11 |
| P7 | Depois do follow-up da IA, a cliente responde: quem fala? | **A IA responde na hora**: o follow-up que sai LEVANTA a pausa (contra a recomendação de dar os N min à equipe). — DECIDIDO 11/11 |

## 4. Desenho

### 4.1 Os motivos: temporária × permanente

| Motivo | Quem grava | Tipo |
| --- | --- | --- |
| `gente` | gatilho da 1049 (resposta de gente) | **temporária** |
| `botao` | botão **Pausar** da faixa | **temporária** |
| `desativada` (NOVO) | botão **Desativar IA** da faixa | permanente |
| `transferencia` | a IA passou para a equipe | permanente (P2) |
| `automacao` | `set_ai` desligar | permanente (P2) |

- Uma lista só, em TS (`MOTIVOS_TEMPORARIOS`, `quem-responde.ts`) e no SQL
  (a função da 4.6), com pino lendo o `.sql`.
- Com N = 0 na conta, `gente` e `botao` valem como permanentes: o
  comportamento de hoje, inteiro.
- "Retomar IA" continua a ÚNICA porta das permanentes e continua zerando o
  teto (`ia_retomada_em`). Encerrar continua limpando tudo.

### 4.2 O relógio: "a cliente esperando há N min sem resposta da equipe"

- **Âncora = `greatest(conversations.aguardando_desde, ia_pausada_em)`.**
  `aguardando_desde` (972) já é "a 1ª mensagem do cliente sem resposta": a
  resposta de gente e a da IA o limpam; broadcast e robô não. O
  `ia_pausada_em` entra para o Pausar: apertado DEPOIS da mensagem da cliente,
  ele recomeça a contagem dali (quem pausou está olhando). Sem
  `aguardando_desde` (não deveria), o `gravada_em` do gatilho.
- Volta em `âncora + N`. Rajada da cliente não empurra o prazo: cada mensagem
  nova recalcula a MESMA âncora.

### 4.3 O mecanismo: turno agendado (escolhido)

A mensagem da cliente na conversa em pausa temporária ENFILEIRA o turno, com
`executar_apos` = `max(agora + 8 s, âncora + N)`. A resposta da equipe o
descarta. Na hora, tudo é conferido de novo, a pausa sai sob trava e o turno
segue o caminho de sempre.

- **Entrada** (`entrada.ts`, `quem-responde.ts`): `lerQuemAtende` passa a ler
  `ia_pausada_por`, `ia_pausada_em` e `aguardando_desde`; `quemResponde` trata
  a pausa temporária como "segue as regras" e, se o agente atende, devolve
  `{ quem: 'agente', …, esperaDaEquipe: true }`. A pausa permanente segue
  `ninguem/pausada`. A espera vai pelo `p_espera_ms` que
  `cb_ia_enfileirar_turno` JÁ aceita (sem mudar a assinatura). Espera acima de
  ~60 s não agenda `after()`: quem roda é a rede do cron (laço rápido).
- **A equipe respondeu**: o gatilho `cb_pausar_ia_por_gente` passa a
  DESCARTAR o pendente de RESPOSTA da conversa já pausada (`erro = 'a equipe
  respondeu'`). Sem isso, a faixa e a aba Turnos diriam "volta às 14:32"
  sobre uma conversa já respondida. A ordem das travas é a de hoje
  (`messages` → `conversations` → `cb_ia_turnos`, como o encerrar).
- **No turno** (`turno.ts`): a 1ª `conferir` aceita a pausa temporária;
  depois do HORÁRIO (fora dele, espera a abertura), a função nova (4.6)
  decide: equipe respondeu depois do gatilho = `descartado`; antes do prazo =
  `reagendar` para `âncora + N` com a marca `ERRO_DA_ESPERA_DA_EQUIPE` (a aba
  Turnos a traduz, como a do horário); vencido = LEVANTA a pausa, sob a trava
  da conversa e com a cerca de posse, ANTES de gerar — assim a transferência
  que o modelo pedir passa a valer (por cima de uma pausa ela não grava nada).
  A 2ª conferência é estrita: equipe que responde durante a geração pausa de
  novo (há turno vivo) e o turno termina `pausado_no_meio`, como hoje.
- **Levantar a pausa não zera o teto** (`ia_retomada_em` fica) nem toca o
  responsável; só o Retomar zera o teto. A resposta que sai arma a retomada
  (follow-ups) pelo caminho de sempre (`armarRetomada`).
- **Sem anotação no fio** quando a IA volta: a faixa troca para "IA · X
  responde" e a bolha já diz "IA · X"; o registro fica no turno.
- **Descartada — a varredura no laço rápido do cron**: repetiria
  `quemResponde` para conversas sem mensagem nova, pediria índice e teto de
  laço próprios, e não teria rajada, horário, cerca de posse, reserva nem o
  registro na aba Turnos, que o turno já tem.

### 4.4 Botões e rota

- `POST /api/ai/autoreply/[id]`: `{ paused: true }` = Pausar (`botao`,
  temporária); `{ paused: true, permanente: true }` = Desativar
  (`desativada`); `{ paused: false }` = Retomar (como hoje). O Pausar não
  rebaixa uma pausa permanente (UPDATE condicional; 409 `ja_desativada`); o
  Desativar sobrescreve a temporária. Rowcount conferido, grupo e Instagram
  recusados, responsável intocado — como hoje.
- `GET /api/cb/ia/conversa/[id]` devolve também `pausaTemporaria: boolean`,
  `voltaAposMin: number` e `voltaEm: string | null` (o `executar_apos` do
  pendente de resposta da conversa, se houver).

### 4.5 Onde mora a configuração

- **`ai_configs.ia_volta_apos_min`** na linha PADRÃO da conta (`channel_id`
  nulo), ao lado da `cotacao_dolar` (D21): `smallint NOT NULL DEFAULT 15`,
  CHECK 0–1440. Conta sem a linha = 15.
- Escrita SÓ por `PUT /api/cb/ia/pausa` (admin), na forma da `PUT
  /api/cb/ia/cotacao`: o `POST /api/ai/config` reescreve a linha e não a
  conhece (conferir que não a zera).
- Leitura que FALHA na entrada = não enfileira (a conversa fica pausada: o
  lado que não fala por cima da equipe). A próxima mensagem pergunta de novo.

### 4.6 Migration `1138_cb_ia_pausa_temporaria.sql`

Número: maior do `main` = 1135; no banco já há 1136/1137 (branch das
ligações) e 1131 (frases autorizadas). Conferir `ls supabase/migrations` E
`list_migrations` de novo logo antes do PR.

1. `ai_configs.ia_volta_apos_min` (aditiva).
2. CHECK `conversations_ia_pausada_por_check` com `desativada` (DROP pelo
   nome, ADD com nome).
3. `cb_pausar_ia_por_gente()` recriada: o corpo de hoje + o descarte do
   pendente de resposta na conversa já pausada + a PRÉ-ARMAÇÃO do follow-up
   depois da equipe (4.11). O gatilho (WHEN da 1118) não muda.
4. `cb_ia_voltar_da_pausa(p_turno_id, p_rodando_desde, p_minutos)` →
   `(resultado text, volta_em timestamptz)`: `voltou` | `cedo` |
   `equipe_respondeu` | `alguem_escreveu` (retomada) | `permanente` |
   `nao_pausada` | `encerrada` | `sem_gatilho` | `descartado` (posse
   perdida). Trava a conversa (`FOR NO KEY UPDATE`), confere o turno
   (`rodando` + `rodando_desde`), "gente depois do gatilho" pela régua do
   gatilho (`agent` com `sender_id` ou `from_device`, sem `ia_agente_id`,
   `NOT nao_saiu`, `gravada_em`). INVOKER, `REVOKE` de PUBLIC/anon/
   authenticated e `GRANT` ao `service_role`.
5. Conferência: catálogo e privilégios sempre; com dado, a função CHAMADA num
   subbloco desfeito por SQLSTATE próprio (`P1138`), na forma da 1130/1134.

ADITIVA: aplicar ANTES do deploy. O app antigo não grava `desativada` nem lê
a coluna; convive. Nenhuma tabela nova: Lixeira e união não mudam.

### 4.7 O contexto do modelo: rotular as falas da equipe

- Hoje `montarConversa` (`contexto.ts`) manda toda fala que não é da cliente
  como `assistant`, sem distinção. Com a IA voltando no meio de uma conversa
  da equipe, ela precisa saber o que a equipe já disse e combinou.
- A fala de GENTE (`agent` com `sender_id` ou `from_device`, sem
  `ia_agente_id` — a régua da 1049) vai com o prefixo **`[Team member] `**.
  A da IA, a da automação e a do robô ficam como hoje. `lerConversaDaConexao`
  passa a ler `sender_id`, `from_device` e `ia_agente_id`.
- Regra nova no TEXTO-BASE (pedaço FIXO do agente, o mesmo para turno e
  retomada): mensagens com `[Team member]` foram escritas por uma pessoa da
  equipe, não por você; não repita nem contradiga o que ela já respondeu;
  siga o que ela combinou (prazo, documento pedido, próximo passo); nunca
  comece a resposta com esse rótulo. Texto CONSTANTE: o cache erra uma vez,
  no deploy, e volta (`ia-cache-do-pedido.md`). Não é uma 13ª regra do
  sistema (as 12 ficam como estão).
- O rótulo que o modelo imitar no começo da resposta SAI antes do envio (uma
  função, no turno, na retomada e no Playground).
- `comecarNoCliente` e `terminarNoCliente` não mudam: o rótulo vive dentro do
  conteúdo, e a fusão de mensagens seguidas o preserva.

### 4.8 Tela

- **Faixa do fio** (`ai-thread-banner.tsx`):
  - atendendo: "IA · X responde nesta conversa" + **[Pausar]** +
    **[Desativar IA]** (dica do Pausar: "volta sozinha se a cliente esperar
    N min sem resposta");
  - pausada temporária: "IA pausada — alguém da equipe respondeu · volta se
    a cliente esperar 15 min sem resposta" (com pendente: "volta às 14:32 se
    ninguém responder") + [Retomar IA] + [Desativar IA];
  - permanente: "IA desativada nesta conversa" (ou o motivo) + [Retomar IA].
  - Com N = 0 na conta, a faixa é a de hoje (um botão Pausar, permanente).
- **Ajuste da conta** (`/agents`, aba Agentes, cartão acima da lista, só
  admin): "Quando a equipe responde, a IA pausa. Ela volta sozinha se a
  cliente escrever e ninguém da equipe responder em [15] min (0 = só volta
  com 'Retomar IA')."
- Textos que mudam de sentido: o aviso do `set_ai` "ligar"
  (`aiResetWarning`), os do Playground que dizem "pausada até alguém clicar
  em Retomar IA" (`efeitoEquipeDetalhe*`, `passouParaAEquipeDetalhe` — a
  transferência continua permanente, só conferir) e as paradas da retomada.
- i18n: toda chave nova em `en.json` E `pt-BR.json` na mesma passada; o
  motivo `desativada` entra na chave MONTADA `Inbox.aiBanner.motivo.<m>` (o
  teste lê os dois dicionários pela lista `MOTIVOS_DA_PAUSA`).

### 4.11 O follow-up depois da fala da EQUIPE (P4)

A equipe responde ("me manda o holerite") e a cliente some: a IA cobra com a
cadência do agente da etapa, contada da fala da equipe — a mesma série da
1056 (`tipo = 'retomada'`), só que ancorada na mensagem da equipe.

- **Quem arma é o GATILHO da pausa por gente**, a única porta por onde passa
  toda fala de gente (CRM, celular, agendada): espalhar o "armar" pelos
  caminhos de envio deixaria um de fora sem erro nenhum. O SQL não escolhe
  card nem agente (essa régua é `lerCardEAgente`, no TS): ele grava uma
  linha de PRÉ-ARMAÇÃO na fila — `tipo = 'retomada'`, âncora = a mensagem da
  equipe, conexão = a dela, agente/card/etapa nulos, a marca
  `ERRO_DA_ARMACAO_PELA_EQUIPE`, `executar_apos` = agora + 30 s — sobre o
  pendente da conversa e conexão (`ON CONFLICT … DO UPDATE`: a fala seguinte
  da equipe só move a âncora; a retomada da IA que estava lá vira esta).
- Só pré-arma quando vale a pena: N > 0 na conta, conversa 1:1 aberta, pausa
  `gente` (a deste gatilho), mensagem que a cliente lê (não a ligação
  atendida no celular) e um card ABERTO numa etapa cujo agente está ligado,
  com a conexão da mensagem e a retomada ligada (filtro barato; a escolha
  certa fica no TS).
- **No TS** (`conduzirRetomada`, ao ver a marca): `lerQuemAtende` +
  `quemResponde` com a conexão da linha, a retomada do agente ligada, a
  primeira tentativa por `proximaRetomada` com a âncora = o `gravada_em` da
  fala da equipe (janela ∩ horário do agente, lembretes e reunião, como
  hoje) → a linha ganha agente, card, etapa, `tentativa = 1`, `tentativas` =
  a cadência, e o `executar_apos` certo. Nada aplicável = `descartado`.
- **Ao rodar**, é a retomada de sempre: para se a cliente escrever (o
  enfileirar já a descarta), se a equipe escrever de novo (o gatilho troca a
  âncora), se o robô ou outra automação falar, perto da reunião, janela da
  Meta fechada, cadência no fim. A seção da retomada no pedido (pedaço
  VARIÁVEL) ganha a variante "a cliente não respondeu à última mensagem da
  EQUIPE" — a conversa ao modelo termina na fala da equipe, rotulada
  `[Team member]` (4.7), e a nota de usuário de sempre (`comNotaDaRetomada`)
  fecha.
- **O follow-up LEVANTA a pausa** (P7): a cliente que responde a ele é
  respondida pela IA na hora. É a MESMA função do retorno
  (`cb_ia_voltar_da_pausa`), logo antes da reserva, com a régua da
  retomada: só a pausa `gente`, N > 0 na conta, ninguém escreveu depois da
  âncora. A reserva NÃO muda (a pausa já saiu quando ela roda). O Pausar
  (`botao`), o Desativar, a transferência e a automação continuam parando a
  série (`pausada`). `conferirRetomada` deixa a pausa `gente` passar, como o
  `conferir` do retorno.
- Limite aceito: pausa levantada e envio recusado = a conversa fica sem pausa
  sem o follow-up ter saído; a próxima mensagem da cliente é respondida pela
  IA na hora (a equipe já estava em silêncio desde a âncora).

### 4.9 Testes

- `quem-responde`: temporária segue as regras e marca a espera; permanente e
  N = 0 param; transferência permanece.
- `entrada`: espera = `âncora + N`; rajada não empurra; sem `after()` acima
  de 60 s; leitura da configuração que falha não enfileira.
- `turno`: cedo reagenda com a marca; equipe depois do gatilho descarta;
  vencido levanta antes da reserva; levantar sem posse abandona.
- `contexto`: rótulo só na fala de gente; IA, automação e robô sem rótulo.
- follow-up da equipe: a pré-armação vira a 1ª tentativa com a âncora da
  equipe; nada aplicável descarta; passa pela pausa `gente`, não pela
  `botao`; a cliente que escreve descarta; a fala seguinte da equipe move a
  âncora.
- `pedido.partes`: o pedaço fixo não muda com a conversa.
- Rota da faixa, rota do Pausar/Desativar, rota da configuração; faixa
  renderizada nos três estados.
- Migration: pino lendo o `.sql` (motivos temporários iguais ao TS; o gatilho
  descarta só com a conversa já pausada) e o replay do CI.

### 4.10 Documentação no mesmo PR

`docs/DECISOES-DO-OPERADOR.md` (a linha abaixo), `.claude/rules/ia.md`
(PAUSA D26), `ia-retomada.md`, `ia-agentes.md` (contexto),
`docs/PLANO-agentes-de-ia.md` (D26 revista), `docs/MERGE-UPSTREAM.md` (as
linhas da faixa e da rota do autoreply) e `docs/MIGRATIONS-APLICADAS.md`
quando aplicada. Contrato de integração (API v1, webhooks, MCP): não muda.

Linha proposta para as decisões (a confirmar):

> - Pausa da IA (11/11/2026, revisa a D26): "Pausar" e a pausa por gente são
>   TEMPORÁRIAS — a IA volta sozinha quando a cliente escreve e ninguém da
>   equipe responde em N min (da conta, padrão 15; 0 = como antes);
>   "Desativar IA", a transferência pedida pela IA e a automação seguem até
>   "Retomar IA"; mover o card não retoma; a IA também faz follow-up da fala
>   da EQUIPE, com a cadência do agente, e o follow-up que sai devolve a
>   conversa à IA; os N min contam no relógio (fora do horário, espera a
>   abertura); as falas da equipe chegam ao modelo rotuladas, sem o nome;
>   vale para a conta inteira, todo agente (`ia.md`, `ia-retomada.md`).

## 5. Consequência na transição

As 23 conversas pausadas por `gente` (medido em 11/11/2026) viram pausas
temporárias. Com os agentes desligados, nada acontece; ao ligar um agente, a
cliente que escrever numa delas e ficar N min sem resposta da equipe será
respondida pela IA. É o comportamento novo; se o operador preferir, a
migration converte as antigas em `desativada` (uma linha a mais).

## 6. Limites aceitos (a escrever na regra)

- O "Pausar" apertado durante a espera recomeça a contagem dali; a resposta
  de gente em OUTRA conexão da mesma conversa também conta como resposta
  (`aguardando_desde` é por conversa).
- A mensagem da cliente que não abre turno (figurinha, localização) não faz a
  IA voltar.

## 7. Provas (11/11/2026)

- Testes: os do motor (entrada, turno, retomada, contexto, pedido, ações,
  pausa), das rotas e da faixa; pino `pausa-temporaria-1138.test.ts`; a
  suíte inteira verde.
- Replay completo local (`pg-replay`, banco vazio até a 1138, como o CI):
  aplica; `verify-schema.sql` OK.
- Cenários locais com dado FICTÍCIO (`cenarios-1138`, fora do repositório):
  a conferência da própria 1138 COM dado (gatilho, pré-armação, âncora
  movida, follow-up levantando, `cedo`, N = 0, `equipe_respondeu`,
  `desativada`, descarte do retorno, `botao` → `gente`); o compositor sob
  RLS pausa e pré-arma; a ligação não pré-arma; os CHECKs; o service_role
  chama a função pelos tipos do PostgREST.

## 8. Ordem de entrega

1. Decisões P1–P6 (esta seção 3).
2. Migration + pinos; replay local (`~/Downloads/CB-CRM/ferramentas/pg-replay`).
3. Motor (entrada, turno, contexto, pedido) com testes.
4. Rotas e tela, i18n.
5. Regras e docs; `typecheck`, `lint`, `test`.
6. PR pronto → CI verde → Codex sem achado.
7. Aplicar a 1138 e mesclar SÓ com o "pode" do operador (merge no `main`
   publica em produção).
