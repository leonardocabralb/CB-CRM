---
paths:
  - "src/lib/cb-radar/**"
  - "src/app/api/cb/radar/**"
  - "src/app/*/radar/**"
  - "src/components/radar/**"
  - "src/hooks/use-radar*"
  - "src/lib/transcricao/**"
  - "src/app/api/cb/transcricao/**"
  - "src/lib/ai/**"
  - "src/app/api/ai/**"
  - "src/lib/integracoes/montar*"
  - "src/app/api/cb/integracoes/**"
  - "src/components/settings/integracoes-panel.tsx"
  - "src/components/settings/ai-config.tsx"
  - "src/components/settings/ai-knowledge.tsx"
  - "src/components/agents/**"
  - "src/app/*/agents/**"
  - "src/lib/ia-chaves/**"
  - "src/lib/ia-agentes/**"
  - "src/components/agentes-de-ia/**"
  - "src/app/api/cb/ia/**"
  - "src/components/inbox/ai-thread-banner*"
---

# IA (Radar, transcrição, Integrações, assistente) — regras

Chave por provedor, da conta (BYO), cifrada com `ENCRYPTION_KEY`. História:
`git show f5879b3f:CLAUDE.md` e `docs/PLANO-radar-de-atendimento.md`.

### Radar de Atendimento (941): worker + tabela + aba `/radar`

A IA lê as conversas dos últimos 7 dias e grava `cb_conversation_insights`
(UMA linha viva por conversa, pelo `worker.ts`); o painel só lê.

**O que aparece no painel**

- ⚠️⚠️ **O painel só mostra quem tem GATILHO** (`temGatilho`): insatisfação,
  pedido sem resposta, urgência média/alta ou espera ≥ `LIMIAR_ALARME_MS`.
  Sozinhos NÃO abrem cartão: nota baixa (julgamento), `mencaoProcesso` (quase
  toda conversa cita processo) e `pontosDeAtencao` (resumo do caso). A
  análise saudável segue gravada (dá a nota média).
- ⚠️ **Duas réguas de espera — trocá-las é o erro fácil.** `LIMIAR_ALARME_MS`
  (24 h CORRIDAS) abre o cartão; `LIMIAR_PENDENCIA_SEG` (30 min ÚTEIS) só
  decide a etiqueta. No vão entre as duas, a etiqueta cai para o INSTANTE
  (`semRespostaDesde`); sem esse ramo, o cartão fica MUDO.
- ⚠️ **A pendência é conferida AO VIVO na tela** (`respostasDepoisDaPendencia`;
  `aguardando_desde` é retrato da análise), falhando para o lado do ALARME
  (erro mantém o cartão; lista truncada vale — DESC, o teto só omite resposta
  antiga). Mensagem apagada não é resposta.
- ⚠️⚠️ **"Resposta de gente" = `sender_id` OU `from_device = true`** (o
  celular pareado não tem `sender_id`). Não fecham a pendência: broadcast,
  automação, fluxo e a AGENDADA — que sai COM `sender_id` e é excluída, no
  worker e ao vivo, por `cb_scheduled_messages.message_id`. ⚠️
  `houveHumanoNaJanela` usa só `sender_id` de propósito (preserva a análise
  congelada): não unificar. ⚠️ A resposta do AGENTE DE IA (`bot` com
  `ia_agente_id`) FECHA a pendência, mas NÃO entra no tempo de resposta da
  equipe (`porAgenteDeIa`; ao vivo, `RESPOSTA_QUE_FECHA_A_PENDENCIA`).
- ⚠️ **Análise `failed` aparece SEM gatilho** (sumida, o vazio afirmaria
  "nenhum sinal" sobre conversa não lida); o resgate filtra `estado = 'aberto'`
  (pino `use-radar.resgate.test.ts`).
- ⚠️ **Recarrega a cada 2 min com a aba visível** (o tique de 1 min só
  re-renderiza e não vê que um colega respondeu).
- ⚠️ **Insatisfação exige evidência recente: 2 dias de expediente, em TEMPO
  ÚTIL** (`JANELA_INSATISFACAO_UTIL_SEG`; em corridas, a de sexta expirava no
  domingo); escrita e leitura SE SOMAM (~4 dias úteis). ⚠️ A âncora é o
  INSTANTE DA ANÁLISE (`agoraMs`, 3º argumento de `interpretarAnalise`), não
  a última linha — senão a conversa que morre depois da resposta ficava acesa.
