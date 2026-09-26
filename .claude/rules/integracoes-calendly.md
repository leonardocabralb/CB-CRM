---
paths:
  - "src/lib/calendly/**"
  - "src/app/api/cb/calendly/**"
  - "src/components/settings/calendly-card.tsx"
  - "src/components/automations/calendly-trigger-config.tsx"
  - "src/lib/automations/lembretes*"
  - "src/lib/automations/varrer-lembretes*"
  - "src/lib/automations/destinatario*"
---

# Calendly — regras

Vale ao mexer na integração com o Calendly (webhook, cadeado, cancelamento,
cartão em Integrações), no gatilho `calendly_booking`, nos lembretes por data
(`lembretes.ts`, `varrer-lembretes.ts`) e em `resolverDestinatario`. O motor,
`send_to_number`, `interpolate` e `dispararAutomacoes` estão em
`.claude/rules/automacoes.md`; o nome fixado nas telas, em
`.claude/rules/campos-e-nome.md`. Plano vivo:
`docs/PLANO-integracao-calendly.md`.

### Calendly → automação (977)

`src/lib/calendly/` (`payload`, `assinatura`, `variaveis`, `cartao`, `cliente`,
`cancelamento` puros e testados; `conexao` e `processar` com I/O), rotas em
`/api/cb/calendly/`, cartão `calendly-card.tsx`. O Calendly avisa por webhook;
o motor faz o resto.

### O webhook e a assinatura

- ⚠️ **A assinatura é conferida sobre o corpo CRU** (`request.text()`):
  `Calendly-Webhook-Signature: t=…,v1=…` = HMAC-SHA256 de `t.corpo` com a
  chave que NÓS informamos ao assinar (cifrada em `signing_key`), tolerância
  de 5 min. O token da URL só diz de QUAL conta é; quem protege é o HMAC.
- ⚠️ **Idempotência é o UNIQUE `(account_id, evento, invitee_uri)` com
  `ignoreDuplicates`**: o Calendly reenvia por 24 h sem 2xx, e a segunda cópia
  não pode disparar de novo. A rota responde 200 ANTES de processar
  (`after()`): o Calendly espera 15 s.
- ⚠️ **Evento que não é `invitee.created` nem `invitee.canceled` responde 200
  e não grava**: 4xx faria o Calendly retentar por 24 h e DESATIVAR a
  assinatura inteira.
- **Reagendamento chega como `invitee.created` NOVO** (a URI do convidado
  muda), com `agendamento_situacao = "Reagendamento"` — e o antigo chega
  como cancelamento (ver abaixo).
- ⚠️⚠️ **A lista de eventos é FIXADA NA CRIAÇÃO da assinatura**
  (`EVENTOS_ASSINADOS`): conta conectada antes da 1013 só recebe
  `invitee.created` até alguém apertar **Reassinar**, e o sintoma é ausência.
  `conferirAssinatura` compara os eventos vivos com a lista e grava
  `status='erro'` + `last_error='assinatura_incompleta'` (e só limpa esse
  código).
- ⚠️ **`webhook_state` é conferido AO VIVO a cada carga do cartão**
  (`GET /webhook_subscriptions/{uuid}`): o Calendly desativa a assinatura
  depois de 24 h de falhas e não avisa. 404 = `disabled` (só reassinar
  resolve); 401 = token inválido; rede/limite = fica o que está. Toda entrega
  que chega grava `active`.
- **A assinatura tenta `organization` e cai para `user` (403).** Token bom +
  webhook recusado grava `status='erro'` com o motivo (quase sempre plano sem
  webhooks) e o cartão oferece "Reassinar". URL não alcançável de fora é
  recusada (`ehUrlAlcancavel`): dev local assinando `localhost` no Calendly da
  produção mataria a entrega.
- ⚠️ **Código de erro novo entra em `CODIGOS_CONHECIDOS` (`calendly-card.tsx`)**,
  senão cai no genérico "erro do Calendly". Há pino estrutural.

### A ficha nasce do agendamento

Decisão do operador (08/09/2026): telefone sem contato não é mais
`sem_contato` — `processarAgendamento` cria a ficha por `resolverDestinatario`
(dono DURÁVEL da conta) e segue.

