---
paths:
  - "src/lib/ia-agentes/turno*"
  - "src/lib/ia-agentes/acoes*"
  - "src/lib/ia-agentes/horario*"
  - "src/lib/ia-agentes/pedido*"
  - "src/lib/ia-agentes/retomada-resposta*"
  - "src/lib/ia-agentes/textos-do-servidor*"
  - "src/components/agentes-de-ia/turnos-do-agente.tsx"
  - "src/components/agentes-de-ia/playground-do-agente.tsx"
  - "supabase/migrations/1109_cb_encerrar_nao_apaga_turno_que_ja_respondeu.sql"
  - "src/lib/ia-agentes/aviso-da-transferencia*"
  - "src/hooks/use-aviso-da-ia-na-tela*"
  - "supabase/migrations/1139_cb_aviso_da_ia_que_passa.sql"
  - "src/lib/ia-agentes/alarme-da-ia*"
  - "supabase/migrations/1140_cb_alarme_da_ia.sql"
---

# Turno do agente: ação prometida, passagem com ações, horário, encerrar

Validação de 25/10/2026 (`docs/PLANO-agentes-de-ia.md`). O geral do turno e
das ações está em `ia.md` e `ia-agentes.md`.

### Ação PROMETIDA sem a ação = RETIDA e transfere