- ⚠️ **Não existe aba "Todos"** (decisão do operador): o descarte errado tem o
  "Desfazer" do toast e o cartão que FICA, apagado, com "Reabrir" enquanto a
  tela está aberta (`mexidasAqui`). **Falso NEGATIVO da IA não tem botão**
  (decisão fechada): reanalisar repete o veredito, pago.
- **O painel aplica a régua do worker na leitura** (7 dias, `radar_enabled`),
  mas ⚠️ **pendência aberta não expira**: parada além da janela com
  `aguardando_desde` e `estado='aberto'` FICA, e os cartões ignoram urgência,
  insatisfação e nota dela (`foraDaJanela`).

**O worker e a tabela**

- **NADA dispara sozinho**: o agendador bate em `/api/cb/radar/cron` (laço
  lento).
- ⚠️ **`cb_channels.radar_enabled` nasce FALSE e é `=== true`** — exceção
  DELIBERADA a "escopo vazio = todos" (conversa vai a provedor externo, e há
  canal pessoal na conta). Não "corrigir".
- **`authenticated` só tem SELECT** em `cb_conversation_insights`: tratar e
  descartar passam por `PATCH /api/cb/radar/[conversationId]/estado` (do
  navegador, 0 linhas).
- **Sinal sem evidência é DESCARTADO pelo parser** (`interpretarAnalise`,
  `rubrica.ts`; evidência = índice de linha do transcrito → `messages.id`):
  sem isso, alarme falso.
- ⚠️ **Feedback por atendente exige AUTORIA**: só passa citando linha ESCRITA
  pelo atendente nomeado (`LinhaDoTranscrito.autor`) — senão "a Ana
  demorou", do cliente, viraria auditoria da Ana; nome não resolvido =
  "Equipe", sem avaliação. Na tela, só `useCan('manage-members')`. ⚠️ O gate é
  SÓ de renderização (qualquer membro lê `detalhes.analise`); a barreira real,
  pendente, tem receita em `docs/PLANO-radar-de-atendimento.md`.
- **Tempos em segundos ÚTEIS com fuso FIXO -03:00**: só `horario-comercial.ts`
  muda se o horário de verão voltar; intervalo negativo vira zero lá.
- ⚠️ **Ciclo de vida do sinal**: `tratado` reabre SÓ com mensagem DO CLIENTE
  posterior ao `estado_em` (UPDATE condicional separado); `descartado` NUNCA
  reabre sozinho — exceto sobre `failed` que NUNCA teve análise
  (`descarteFoiSobreFalha`): reabre na primeira análise boa.
- ⚠️ **Toda escrita pós-claim tem CERCA DE POSSE**
  (`.eq('status','running').eq('running_desde', <carimbo do claim>)`), e o
  RECOLHEDOR a dele (o `running_desde` velho; `is null` quando nulo — `.eq()`
  nunca casa NULL). ⚠️ "Mensagem nova" exige `janela_fim` NÃO nulo (nulo
  virava retentativa paga infinita).
- **A janela lê DESC + reverse**: com ASC, o teto cortava as de HOJE.
- ⚠️ **Janela sem fala do cliente NÃO chama a IA** (só métricas;
  `detalhes.sem_cliente_na_janela`) — senão um broadcast dispara dezenas de
  análises pagas; com fala, reanalisa. ⚠️ Janela só de MÁQUINA sobre análise
  completa: UPDATE preservador (avança `janela_fim`, mantém a análise e o
  `aguardando_desde`) — senão o broadcast apagava o alarme do esquecido.
- **O transcrito colapsa repetição EXATA do robô** (`botRepetidas`; fica a
  mais RECENTE, declarado no prompt); nunca humano (insistência é o sinal) nem
  o AGENTE DE IA, `bot` que é conteúdo ("IA (Nome)", `porAgenteDeIa`).
- **A legenda (`como-funciona.tsx`) IMPORTA as constantes reais**
  (`JANELA_DIAS`, `THROTTLE_MS` em `ordenacao.ts`, `TETO_MENSAGENS`,
  `CICLO_MINUTOS`): número no dicionário mente.
- **`loadAiConfig` do Radar usa `requireActive: false`** (precisa da
  CREDENCIAL; `is_active` é do assistente) ⚠️ e SEM `channelId` (1047): pelo
  canal, um agente de uma conexão trocaria chave e modelo do Radar ali (pino
  `chaves.chamadores.test.ts`).