- ⚠️ **A consulta de automações vem ANTES da criação**: ninguém escutando =
  `sem_automacao`, sem criar nada. Invertido, conta sem integração configurada
  ganha lead que ninguém pediu.
- ⚠️ **Falha ao criar vira `sem_contato`, não `falhou`**: nada rodou, repetir é
  seguro, e é o que "Processar de novo" aceita.
- ⚠️ **A conversa nasce com `channel_id` NULO** e `channelInScope` deixa passar
  canal nulo: automação restrita a uma conexão ainda dispara para lead novo.
  Apertar essa regra desliga o Calendly para lead novo.
- ⚠️ **A conversa nasce ABERTA.** `conversaNovaEncerrada` de
  `resolverDestinatario` é só do webhook de entrada: aqui e no
  `send_to_number` a conversa escondida sumiria, e envio de robô não reabre.
- ⚠️⚠️ **A ficha que JÁ existia SEM conversa também ganha a conversa aqui**
  (`conversaDoContato`, `destinatario.ts`). A integração do formulário cria a
  ficha pela API minutos antes do agendamento, e ficha da API não tem
  conversa: sem isto o `{{conversation.link}}` do aviso sai vazio e os
  lembretes (que exigem conversa) falham. Falhar ao criar NÃO segura o aviso:
  o motivo vai para o detalhe do evento.
- ⚠️⚠️ **Lead novo não tem card, e `move_deal_stage` LANÇA nesse caso.** A
  automação do Calendly precisa de `create_deal` ANTES (ele desiste em
  silêncio quando já há card), e o aviso ao advogado vem ANTES do
  `move_deal_stage`: o aviso não pode depender do card.

### O telefone

- ⚠️⚠️ **O Calendly NÃO tem campo de telefone.** Três fontes, nesta ordem
  (`telefoneDoAgendamento`): `text_reminder_number` (SMS, com DDI) → a
  pergunta cujo rótulo o operador escreveu no cartão → heurística (rótulo de
  telefone/WhatsApp, senão a primeira resposta com cara de telefone). A origem
  fica em `telefone_origem`, que a tela mostra quando não há contato.
- ⚠️ **CPF tem 11 dígitos, como celular sem DDI**: a heurística EXCLUI rótulo
  de documento (`cpf|cnpj|rg|cep|valor|processo…`) e resposta com pontuação de
  CPF/CNPJ. A pergunta configurada VENCE a exclusão.
- ⚠️ **`digitosDoTelefone`: sem `+`, 10 dígitos ou 11 COM 9 na 3ª posição
  ganham o 55**; com `+`, entram como vieram. O "9 na 3ª posição" separa o
  celular brasileiro do número dos EUA só com dígitos (lá o 2º dígito do
  código de área nunca é 9); um fixo búlgaro ainda colide, e a dica do editor
  manda escrever número de fora com `+`. O passo `send_to_number` usa outra
  régua (`telefoneDigitado`, ver `automacoes.md`).

### O cadeado do processamento (980)

- ⚠️⚠️ **Processar passa pelo CADEADO `cb_calendly_eventos.processando_desde`
  (`UPDATE…RETURNING`), nunca por "ler o estado e então processar".** No
  deploy `start-first` há dois processos Node vivos; só o banco serializa.
  Sem ele, dois cliques ou um clique durante o `after()` davam dois avisos ao
  advogado. Guarda por IDADE da linha não serializa nada. O webhook carimba o
  cadeado JUNTO com a linha, antes do `after()`.
- ⚠️ **Toda saída solta o cadeado**: `gravarResultado` o zera na mesma escrita;
  exceção na rota grava `falhou` (não reprocessável — pode ter enviado). Claim
  mais velho que `RECOLHER_CLAIM_MS` (10 min) é tomado.