- ⚠️⚠️ Medido: "Criar tarefa" desligada e "Criei o lembrete…" — nada criado.
  `acaoPrometida` (`acoes.ts`): verbo na 1ª pessoa do passado + o objeto
  ("criei o lembrete", "registrei suas informações", "etiquetei", "movi seu
  card", "encerrei o atendimento"), particípio com auxiliar ("o lembrete foi
  criado") ou no começo da frase ("Tarefa criada ✅"); em inglês só com
  "I/we". As guardas das outras travas valem (negação, futuro, oferta,
  condição, pergunta), e a negação DENTRO da forma. ⚠️ O trecho entre o verbo
  e o objeto NÃO atravessa outra oração (`ABRE_OUTRA_ORACAO`: "e", "que",
  "vou"…): "anotei tudo e vou passar as informações" era retido (revisão).
  "Conversa" não é objeto do encerramento ("fechamos aqui a conversa" é
  despedida). A reunião entra só na 1ª pessoa ("agendei sua reunião"): "sua
  reunião está marcada" pode ser verdade (o cliente agendou pelo link).
- **Cumpre a ação ACEITA do tipo** (tarefa → `criar_tarefa`; campo/dados/
  anotação → `preencher_campo`; etiqueta → `etiquetar`/`tirar_etiqueta`;
  card/etapa → `mover_etapa`); `executar_automacao` e `marcar_reuniao`
  cumprem QUALQUER uma. Repetir o que uma resposta ANTERIOR do escritório já
  disse não é novo — mas só quando a frase se APRESENTA como repetição ("já"
  nas três palavras antes, "como eu disse"): sem isso, o lembrete NOVO passava
  porque um antigo foi criado. "Anotado!" sem objeto não afirma nada.
  "etapa" só conta como a do FUNIL (verbo no singular, nunca "próxima/nesta
  etapa": é palavra do roteiro).
- Vem DEPOIS da reunião prometida e vence o `[[TRANSFERIR]]`. Código
  `acao_prometida` (`MOTIVOS_DE_TRANSFERENCIA`), texto no `erro` do turno
  ("ação prometida sem fazer (<tipo>): …"); o Playground avisa.
- **Na RETOMADA nada executa**: toda afirmação de ação PARA a série
  (`lerRespostaDaRetomada`, parada `acao_prometida`), com as respostas
  anteriores do escritório como no turno.
- **Limites aceitos**: "anotei suas informações" num agente SEM "Preencher
  campo" é retido (se medir muita retenção, restringir o registro a agentes
  com o campo); ação aceita que FALHA na execução não é coberta (a resposta
  já saiu).
- **O pedido diz SEMPRE** que só o marcador muda o sistema e que o que não dá
  para fazer vai para a equipe com `[[TRANSFERIR]]` (trecho em
  `TRECHOS_DO_PEDIDO`). A defesa da TELA é o aviso instruções × ferramentas
  (`ia-tela-do-agente.md`).

### A PASSAGEM roda campo, etiqueta e tarefa ANTES de mover

- ⚠️⚠️ Medido: a qualificação passava sem gravar o campo. Com a passagem
  VÁLIDA, `ACOES_COM_A_PASSAGEM` (campo, etiqueta, tirar etiqueta, tarefa)
  rodam antes de o card ir para a etapa do destino, com a reserva (o `teto`
  não segura: a passagem não fala com o cliente) e a posse. Mover, automação e
  reunião ficam `passagem` (a passagem já move o card). Passagem inválida
  (transfere) = nenhuma ação. O pedido manda pôr esses marcadores depois do
  `[[PASSAR:n]]` (não diz mais "e nada mais").
- **Limite aceito**: a etiqueta dispara as automações de `tag_added` na hora —
  se uma MOVER o card, o UPDATE da passagem não casa e ela transfere; se uma
  FALAR, o destino se cala nesta mensagem (E4); se uma ENCERRAR a conversa, a
  1109 descarta o turno (a passagem não tem `mensagem_enviada_id`) e as ações
  feitas somem do registro do turno (as anotações delas ficam).

### A fala ADIADA do funil: o turno espera o dreno e confere (14/11/2026)

- ⚠️⚠️ Medido no Trabalhista (13/11/2026): a automação de "nova mensagem"
  moveu o card de "Não Respondeu" para a etapa do agente, cuja saudação
  (`deal_stage_changed`) só tira a etiqueta de quem volta — e a entrada, que
  contava o "Mover" como fala (E4), não abriu turno: ninguém respondeu. O
  "Mover card", o "Criar negócio" e o card novo do roteador NÃO são mais
  `falou` (motor e ingestões não perguntam `etapaTemQuemFale`); o turno nasce
  e `esperaPeloFunil` (no `conferir`, antes de gerar e de enviar) decide,
  dentro de `JANELA_DO_AUDIO_MS` do gatilho:
  - evento do contato NÃO drenado em etapa com quem escute → reagenda;
  - drenado ou criado DEPOIS do gatilho em etapa com quem escute → as
    execuções do contato nascidas depois do gatilho e vivas
    (`automation_logs` sem `finalizado_em` nem `interrompida_em`, índice da
    1005): parada na fila além de `ESPERA_CURTA_DO_FUNIL_MS` (60 s do
    gatilho) numa automação que FALA (`PASSOS_QUE_CALAM_O_AGENTE` do motor,
    em qualquer ramo; sem automação, conta como fala) = descarta
    (`ERRO_DO_FUNIL_QUE_ESPERA`: o "Aguardar" longo e a retentativa falam
    depois); a parada SÓ em espera longa de quem não fala conta como
    terminada (o "15 dias sem conversa" do Trabalhista só mexe em etiqueta,
    conversa e card, e calava a IA para quem volta da Recuperação — revisão
    do PR #520); rodando ou espera curta = reagenda; envio
    `incerto` do robô na conexão = descarta (`ERRO_DO_FUNIL_INCERTO`, a
    régua do motor); senão responde. A que JÁ falou é a saída do robô
    (`haSaidaDoRoboDepois`, antes) e a reserva.
- ⚠️ **Por que o dreno basta agora** (a passagem diz que não bastava, Codex
  #309): o registro da execução nasce logo depois de o evento ser
  reivindicado e fica vivo até ela terminar, parada inclusive. Sobra o vão
  reivindicação → registro (milissegundos): a 2ª conferência, depois da
  geração, e a reserva o cobrem; só um banco travado por segundos ali passa.
- ⚠️ `processado_em` é do relógio do APP (o dreno); `criado_em` e
  `gravada_em`, do banco: o `.or()` usa os dois, com o ISO do JS (o do
  PostgREST traz `+00:00`, e o `+` não vai cru no filtro).
- **O turno da passagem** só espera o não drenado: a triagem já conferiu o
  funil desta mensagem, e o que nasceu depois são as ações dela (o limite
  acima). A passagem em si mantém a E4 antiga (`ia.md`).
- **Limites aceitos**: fora da janela (dreno parado, execução morta) o turno
  responde, e a ouvinte que acordar depois fala também; execução de OUTRA
  origem nascida depois do gatilho (equipe etiquetou, Calendly) também
  segura — o lado de calar. A régua de fala é da AUTOMAÇÃO, não do que falta
  rodar: com um ramo que fala, a espera longa num ramo que não fala também
  cala (o lado de calar). E o áudio da EQUIPE ainda transcrevendo segura o
  turno até sobrarem `RESERVA_DA_GERACAO_MS` (30 s) para gerar, abaixo do
  teto de 45 s: medido no Sonnet do Trabalhista (86 turnos, 7 dias), p95 de
  12,8 s e máximo de 17,7 s o turno inteiro — com um modelo mais lento, o
  estouro tenta uma vez mais (revisão do PR #520).

### FORA DO HORÁRIO o turno ESPERA a abertura

- ⚠️⚠️ Antes terminava `fora_do_horario` e a mensagem da noite nunca era
  respondida (decisão do operador, 25/10/2026). Volta a `aguardando` com
  `executar_apos` = `proximaAbertura` (o cálculo de `dentroDaJanela`, no fuso
  do escritório) e `erro` = `ERRO_DA_ESPERA_DO_HORARIO`, sem `after()` (a rede
  é o cron). Na hora, TUDO é conferido de novo (pausa por gente, card,
  mensagem mais nova, D27). A mensagem nova empurra o pendente (rajada de 8 s)
  e ele volta a esperar a mesma abertura — sem laço.
- ⚠️ **Conexão OFICIAL**: se a janela de 24 h da Meta fecha antes da abertura
  (+ `FOLGA_NA_JANELA_META_MS`), termina `fora_do_horario` como antes — sábado
  de manhã só seria respondido na segunda, com texto livre recusado.
- ⚠️ No turno que esperou, a janela do áudio, a da leitura e o
  `TETO_DA_ESPERA_DAS_MIDIAS_MS` contam da abertura de hoje (`aberturaDeHoje`):
  contados da madrugada, a foto nunca seria lida.
- ⚠️ O teto da conta por minuto (`aiAutoReplyAccount`, 30) DEVOLVE à fila o
  turno cujo gatilho é anterior à abertura, em vez de `sem_resposta`: a fila
  da noite vence toda junta e o cron roda até 40 por minuto.
- A aba Turnos mostra "Aguardando · aguardando o horário do agente · abre
  <quando>" (reconhece o `erro`; nunca cru). `fora_do_horario` só sobra nos
  registros antigos. `horario.ts` pega o fuso de `campo-data` (não de
  `pedido.ts`, que levaria o pedido ao navegador); teste amarra as duas.

### Falha PASSAGEIRA do provedor tenta UMA vez mais

- Prazo, limite de taxa e 5xx (`falhaPassageira`) reagendam o turno para daqui
  a `REPETIR_A_GERACAO_MS` com a marca `ERRO_DA_REPETICAO` (lida na linha
  reivindicada); a segunda falha é `falhou`, como antes (E8, não transfere).
  Medido na simulação de 25/10/2026: 2 de 59 pedidos ao Gemini passaram de
  30 s, e o cliente ficava sem resposta até escrever de novo. Falha de
  configuração (chave, modelo, 404) não repete. O reagendamento do áudio ou da
  mídia no meio MANTÉM a marca (`encerrar`): sem isso, repetiria de novo.
- ⚠️ **A geração do agente tem 45 s** (`PRAZO_DA_GERACAO_MS`, decisão do
  operador de 09/11/2026: o Gemini 3.8 Flash estourou os 30 s em 4 de 108
  casos, e duas tentativas estouradas deixam o cliente sem resposta). Vai por
  `generateReply({ tetoMs })` no turno, na retomada e no Playground; o teto
  global (`aiRequestTimeoutMs()`, 30 s) segue para Radar, transcrição e
  rascunho. O turno passou a 60 s (`PRAZO_DO_TURNO_MS`: 45 + 10 de envio +
  preparo). Mudou um, confere o outro.

### Encerrar NÃO descarta o turno que já respondeu (1109)

- ⚠️ A automação que o próprio agente executa pode encerrar a conversa no meio
  do turno; o descarte apagava o desfecho e as ações (medido). Desde a 1109,
  `cb_encerrar_limpa_ia` descarta só o que ainda não tem
  `mensagem_enviada_id`; o que respondeu grava `respondeu` com as ações e NÃO
  arma retomada (`armarRetomada` relê a conversa). Pino
  `encerrar-nao-apaga-turno-1109.test.ts`.
- ⚠️ Desde a 1130, nem o que está NO MEIO do envio (`enviando_desde`, carimbado
  depois da reserva): ele termina sozinho e grava o desfecho verdadeiro
  (`respondeu`, `falhou` ou `incerto`) — "descartado" mentia sobre uma
  resposta que estava saindo. E a conversa APAGADA com o turno vivo que já
  tem `mensagem_enviada_id` é `respondeu`, não `incerto` (`ia-central.md`).
- ⚠️ Desde a 1146, nem a RETOMADA que seguiria (a pausa de antes que ela
  atravessa e o card aberto na etapa do agente): ela sai com a conversa
  encerrada, sem reabri-la (decisão do operador, 14/11/2026;
  `ia-retomada.md`). O turno de RESPOSTA continua descartado, e o que
  respondeu e encerrou pela automação continua sem armar série.

### Revisão de 09/11/2026 (antes de ligar os agentes)

- ⚠️⚠️ **A conversa ao modelo termina no CLIENTE** (`terminarNoCliente`,
  `contexto.ts`): ela segue o `created_at` (o relógio do WhatsApp), e a
  mensagem que o cliente escreveu enquanto o agente respondia — e chegou
  depois da reserva — fica ANTES da resposta: o turno dela mandava a conversa
  terminando no modelo (o Gemini recusa, cliente sem resposta; a Anthropic
  CONTINUA o texto anterior). Medido: ~1% das mensagens de cliente. Ganha a
  nota `NOTA_DA_RESPOSTA_CRUZADA` no papel de usuário — SÓ no que vai ao
  provedor: a busca da base, a origem do nome e as travas leem a conversa crua.
- **Áudio `transcrevendo` espera até `TETO_DA_ESPERA_DAS_MIDIAS_MS`** (3 min do
  gatilho, ou da abertura): o cadeado de um processo que morreu só é recolhido
  em 10 min, e o turno reagendava a cada 10 s nesse tempo. Depois, gente ouve
  (`audio`).
- **A chave da OpenAI "só da base" (`soDaBase`, 1047) é `falhou`** no turno e
  na retomada, como no Playground (`provedor_so_da_base`) — antes ela ia ao
  chat e falhava como chave recusada.

### O ÁUDIO da EQUIPE vira texto (decisão do operador, 14/11/2026)

A equipe explica o caso à cliente quase sempre por áudio, e a IA via só o
rótulo: fazia o follow-up às cegas ("Conseguiu ouvir as explicações?") e podia
contradizer a equipe. `ouvirAudiosDaEquipe` (`turno.ts`).

- ⚠️⚠️ **A MESMA `transcreverAudio` do áudio do cliente** (cadeado, 3
  tentativas, custo no modo `transcricao`) nos áudios da equipe
  (`ehFalaDaEquipe`: CRM ou celular, sem `ia_agente_id`) da MESMA janela de
  `lerConversaDaConexao`, só desta conexão. No contexto, como o do cliente, com
  o `[Team member]`. Foto e documento da equipe seguem sem leitura. O Radar
  segue OUVINDO só o cliente (pino em `cb-radar/worker.test.ts`) e LÊ, de
  graça, o que o agente transcreveu; a bolha e a API v1 também o mostram.
- ⚠️⚠️ **NUNCA segura a resposta nem reagenda** (decisão do operador): até 3
  por rodada (`AUDIOS_DA_EQUIPE_POR_TURNO`, os mais novos fora de `pronta` e
  `recusada`), em PARALELO; o turno espera só até sobrar
  `RESERVA_DA_GERACAO_MS` (30 s) para gerar, além do embedding e do envio
  (~12 s do turno). O que não acabou SEGUE em segundo plano — abortado,
  gastaria tentativa — e fica gravado para o próximo turno; este vê o rótulo.
  Não marca `transcreveu`; falha, sem chave ou leitura que falha = o rótulo.
- **No turno de resposta, DEPOIS do áudio e das mídias do cliente** (a
  prioridade é dele) e dentro do `TETO_DA_ESPERA_DAS_MIDIAS_MS`
  (`desdeAEspera`). O áudio do cliente que transfere ou reagenda sai antes: o
  da equipe fica para a rodada seguinte.
- **Na retomada, depois de `conferirRetomada`**: a que vai gerar espera (o
  mesmo teto de tempo); a que só reagendou — a PRÉ-ARMAÇÃO, 30 s depois da fala
  da equipe — manda ouvir SEM esperar, e o follow-up, minutos depois, encontra
  o texto pronto. Sem o teto do gatilho: a âncora é antiga por definição. A
  retomada que não vale (descartada, pausada) não manda ouvir nada.
- **Limite aceito**: áudio longo sem pré-armação (retomada desligada, ou a
  cliente respondeu antes dos 30 s) pode não ficar pronto na 1ª resposta
  depois dele — vai o rótulo, e a seguinte o lê.

### A transferência deixa a conversa PENDENTE

- Pedido do operador (09/11/2026): quem a IA passa para a equipe precisa de
  alguém, como na passagem do robô (`flows/engine.ts`, ação `handoff`). O
  UPDATE da pausa em `transferirParaGente` grava `status: 'pending'` junto,
  marcado com `marcarOrigem` (`agente`): a trilha da 1083 diz quem mudou.
- Conversa encerrada ou já pausada de vez: nada muda (o UPDATE não casa).
  A pausa TEMPORÁRIA (`gente`/`botao`, 1138) vira a transferência (com a
  anotação do motivo, menos a do `agente_passou`, 1141): a IA pediu gente, e
  a temporária a deixaria voltar em N min.
- A pendente continua na caixa (o filtro padrão mostra aberta e pendente). A
  IA só se cala na ENCERRADA (a resposta; o follow-up a atravessa, 1146),
  então "Retomar IA" não precisa reabrir; voltar para aberta é com a equipe.

### O que a IA fez aparece como FAIXA CINZA (1141)

Pedido do operador (12/11/2026), `docs/PLANO-acoes-da-ia-na-trilha.md`.

- ⚠️⚠️ **Etapa e etiqueta pelo cliente do AGENTE** (`ctx.dbDaTrilha` =
  `clienteDoAgente(agente.id)`, cabeçalhos `x-cb-via: agente` e `x-cb-ref`):
  os gatilhos de `deals` e `contact_tags` (912, recriados na 1141) gravam
  `details.via`/`ref_nome`, e a faixa diz "pelo agente de IA <nome>" — sem
  anotação. A PASSAGEM move o card com `marcarOrigem` (agente) e também não
  anota. Só a via `agente` vai para a trilha, e só sem sessão. Pinos:
  `cliente-do-agente.test.ts` e `acoes-da-ia-na-trilha-1141.test.ts`.
- **"Respondeu e passou" (`agente_passou`) não anota**: a faixa "Conversa
  marcada como pendente · pelo agente de IA" (1083) diz, e o aviso (1139)
  avisa com o mesmo texto. Os outros motivos seguem anotação.
- Campo, tarefa, automação e reunião anotam com o TIPO `acao_da_ia` (faixa
  cinza no fio; `anotacoes.md`). O `deal.*` segue `system` (limite).

### A transferência AVISA a equipe (1139)

Pedido do operador (11/11/2026), D1–D4 em
`docs/PLANO-aviso-da-ia-que-passa-a-conversa.md`: a conversa passada ficava
pendente sem ninguém saber. Vale para TODO motivo (a PENDÊNCIA do Trabalhista
e do Prev, teto, áudio, incerto também pela rede, retidas); a passagem entre
agentes não avisa.

- ⚠️⚠️ **Só com a transferência FEITA** (`transferiu`, depois da anotação;
  `avisarDaTransferencia`): `nada_mudou` não avisa. Melhor esforço: o aviso
  que falha (o CHECK sem a 1139) vira log e nunca derruba a transferência.
- **Quem** (`quemAvisarDaTransferencia`, puro): os marcados no agente
  (`avisar_ao_transferir`, ids de LOGIN, até 50) e, sempre, o responsável
  DEPOIS da transferência (o destino atribuído entra). Ninguém marcado ainda
  ATIVO = dono, admins e quem tem a conexão no perfil (a régua dos alarmes,
  1122) — lista velha nunca deixa o aviso sem ninguém. O salvar confere os
  ids contra a conta (`conferirReferencias`).
- **O texto**: "IA passou <cliente> para a equipe" (sem a linha "de quem é"
  no sino: `clienteDoAviso` devolve null); o corpo são os CAMPOS preenchidos
  na resposta que passou ("Pendência da IA: …"), que `executarAcoes` devolve
  em memória (`campos`; o registro guarda o campo, não o valor) — o
  `ja_estava` conta. Sem campo, o texto da anotação.
- **A caixinha dentro do CRM** (`useAvisoDaIaNaTela`, no
  `BrowserNotificationsListener`): `ia_transferiu` (e o alarme `ia_falhou`, 1140, em vermelho), sem prazo, sem
  depender da permissão do navegador (vale no celular); cala como o pop-up
  do sino (`silencioDoSino`). Some ao clicar (marca lido e abre a conversa),
  no X, quando o aviso é lido por outro caminho (UPDATE do realtime) e quando
  a conversa abre na caixa de entrada. ⚠️ Com a aba EM FOCO o pop-up do
  sistema cala para este tipo e o som sai da caixinha; fora de foco, o som é
  do pop-up (`caixinhaTocaOSom`) — senão tocariam os dois.
- **Destaque ÂMBAR e o mesmo para toda passagem** (D5/D7, 12/11/2026):
  borda, véu translúcido e ícone âmbar; vermelho no CRM é falha. Cores que
  valem nos dois temas (`dark:` inerte, `ui.md`).
- ⚠️ **Volta enquanto não lido** (D6): ao montar, os `ia_transferiu` NÃO
  lidos das últimas 24 h (`JANELA_DA_REABERTURA_MS`, até
  `TETO_NA_REABERTURA`), sem som, lidos só no `SUBSCRIBED` do canal (e a
  cada reconexão; o repetido cala pelo id, o fechado no X não volta) —
  `.subscribe()` só começa a entrar, e o INSERT no vão se perdia. ⚠️ O lido pelo tempo real enquanto a consulta está
  no ar NÃO volta (`avisosParaReabrir`, o `lidos` da página): a foto diria
  "não lido" e a caixinha ficaria presa (Codex, #511). O X vale só ali.
- **Limites aceitos**: com "Transferir para" e sem responsável, o destino
  recebe também o "Conversa atribuída" da 0027; o resumo da porta do Meu dia
  não conta o tipo novo (o bloco de notificações mostra).

### O ALARME quando a IA para de responder (1140)

Pergunta do operador (12/11/2026), F1–F3 em
`docs/PLANO-alarme-quando-a-ia-para.md`: créditos, chave, modelo ou provedor
fora terminavam `falhou` (E8) sem ninguém saber. `alarme-da-ia.ts`.

- ⚠️⚠️ **UM episódio por (conta, PROVEDOR)** (`cb_ia_alarmes`, fechada ao
  navegador): a chave e os créditos são do provedor. "Abre / lembra (6 h) /
  só conta" decide `cb_ia_registrar_falha` SOB TRAVA — nunca decidir em TS
  (duas falhas juntas abririam dois avisos; provado com duas sessões). ⚠️ O
  episódio PARADO há mais de 24 h sem falha nova é fechado na próxima: ela
  abre um NOVO (1145; o agente trocou de provedor, e só uma geração boa dele
  fecharia o velho — a falha de semanas depois chegava como "Continua").
  Sem histerese no "voltou": o provedor que oscila manda pares
  abriu/voltou.
- **Quem chama é o `encerrar` do turno e da retomada**: `falhou` com
  `andamento.falhaDaIa` (sem chave, ilegível, só da base e o `catch` da
  geração, com `motivoDaFalhaDaIa`) registra; `andamento.gerou` fecha
  (`registrarIaVoltou`, UPDATE só no aberto). A leitura da chave que FALHA
  (rede) não é da IA: sem alarme. A 1ª passageira reagenda, sem alarme.
- ⚠️ **O motivo lê o TEXTO antes do status**: o 429 sem crédito
  (`insufficient_quota`, "billing") não é "limite por minuto". O Gemini
  escreve "quota" também no limite por minuto: o texto diz "créditos ou cota".
- **O lembrete e o "voltou" aposentam os alarmes do episódio** (marcam lidos
  os `ia_falhou` desde `desde` com o TÍTULO do provedor, `titulosDoAlarme`):
  o aviso não guarda o provedor. Sem isso, a caixinha vermelha (D6 da 1139)
  empilharia um lembrete a cada 6 h na abertura do CRM.
- ⚠️ **Depois de gravar, o alarme RELÊ o episódio** (`conferirSeAindaParada`,
  Codex #512): o "voltou" de outro turno pode fechar entre a decisão e a
  gravação; fechado (ou já outro), os ids que ESTE turno gravou saem lidos.
  O alarme grava→lê e o "voltou" fecha→aposenta: um sempre vê o outro. E o
  INVERSO: a limpeza (por data e título) relê o episódio depois; aberto e
  NOVO, os avisos dele que ela marcou voltam a não lidos (só os que ainda têm
  o carimbo dela).
- **A tela**: `ia_falhou` abre a caixinha VERMELHA (`tomDaCaixinha`), o
  clique leva a `/inbox?ver=em-atraso` (`rotaDoAviso`) e dispara
  `EVENTO_VER_EM_ATRASO` para a caixa de entrada já montada (no celular, a
  página tira a conversa aberta, senão a lista fica escondida); `ia_voltou` é
  só sino. Sem conversa nem contato (`clienteDoAviso` null).
- Melhor esforço (log, nunca muda o desfecho); o Playground não chama
  (`sandbox-sem-efeito.test.ts`). Pino da migration:
  `supabase/migrations/alarme-da-ia-1140.test.ts` (a paridade do CHECK do
  sino com `NotificationType` mora no pino da migration MAIS NOVA).