- **O upsert em `cb_conversation_insights` funciona**: o UNIQUE de
  `conversation_id` é TOTAL.

### Transcrição de áudio (943): função ÚNICA, Gemini-only, chave BYO

`transcrever.ts` (testado), `POST /api/cb/transcricao/[messageId]`, colunas
`transcricao_*` em `messages`. A MESMA função idempotente serve ao botão da
bolha e ao worker do Radar.

- **A transcrição NUNCA vai para `content_text`**: o escrito e o ouvido diferem,
  e sobrescrever é irreversível.
- ⚠️ **O cadeado `UPDATE…RETURNING` não é opcional**: no deploy há dois
  processos Node e o rate limit é por processo — só o banco impede pagar o
  mesmo áudio duas vezes. Teto de tentativas DENTRO do WHERE; travada de
  10 min recolhida pelo cadeado; escrita final e falha com cerca
  (`transcricao_desde`).
- ⚠️ **Problema de CONFIGURAÇÃO devolve `recusada` SEM GRAVAR** (sem chave
  Gemini, chave ilegível, apagada, não-áudio, conta errada, áudio ainda sem
  `media_url` — janela de 2 min): gravar mataria o botão para sempre.
  `recusada` GRAVADA é só o irreversível (URL relativa antiga, grande demais,
  `MAX_TOKENS`, tentativas esgotadas). ⚠️ A chave é a do GEMINI da conta
  (`lerChave(conta, 'gemini')`, 1047) — nem agente nem canal; erro de LEITURA
  dela é `falhou` sem gravar, nunca "sem chave".
- ⚠️ **O modelo é FIXADO em `MODELO_TRANSCRICAO`**, UM para os dois
  chamadores (quem chega primeiro fixa o do áudio, nenhuma coluna o registra,
  o teto de 3 tentativas é compartilhado). Plano B no comentário da
  constante. ⚠️ Não desligar o raciocínio (`thinkingBudget: 0` piora o erro,
  medido). ⚠️ Trocar o modelo NÃO refaz o já transcrito — quem trocar decide
  se limpa `transcricao*`.
- ⚠️ **`gemini-3.5-transcribe` NÃO serve pelo `generateContent`** (200 com
  `parts: [{}]` vazio, cobrando a entrada — vive noutra API).
- **O worker do Radar transcreve SÓ áudio do CLIENTE e SÓ nunca-tentado**
  (`transcricao_status` nulo), até 5 por análise, dentro do `deadlineMs`. ⚠️
  `falhou` fica para o botão HUMANO (a retentativa por ciclo queimava o teto).
  Falha não derruba a análise; o texto entra com `PREFIXO_AUDIO` (contrato com
  a rubrica: 2.000 caracteres por linha de áudio, truncamento declarado).
- **A transcrição NÃO entra no índice da busca (929).** O mime enviado é
  `messages.media_type` → `Content-Type` do Storage → `audio/ogg`.

### Integrações é o lar das CHAVES e dos modelos por MÓDULO (946)

`montar.ts` (puro, testado), `GET /api/cb/integracoes/status` e
`integracoes-panel.tsx`. O COMPORTAMENTO do agente fica em Agentes de IA.

- ⚠️⚠️ **A CHAVE é do PROVEDOR, uma por conta, em `cb_ia_chaves` (1047)** —
  nunca por conexão (D1). FECHADA ao navegador: só `src/lib/ia-chaves/repo.ts`
  a toca, com o cliente de SERVIÇO; pino `chaves.chamadores.test.ts`. A de
  embeddings é a da OpenAI, MENOS a recusada para embeddings ao gravar
  (`serve_embeddings = false`), e a DEDICADA herdada
  (`cb_ia_chaves.embeddings_api_key`) vence (`lerChaveDeEmbeddings`).
  `ai_configs.api_key`/`embeddings_api_key`: nada as LÊ, `gravarChave` as
  ESPELHA (volta atrás). A chave nova é conferida em CADA modelo em uso;
  recusada num que a atual alcança, nada troca (`modelo_em_uso_recusado`). A
  da OpenAI que só gera embedding grava a marca "só da base" (`soDaBase`: o
  mesmo cifrado nas duas colunas) — nenhuma tela a oferece ao chat.