- ⚠️⚠️ **Recolher por idade só é seguro com as DUAS peças**: (1) CERCA DE
  POSSE — `gravarResultado` e `liberarClaim` filtram pelo `processando_desde`
  do PRÓPRIO claim (`{ gravou: false }` é a cerca agindo, não erro); sem ela o
  dono recolhido sobrescrevia o resultado e soltava o cadeado do outro.
  (2) `TETO_DE_PROCESSAMENTO_MS` (4 min) MENOR que o recolhimento, com teste
  cobrando a margem: sem teto, "10 min sem notícias" não prova que o dono
  morreu. Passou do teto grava `falhou` e sai; a promessa em voo não se
  aborta, e os efeitos dela (mensagem, data na ficha) seguem.
- **O gêmeo é `src/lib/webhooks-de-entrada/claim.ts`**, de propósito não
  fatorado: mudou um, confere o outro.

### Processar de novo e o resultado

- ⚠️ **"Processar de novo" só aceita `RESULTADOS_REPROCESSAVEIS`** (`recebido`,
  `sem_contato`, `sem_automacao`): repetir `disparado` avisaria a equipe de
  novo, e em `falhou` não se sabe se o envio já rodou (aí o caminho é o
  "Executar automação" da conversa).
- ⚠️ **Reprocessar usa as VARIÁVEIS gravadas** (`cb_calendly_eventos.variaveis`,
  979), nunca só o remonte: a tabela não guarda local, cancelar, remarcar e
  situação em coluna.
- ⚠️⚠️ **Agendamento CANCELADO não se reprocessa**: repetir roda a automação
  inteira (aviso, card para "Reunião Agendada", data gravada) por um horário
  que não vai acontecer. A rota consulta `houveCancelamento` e falha FECHADA:
  recusar é reversível, disparar não.
- ⚠️ **O evento só grava `disparado` quando alguma automação rodou ATÉ O FIM
  sem falha.** Escopo barrando tudo = `sem_automacao` com o motivo; passo que
  falhou = `falhou`; parada num "Aguardar" = `em_espera` (978) — falha vence
  espera. `em_espera` é TERMINAL para a linha do evento: o agendador retoma e
  escreve só em `automation_logs`, e o `detalhe` diz isso.
- ⚠️ **`agendamento_data` sai de `formatToParts`, nunca de `toLocaleString`**
  (a forma muda entre majors do Node). `agendamento_inicio` é o ISO UTC cru,
  que é o que o campo `datetime` guarda. Fuso: `FUSO_DO_ESCRITORIO`
  (`America/Sao_Paulo`).

### O nome do agendamento fixa a ficha e o card

Decisão do operador (14/09/2026): o nome do AGENDAMENTO vira o nome da ficha e
o título do negócio aberto, FIXADO (999). O motivo é identidade: o cliente fala
pelo celular da empresa, e quem vai à reunião é a pessoa. Falha nunca segura o
aviso ao advogado; vira aviso no `detalhe` do evento.

- ⚠️⚠️ **A FICHA antes da primeira automação, o CARD depois** (`processar.ts`).
  A ficha é renomeada pelo gancho `antesDeExecutar` de `dispararAutomacoes`
  (depois dos recortes): fixar antes do disparo renomeava e travava a ficha de
  quem o escopo excluía. O card NÃO: contato sem card só o ganha dentro da
  automação (`create_deal`), então é renomeado depois. Card criado depois de
  um "Aguardar" fica fora do alcance.
- ⚠️ **Só o negócio ABERTO mais recente é renomeado** (a régua de
  `negocioAlvo`): no celular da empresa, o card fechado antigo pode ser de
  outra pessoa, e um aberto de outro funil perderia o título escrito à mão.
  Mexer só no `title` não dispara trilha nem fila do funil.
- ⚠️ **O Calendly VENCE o título escrito à mão** (`renomearCardAberto` não olha
  `titulo_fixado_em`; decisão do operador, 19/09/2026). "Consertar" isso
  reverte a decisão.
- **Número não é nome** (`nomeParaFixar`, `src/lib/contacts/nome-fixado.ts`):
  fixar "5583…" tiraria o nome de verdade para sempre.
- **A marca protege contra os caminhos AUTOMÁTICOS** (a guarda
  `.is('nome_fixado_em', null)` da ingestão). Pino com todo escritor de
  `contacts.name`: `src/lib/contacts/nome-fixado.chamadores.test.ts`.