- ⚠️ **A linha PADRÃO de `ai_configs` é a configuração dos MÓDULOS** (provedor
  e modelo do Radar) e do assistente legado, para a conta inteira: `montar.ts`
  monta um cartão por provedor a partir da CHAVE e lê só ela; canais aparecem
  SÓ no Radar (o `radar_enabled`). O `PUT /api/cb/ia/chaves` a cria
  (assistente DESLIGADO) quando falta — sem ela, Radar em `sem_ia`.
- ⚠️ **Só o Radar tem coluna própria (`ai_configs.radar_model`; NULL = herda
  `model`).** Transcrição e RAG têm constante (`MODELO_TRANSCRICAO`,
  `EMBEDDING_MODEL`), que entra em `montarCartoes` por PARÂMETRO — nunca
  redigitada no módulo puro nem no dicionário.
- ⚠️ **O modelo do Radar aparece em TRÊS lugares do worker**
  (`generateStructured`, `logAiUsage`, a coluna `model` do insight): resolver
  `config.radarModel ?? config.model` UMA vez.
- ⚠️ **`generateStructured` recebe o modelo por PARÂMETRO explícito**, nunca
  por `{...config, model}`: o spread não deixa rastro no tipo, e um merge em
  `structured.ts` devolveria o Radar ao modelo do chat sem erro.
- ⚠️ **`POST /api/ai/config` reescreve a linha** (ausente vira NULL/false):
  Integrações não passa por ele — chave por `/api/cb/ia/chaves`, modelo do
  Radar por `PATCH /api/cb/ia/radar`; tela que volte a ele ecoa o que não
  edita. Ignora `api_key` (recusa `sem_chave`); o `DELETE` saiu.
  ⚠️ `radar_model` ausente do corpo = "não mexe".
- ⚠️ **O modelo do Radar é validado no SAVE, contra o provedor** — também
  quando só o PROVEDOR muda. O ping testa o modelo do CHAT, o do Radar quando
  difere e está ligado em alguma conexão, e, na chave do Gemini, o
  `MODELO_TRANSCRICAO`.
- ⚠️ **`?ping=0` existe porque cada ping é geração PAGA**: a tela carrega em
  dois tempos, o botão repete só os pings, e o `useEffect` tem guarda
  (`disparouRef`) contra o StrictMode.
- **Nenhuma chave sai das rotas de STATUS e de chaves, nem mascarada**: a
  falha volta como CÓDIGO, nunca `AiError.message` (a OpenAI ecoa a chave).
  ⚠️ O SAVE do modelo do Radar devolve a mensagem do provedor ("modelo não
  encontrado") — EXCETO `code === 'invalid_key'`, texto genérico (manter).
- **Módulo sem uso ativo NÃO some**: aparece com o motivo.
- **Radar exige `radar_enabled === true`; transcrição é Gemini-only; RAG é
  OpenAI-only** (modelo fixo, `vector(1536)`), no cartão da OpenAI mesmo com
  outro provedor.
- **`AI_PROVIDER_MODELS` é SUGESTÃO (`<datalist>`), nunca allow-list.**
  Google Agenda é cartão "não conectado" de propósito.

### Agentes de IA (1048, `src/lib/ia-agentes/`, `/agents`)

Plano vivo: `docs/PLANO-agentes-de-ia.md` (D1–D27, E1–E14). F2 (1049): eles
RESPONDEM cliente, por etapa do funil; a resposta automática do assistente
anterior saiu (E2), e o ✨ do rascunho segue nele.

- ⚠️⚠️ **"Agente" no código é PESSOA** (`assigned_agent_id`, o papel `agent`).
  Agente de IA leva `ia_agente` no nome (`cb_ia_agentes`, `ia_agente_id`).
- ⚠️ **`cb_ia_agentes` só dá SELECT ao ADMINISTRADOR** (D14, forma da 1032) e
  nenhuma escrita ao navegador: `repo.ts` escreve com o cliente de serviço, a
  conta em toda consulta e os ids das listas (arrays sem FK) conferidos
  contra a conta. Quem não é admin lê nome e id por rota.
- ⚠️ **`conexoes` vazio = NENHUMA conexão**, nunca "todas" (a exceção do
  `radar_enabled`). Apagar conexão a tira dos agentes por gatilho.
- **Apagar é ARQUIVAR**: o uso antigo guarda o nome CONGELADO
  (`ai_usage_log.ia_agente_nome`); o nome é único só entre os não arquivados.
- **Instruções e regras (D23) em campos separados**; o pedido ao modelo sai
  de UMA função pura, a do turno e do Playground (`montarPedidoDoAgente`).
- **O gasto do Playground é `agente_teste`** (D13), separado de `agente`. A
  soma do uso é no BANCO (`cb_ia_uso`): linha a linha, o PostgREST cortava
  em 1000.
- ⚠️ **Custo em R$ (D21) é ESTIMATIVA**: preço de lista em US$ com VIGÊNCIA por
  linha (`precos.ts` — preço novo é linha nova, senão o histórico muda) × a
  cotação de hoje (`ai_configs.cotacao_dolar`). Modelo fora da tabela é "sem
  preço", NUNCA zero; a saída do Gemini é `max(saída, total − entrada)`.

### Quem responde (F2, 1049): etapa, fila e turno

`quem-responde.ts` (puro, e `lerQuemAtende`), `entrada.ts` (a porta das DUAS
ingestões), `fila.ts`, `turno.ts`, `rede.ts` (no topo de `/api/automations/cron`).

- ⚠️⚠️ **O agente atua por ETAPA do funil (D24)**: `cb_ia_agente_etapas`,
  `stage_id` é a chave primária — uma etapa, UM agente. Só admin lê (forma da
  1032); só `repo.ts` escreve, conferindo a etapa contra os funis DA CONTA
  (`pipelines!inner`: `pipeline_stages` não tem `account_id`) e sem regravar as
  que ficam (o `desde`); etapa de outro = 409 `etapa_ocupada` com o nome.
  Arquivar o agente APAGA as linhas dele (gatilho).
- ⚠️⚠️ **Responde o agente da etapa do card ABERTO mais recente do contato**
  (`created_at desc`), ligado, não arquivado e com a conexão da mensagem.
  `lerQuemAtende` é a ÚNICA leitura desses fatos (a entrada e as duas
  conferências do turno); a rota da faixa aplica o mesmo `quemResponde`.
- ⚠️ **D27: só card que ENTROU na etapa depois de o agente ser ligado nela**
  (`deals.etapa_desde >= greatest(desde, cb_ia_agentes.ativado_em)`; data
  ausente = não atende). As duas datas são carimbadas pelo BANCO. ⚠️ A carga
  da Kommo cala os gatilhos de `deals`: o card que ela MOVE guarda o
  `etapa_desde` velho, e o que ela CRIA ganha a hora da carga (conta como novo).
- ⚠️⚠️ **A ordem das regras É a regra** (`quemResponde`): fora do alcance
  (grupo, Instagram) → não abre turno → robô consumiu → automação FALOU (E4:
  `ResultadoDoDisparo.falou`, em TODOS os gatilhos da mensagem, com o
  `tag_added` aninhado e a fala ADIADA do funil — card criado ou movido para
  etapa que automação ligada escuta, `etapaTemQuemFale`) → encerrada → pausada
  → sem card → etapa sem agente → desligado → fora da conexão → card antigo.
- ⚠️ **O card que o FUNIL cria na ingestão também é fala adiada**
  (`routeContactToPipeline` devolve a etapa; pino
  `pipeline-routing.chamadores.test.ts`). Na mensagem SEGUINTE da rajada,
  `conferir` REAGENDA enquanto há `deal_stage_changed` não drenado em etapa
  com quem fale (`funilAindaVaiFalar`); no vão do dreno, só a reserva pega.
- ⚠️⚠️ **UMA régua de conteúdo, `abreTurno`, na entrada E no turno** (E9/E10):
  figurinha, localização, botão, texto sem nada visível e o rótulo montado com
  `PREFIXO_DE_TIPO_NAO_SUPORTADO` (recusado pelo COMEÇO) não abrem turno.
- ⚠️ **Robô ou automação que respondeu cala o agente**: a entrada descarta o
  pendente e o `rodando` sem `enviando_desde` da conexão
  (`descartarPendente`); o turno e a reserva descartam com `bot` sem
  `ia_agente_id` depois do gatilho, na MESMA conexão.
- ⚠️⚠️ **A ingestão só ENFILEIRA** (`cb_ia_enfileirar_turno`: um pendente por
  conversa E conexão, com agente, card e etapa; a rajada de 8 s o empurra).
  Executa em `after()` e, como rede, o cron. O turno fica AMARRADO a (agente,
  card, etapa): card movido ou etapa com outro agente = descarta, sem
  re-resolver (o alerta de atraso chama a equipe).
- ⚠️⚠️ **A última palavra é da reserva, `cb_ia_reservar_envio(turno,
  rodando_desde)`**: conversa travada (`FOR NO KEY UPDATE`), NÃO escreve nada,
  devolve `ok` ou o 1º motivo — `descartado`, `encerrada`, `pausada`,
  `card_mudou`, `card_fechado`, `agente_desligado`, `fora_da_conexao`,
  `agente_sem_etapa`, `mais_nova`, `robo_falou`, `teto`. `teto` transfere,
  `pausada` é `pausado_no_meio`, o resto descarta sem transferir (transferir
  pausaria a IA até alguém clicar). Não reconfere a D27.
- ⚠️ **O teto é CONTADO nas mensagens do agente** na conversa desde
  `greatest(etapa_desde, ia_retomada_em)`: mudar de etapa ou "Retomar IA"
  recomeça. `ai_reply_count` não decide mais nada.
- ⚠️⚠️ **PASSAGEM (D25)**: o pedido lista, numerados, os agentes de
  `pode_passar_para` ligados, não arquivados e com a conexão; `[[PASSAR:n]]`
  vale em QUALQUER ponto do texto (`lerPassagem`) e nunca vai ao cliente; a
  transferência vence a passagem. Depois da 2ª conferência: etapa do destino
  no mesmo funil (menor `position`), senão no funil mais antigo; UPDATE
  CONDICIONAL de `deals` (`pipeline_id` + `stage_id`; a etapa do turno e
  `open`) e `drenarEventosDeFunil()`; anotação; e, se NENHUMA automação
  ligada escuta a etapa de destino (`etapaTemQuemFale`), turno do destino com
  `veio_de_passagem` sobre a MESMA mensagem, sem espera — com automação
  escutando, ELA fala e o destino responde a próxima mensagem (a regra E4 da
  entrada; esperar pelo dreno não basta, porque o evento é reivindicado antes
  de a automação rodar e um "Aguardar" a faria falar DEPOIS; Codex, #309);
  este termina `passou`
  ANTES de o novo ser reivindicado (um `rodando` por conversa). Passagem de
  passagem, n inválido, destino sem etapa ou UPDATE que não casa = transfere.
  É um escritor de etapa sem `auth.uid()` (trilha `sistema`, `deal.*` com
  `system`, a 950 vale). O Playground manda o mesmo bloco (sem o recorte da
  conexão) e diz para quem passaria.
- ⚠️⚠️ **O turno NUNCA reenvia.** A posse (`enviando_desde`) é carimbada
  DEPOIS da reserva: `rodando` sem ela = ainda não enviou; posse perdida =
  nada saiu (`abandonado`). Erro depois da 1ª chamada ao provedor que não seja
  recusa comprovada (4xx) = `incerto`, e transfere; o recolhedor decide pelo
  carimbo e nunca re-executa. Cerca de posse (`rodando` + `rodando_desde`) em
  TODA escrita no turno, menos o id do provedor (`gravarIdEnviado`): o eco
  precisa dele mesmo com o turno recolhido.
- ⚠️⚠️ **PAUSA (D26)**: `ai_autoreply_disabled` + `ia_pausada_por` (`gente` |
  `botao` | `transferencia` | `automacao`). Só "Retomar IA" (`POST
  /api/ai/autoreply`: limpa e grava `ia_retomada_em`) a desfaz; mudar de etapa
  não. A de GENTE é o gatilho da 1049: mensagem de gente (`sender_id` OU
  `from_device`) sem `ia_agente_id`, com `gravada_em` (a carga fica fora), 1:1,
  e a conversa com `ia_agente_id`, OU turno vivo, OU o contato com card aberto
  numa etapa COM agente, OU SEM card aberto (a equipe abriu a conversa: o card
  nasce DEPOIS da mensagem). Card só em etapa sem agente NÃO pausa: é o SDR
  fora do território da IA, e mover o card entrega a conversa ao agente
  (revisão da F2). O eco do turno (`mensagem_enviada_id`) não
  pausa; a agendada e o eco antes do id pausam (o lado seguro). O turno só LÊ
  a pausa. `set_ai`: desligar = `automacao` sem pisar noutro motivo; ligar
  desfaz SÓ `automacao`, sem zerar o teto nem soltar o responsável.
- ⚠️ **Encerrar limpa agente e pausa, recomeça o teto (`ia_retomada_em =
  now()`) e descarta os turnos**
  `aguardando` e `rodando` (`cb_encerrar_limpa_ia`, SECURITY DEFINER: o
  operador encerra sob RLS), inclusive o que já envia.
- ⚠️ **Falha de CONFIGURAÇÃO não transfere** (E8): chave, modelo, provedor
  fora do ar → `falhou`. Transferem o sentinela, a resposta vazia, o teto, o
  áudio que não se ouve e o envio incerto — pausa `transferencia`, destino só
  sem responsável, anotação "IA · <agente>". Nunca por cima de pausa ou de
  conversa encerrada (zero linhas = sem nota, `pausado_no_meio`).
- ⚠️ **Só o turno passa `iaAgenteId` ao `engineSendText`** (pino
  default-deny): a 972 conta `bot` COM `ia_agente_id` como "respondido".
  Depois do envio, `conversations.ia_agente_id` = o ÚLTIMO agente que respondeu.
- ⚠️ **O contexto é SÓ da conexão do turno** (D4); áudio pela transcrição
  (reagenda até 2 min de `gravada_em`), mídia como descrição (`contexto.ts`).
  Gatilho apagado ou editado descarta. O eco da Evolution que chega antes do
  INSERT é gravado COMO a resposta do agente por `eco.ts`, sem motor.
- **FK anulável de `cb_ia_turnos`/`ai_usage_log` ganha índice PARCIAL**;
  `messages.ia_agente_id` fica sem índice (decisão do operador). ⚠️ Apagar
  conexão DESCARTA os pendentes dela (senão dois colidem em (conversa, NULL)).
- ⚠️ **A faixa do fio pergunta `GET /api/cb/ia/conversa/[id]`** quem responde;
  as colunas do realtime (pausa, motivo, último agente) só a fazem perguntar de
  novo. Atendendo = "IA · X" + Pausar; pausada (com agente da etapa ou
  `ia_agente_id`) = motivo + Retomar; senão, nada. Pausar não toca
  `assigned_agent_id`. Motivo e status do turno são chaves MONTADAS, cobradas
  nos dois dicionários (`STATUS_DO_TURNO` lê o CHECK da 1049). A bolha mostra
  "IA · <nome>" (`nomes-dos-agentes.ts`, cache de módulo; sem nome, "IA").
  `/api/cb/ia/agentes/nomes` e `/conversa/[id]` são de qualquer membro e
  devolvem só id e nome.
- ⚠️ **A tela legada (`ai-config.tsx`) não tem controle de auto-reply**: o
  corpo ECOA `auto_reply_*` e NÃO manda `handoff_agent_id`. Pino
  `ai-config.test.ts`.

### Assistente e provedores (`src/lib/ai/`)

- ⚠️ **O "digitando…" (#527) sai pelo MESMO canal da resposta**
  (`mostrarDigitando`, pela resolução de `engineSendText`), só em canal Meta
  com id `wamid.` — nunca as credenciais da CONTA. Nunca lança; log por
  `semTokenDaMeta`. ⚠️ A Meta marca a mensagem do cliente como LIDA junto
  (P6). O TURNO o chama depois das conferências, em paralelo com a geração, o
  ESPERA (`concluirDigitando`, até 2 s) antes da última conferência e o
  cancela em toda saída sem envio (`finally` de `executarTurno`): solto,
  chegava depois da resposta. Pino `digitando.chamadores.test.ts`.
- **`generateStructured` (`structured.ts`) é separado de `generateReply` DE
  PROPÓSITO**: o turno e o rascunho não herdam regressão da análise.
- **Gemini é o terceiro provedor** (`structured.ts` e `providers/gemini.ts`
  são nossos): chave SEMPRE no cabeçalho `x-goog-api-key`, nunca `?key=`; em
  produção, tier PAGO (o gratuito pode usar os dados enviados).
- **Modo ou provedor novo exige migration no CHECK** de `ai_usage_log`
  (`mode`, `provider`): senão `logAiUsage` engole o erro e o custo some.
- ⚠️ **`ai_configs` tem índices únicos PARCIAIS (903: global + por canal)**:
  sem `onConflict` (lookup + insert/update); `.maybeSingle()` com o canal, ou
  `.is('channel_id', null)` para o padrão.
- Agente por canal, interruptor, RAG por canal, `radarModel` em
  `CONFIG_COLUMNS` e a opção Gemini são trechos NOSSOS em arquivos do
  upstream (`docs/MERGE-UPSTREAM.md`).