- **Consequência aceita**: duas pessoas que agendam pelo MESMO telefone trocam
  o nome da ficha a cada agendamento.

### Reunião cancelada desarma os lembretes (1013)

`src/lib/calendly/cancelamento.ts` e o caminho próprio na rota do webhook. Sem
isto, a data ficava na ficha e os quatro lembretes saíam com o link de um
evento cancelado.

- ⚠️⚠️ **O desarme NÃO apaga a data da ficha: ele PRÉ-ARMA a trava da 935**
  (`cb_automation_reminders`, por automação + contato + VALOR, com o valor por
  `chaveDaTrava` como a varredura — ver abaixo) com
  `motivo: 'cancelamento'`. Apagar destruiria informação e exigiria adivinhar
  o campo; a trava pelo valor deixa o reagendamento re-armar sozinho. Sem a
  coluna `motivo`, `disparado_em` afirmaria envio que não houve.
- ⚠️⚠️ **REAGENDAR TAMBÉM CANCELA, e a ordem das entregas não é garantida.**
  `mesmaReuniao` só desarma o lembrete cujo valor GRAVADO NA FICHA ainda é o
  instante da reunião cancelada; se o horário novo já foi escrito, nada casa.
  Não existe porta própria para reagendamento: desistir deixava o horário
  antigo destravado. Reagendar para o MESMO horário trava o novo junto
  (aceito).
- ⚠️⚠️ **A VARREDURA pergunta ao EVENTO do cancelamento (`semOsCancelados`),
  nunca à trava por automação**: a trava é CASCADE em `automations`, e apagar
  o lembrete apagaria a prova. O evento é da conta, não é podado e cobre a
  conta que ainda não tinha lembrete. Falha FECHADA (não conferiu = fica para
  o ciclo seguinte). A trava pré-armada continua sendo escrita: resolve a
  corrida com o INSERT da varredura.
- ⚠️ **Compare por INSTANTE, nunca por texto**: o campo guarda
  "…T17:00:00.000000Z" e o PostgREST devolve "… 17:00:00+00".
- ⚠️⚠️ **A espera pelo agendamento em processamento é DERIVADA de
  `TETO_DE_PROCESSAMENTO_MS`, nunca digitada.** Desistir aqui é definitivo (a
  reentrega do Calendly não tenta de novo). `TETO_DO_CANCELAMENTO_MS` é maior
  que a espera e menor que `RECOLHER_CLAIM_MS`, com teste cobrando as duas
  margens.
- **Lembretes DESLIGADOS também são desarmados**: ligados antes da reunião,
  mandariam o aviso do evento cancelado.
- **O cancelamento não cria ficha, não dispara automação e não move o card.**
  Tirar o card de "Reunião Agendada" é decisão de produto pendente.
- ⚠️⚠️ **Cancelamento FORA DE ORDEM (revisão do PR #235, 25/09/2026)**:
  `processarAgendamento` pergunta primeiro se há `invitee.canceled` gravado
  para o mesmo convite (`houveCancelamento`) e, havendo, termina `ignorado`
  sem buscar contato, criar ficha nem disparar nada. Leitura que falha SEGUE
  (falha aberta, ao contrário do "Processar de novo"): recusar calaria o aviso
  ao advogado de um agendamento de verdade por um soluço do banco.
- ⚠️⚠️ **O contato vai para a linha do agendamento ASSIM QUE é resolvido**
  (`gravarContatoCedo`, antes do disparo; guarda `contact_id IS NULL`, sem a
  cerca do cadeado, que depois do teto já é nula), e `gravarResultado` não
  apaga contato com resultado sem contato (teto, erro). É o que o
  cancelamento que chega DURANTE um processamento lento lê — sem isso,
  passado o teto de 4 min a linha ficava `falhou` com contato NULO e a
  varredura não tinha por onde casar. As duas rotas passam `{ eventoId }`
  (pino em `processar.cancelamento.test.ts`). ⚠️ Por isso achar o contato NÃO
  encerra a espera do cancelamento: ele relê até o processamento TERMINAR
  (a automação ainda vai gravar a data), senão desarmava "nada" e ficava sem
  a trava; esgotado o teto com o contato já na linha, segue COM ele (o evento
  de cancelamento com contato é o que a varredura usa).
- ⚠️ **Conhecido, não tratado**: cancelamento que FALHOU (erro) antes de achar
  o contato, e a leitura que falha na pergunta acima com a reunião de fato já
  cancelada, deixam a linha do cancelamento sem contato — a automação roda e
  a varredura não casa. Fechar de vez é a varredura ligar o cancelamento ao
  contato pelo `invitee_uri` (mexe no motor de lembretes, que falha fechado).

### A trava do lembrete: chave pelo INSTANTE, devolvida quando o recorte barra

- ⚠️⚠️ **A chave da trava é o INSTANTE (`chaveDaTrava`, em `cancelamento.ts`:
  `instanteCanonico` do valor, ou o texto como veio quando não há fuso
  escrito), nunca o texto, nos DOIS escritores** — a varredura e o
  cancelamento pré-armado. Medido em produção: o campo da reunião é gravado
  pela automação do Calendly ("…17:30:00.000000Z") e, ~1 s depois, pela
  iMotion pela API v1 ("…17:30:00.000Z"). O UNIQUE é por TEXTO: o ciclo que
  lia entre as duas escritas travava a 1ª forma, o seguinte lia a 2ª e o
  lembrete saía DUAS vezes. Pino default-deny dos escritores:
  `src/lib/automations/trava-do-lembrete.chamadores.test.ts`.
- ⚠️ **Antes do INSERT, a varredura LÊ as travas da automação para os
  contatos da janela e compara pelo instante** (as duas pontas por
  `chaveDaTrava`). É o que faz a trava gravada PELO TEXTO — a da versão
  anterior, ou a da instância antiga viva durante o deploy `start-first` —
  continuar barrando o lembrete (Codex, PR #305). Sem migração: o UNIQUE
  segue de texto, e o INSERT canônico continua sendo a reivindicação entre
  ciclos desta versão. Estreita, em fatias de contato, e leitura incompleta é
  falha FECHADA (a automação fica para o ciclo seguinte).
- ⚠️⚠️ **A trava da 935 é gravada ANTES do disparo (o INSERT é a
  reivindicação), mas o disparo ainda passa por conexão, gatilho e escopo de
  etapa.** Recusado ali, o lembrete nunca mais saía. `travaDeveSerDevolvida`
  (`lembretes.ts`): devolve só com `!erro && executadas === 0`. Com `erro`
  (catch do dispatch, que pode ter estourado depois de um envio) a trava
  FICA: lembrete perdido é ruim, em dobro é pior.
- ⚠️ **A devolução é pelo `id` da linha inserida, nunca pela chave**: pela
  chave alcançaria uma trava pré-armada por cancelamento.
- A varredura usa `dispararAutomacoes` (devolve o resultado), nunca
  `runAutomationsForTrigger` (`void`).

### O campo da reunião é do Calendly
- ⚠️ **"Data e Hora Reunião" é o campo que os lembretes leem, e DOIS
  escritores gravam nele no agendamento**: a automação do Calendly
  (`update_contact_field`) e a iMotion pela API v1 (`custom_fields:write`),
  com ~1 s de diferença e em formatos diferentes do mesmo instante — daí a
  chave da trava pelo instante (acima). Carga ou importação de reunião ANTIGA
  nunca grava ali: sobrescreveria um agendamento real e dispararia lembrete
  sobre reunião passada. As reuniões da Kommo moram numa tabela própria e
  fechada (1036).

### O gatilho e a grade

- **O gatilho compara `event_type_uri`** (config vazia = qualquer evento;
  disparo sem URI com config preenchida falha fechado). `event_type_nome` vai
  junto para a automação continuar legível sem a API; o select vem de
  `GET /api/cb/calendly/event-types`.
- **Na grade do funil ela aparece como cartão de CHEGADA** sob a etapa de
  destino do `move_deal_stage`/`create_deal` (`cartoesDeChegada`).
